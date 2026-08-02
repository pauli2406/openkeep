import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ArchiveImportResult,
  ArchiveSnapshot,
  ArchiveSnapshot as ArchiveSnapshotType,
  Correspondent,
  Document,
  DocumentType,
  HealthProvidersResponse,
  HealthResponse,
  ProcessingStatusResponse,
  ProviderConfig,
  ReadinessResponse,
  Tag,
  WatchFolderScanResponse,
} from "@openkeep/types";
import { api, getApiErrorMessage } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Shield,
  Server,
  CheckCircle,
  AlertCircle,
  Loader2,
  Activity,
  Layers,
  RefreshCw,
  Edit2,
  Download,
  Upload,
  Tags,
  Users,
  FileType,
  Check,
  X,
  FolderSearch,
  Brain,
} from "lucide-react";
import { format } from "date-fns";
import { useI18n, type AppLanguage } from "@/lib/i18n";

export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateTokenResponse {
  token: string;
  id: string;
  name: string;
}

export type Translate = ReturnType<typeof useI18n>["t"];

export function jobStatusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "success" | "warning" {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "warning";
    case "queued":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "default";
  }
}

export function queueLabel(queueName: string): string {
  if (queueName === "document.process") return "OCR / Parse";
  if (queueName === "document.embed") return "Embedding";
  return queueName;
}


export function QueueCard({
  label,
  value,
  active,
  variant,
}: {
  label: string;
  value: number;
  active: boolean;
  variant?: "warning";
}) {
  return (
    <div
      className={`rounded-lg border p-3 text-center transition-colors ${
        active
          ? variant === "warning"
            ? "border-[var(--ok-amber)]/30 bg-[var(--ok-amber-soft)]"
            : "border-primary/30 bg-primary/5"
          : ""
      }`}
    >
      <p
        className={`ok-num text-xl font-semibold ${
          active
            ? variant === "warning"
              ? "text-[var(--ok-amber)]"
              : "text-primary"
            : "text-foreground"
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}


export function formatWatchFolderReason(reason: string): string {
  return reason
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function formatWatchFolderAction(
  action: WatchFolderScanResponse["items"][number]["action"],
): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

export function formatWatchFolderFieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatWatchFolderDate(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return format(new Date(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

export function getWatchFolderFieldValue(document: Document, field: string): string | null {
  switch (field) {
    case "correspondent":
      return document.correspondent?.name ?? null;
    case "issueDate":
      return formatWatchFolderDate(document.issueDate);
    case "dueDate":
      return formatWatchFolderDate(document.dueDate);
    case "expiryDate":
      return formatWatchFolderDate(document.expiryDate);
    case "amount":
      return document.amount !== null
        ? `${document.amount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} ${document.currency ?? ""}`.trim()
        : null;
    case "currency":
      return document.currency ?? null;
    case "referenceNumber":
      return document.referenceNumber ?? null;
    case "holderName":
      return document.holderName ?? null;
    case "issuingAuthority":
      return document.issuingAuthority ?? null;
    default:
      return null;
  }
}

export function watchFolderActionVariant(
  action: WatchFolderScanResponse["items"][number]["action"],
): "secondary" | "success" | "destructive" | "outline" {
  switch (action) {
    case "imported":
      return "success";
    case "duplicate":
      return "secondary";
    case "unsupported":
    case "failed":
      return "destructive";
    case "planned":
      return "outline";
  }
}

export function WatchFolderFieldReview({
  document,
  isLoading,
  isError,
}: {
  document: Document | null;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  if (isLoading) {
    return <p className="text-sm text-muted-foreground">{t("settings.loadingExtractedFields")}</p>;
  }

  if (isError) {
    return <p className="text-sm text-destructive">{t("settings.failedToLoadExtractedFields")}</p>;
  }

  if (!document) {
    return <p className="text-sm text-muted-foreground">{t("settings.noExtractedFieldsYet")}</p>;
  }

  const requiredFields =
    document.metadata.reviewEvidence?.requiredFields ?? document.documentType?.requiredFields ?? [];

  if (requiredFields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.keyFieldExtractionUnavailable")}
      </p>
    );
  }

  const missingFields = new Set(
    document.metadata.reviewEvidence?.missingFields ??
      requiredFields.filter((field) => !getWatchFolderFieldValue(document, field)),
  );
  const foundFields = requiredFields
    .map((field) => ({ field, value: getWatchFolderFieldValue(document, field) }))
    .filter((entry) => !missingFields.has(entry.field) && entry.value !== null);

  return (
    <div className="space-y-3">
      {document.metadata.reviewEvidence?.confidence != null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {t("settings.confidence")}:{" "}
            <span className={confidenceTextClass(document.metadata.reviewEvidence.confidence)}>
              <span className="ok-num">{(document.metadata.reviewEvidence.confidence * 100).toFixed(0)}%</span>
            </span>
          </span>
          {document.metadata.reviewEvidence.confidenceThreshold != null && (
            <span>
              {t("settings.threshold")}: <span className="ok-num">{(document.metadata.reviewEvidence.confidenceThreshold * 100).toFixed(0)}%</span>
            </span>
          )}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.foundValues")}
          </p>
          <div className="mt-2 space-y-2">
            {foundFields.length > 0 ? (
              foundFields.map(({ field, value }) => (
                <div key={field} className="rounded-md border bg-muted/20 px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {formatWatchFolderFieldLabel(field)}
                  </p>
                  <p className="text-sm font-medium text-foreground">{value}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.noKeyFieldsFound")}</p>
            )}
          </div>
        </div>
        <div className="rounded-md border bg-background/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.missingKeyFields")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {missingFields.size > 0 ? (
              Array.from(missingFields).map((field) => (
                <Badge key={field} variant="warning">
                  {formatWatchFolderFieldLabel(field)}
                </Badge>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.noneMissing")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function confidenceTextClass(confidence: number): string {
  if (confidence >= 0.8) return "font-medium text-[var(--ok-green)]";
  if (confidence >= 0.5) return "font-medium text-[var(--ok-amber)]";
  return "font-medium text-[var(--ok-red)]";
}

export function formatJobTime(dateStr: string, language: AppLanguage, t: Translate): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}${t("settings.secondsAgo")}`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}${t("settings.minutesAgo")}`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}${t("settings.hoursAgo")}`;
    return format(date, language === "de" ? "d. MMM, HH:mm" : "MMM d, HH:mm");
  } catch {
    return dateStr;
  }
}

// --- AI & Providers ---

export const CHAT_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  mistral: "Mistral",
};

export const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  "google-gemini": "Google Gemini",
  voyage: "Voyage AI",
  mistral: "Mistral",
};

export const PARSE_PROVIDER_LABELS: Record<string, string> = {
  "local-ocr": "Local OCR",
  "google-document-ai-enterprise-ocr": "Google Doc AI Enterprise",
  "google-document-ai-gemini-layout-parser": "Google Doc AI Gemini",
  "amazon-textract": "Amazon Textract",
  "azure-ai-document-intelligence": "Azure Document Intelligence",
  "mistral-ocr": "Mistral OCR",
};

export function resolveChatProvider(cfg: ProviderConfig): {
  name: string;
  model: string | undefined;
  configured: boolean;
} | null {
  if (cfg.activeChatProvider) {
    const providerConfig = {
      openai: { hasKey: cfg.hasOpenAiKey, model: cfg.openaiModel },
      gemini: { hasKey: cfg.hasGeminiKey, model: cfg.geminiModel },
      mistral: { hasKey: cfg.hasMistralKey, model: cfg.mistralModel },
    }[cfg.activeChatProvider];

    if (providerConfig?.hasKey) {
      return {
        name: CHAT_PROVIDER_LABELS[cfg.activeChatProvider] ?? cfg.activeChatProvider,
        model: providerConfig.model,
        configured: true,
      };
    }
  }

  if (cfg.hasOpenAiKey) {
    return { name: "OpenAI", model: cfg.openaiModel, configured: true };
  }
  if (cfg.hasGeminiKey) {
    return { name: "Gemini", model: cfg.geminiModel, configured: true };
  }
  if (cfg.hasMistralKey) {
    return { name: "Mistral", model: cfg.mistralModel, configured: true };
  }
  return null;
}

