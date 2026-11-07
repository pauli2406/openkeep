import type { ReactNode } from "react";
import type {
  Document,
  ProviderConfig,
  WatchFolderScanResponse,
} from "@openkeep/types";
import { AlertCircle, Check, Copy } from "lucide-react";
import { format } from "date-fns";
import { IconTile } from "@/components/layout/page";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription } from "@/components/ui/item";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useI18n, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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


/** The heading of one settings destination, under the shell's page title. */
export function SettingsHeading({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

/** A settings section: a card with a title row, a body and an optional footer. */
export function SectionCard({
  icon,
  title,
  description,
  action,
  footer,
  headingLevel = "h3",
  className,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  headingLevel?: "h2" | "h3";
  className?: string;
  children: ReactNode;
}) {
  const Heading = headingLevel;
  return (
    <Card className={cn("gap-0 py-0 shadow-card", className)}>
      <div className="flex flex-wrap items-start gap-x-3.5 gap-y-3 border-b px-5 py-4">
        <div
          className={cn(
            "flex min-w-0 flex-1 basis-56 gap-3.5",
            description ? "items-start" : "items-center",
          )}
        >
          {icon ? <IconTile>{icon}</IconTile> : null}
          <div className="min-w-0">
            <Heading className="font-medium">{title}</Heading>
            {description ? (
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      <div className="px-5 py-5">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center gap-3 border-t bg-muted/40 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

/** Label on the left, control on the right; stacks on a phone. */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Item className="flex-col items-stretch gap-x-6 gap-y-2 rounded-none px-0 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <ItemContent className="min-w-0 gap-0.5">
        <Label htmlFor={htmlFor} className="font-medium">
          {label}
        </Label>
        {description ? (
          <ItemDescription className="line-clamp-none text-xs">{description}</ItemDescription>
        ) : null}
      </ItemContent>
      <ItemActions className="shrink-0">{children}</ItemActions>
    </Item>
  );
}

export type StatusTone = "ok" | "warn" | "bad" | "muted" | "brand";

const DOT_CLASS: Record<StatusTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-danger",
  muted: "bg-muted-foreground/40",
  brand: "bg-brand",
};

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", DOT_CLASS[tone], className)}
    />
  );
}

const BADGE_VARIANT = {
  ok: "success",
  warn: "warning",
  bad: "danger",
  muted: "secondary",
  brand: "brand",
} as const;

/** A soft pill with a dot: the one way these screens say how something is doing. */
export function StatusBadge({
  tone,
  className,
  children,
}: {
  tone: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge variant={BADGE_VARIANT[tone]} className={className}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {/* Sentence case without `capitalize`, which would give "Nicht Konfiguriert". */}
      <span className="inline-block first-letter:uppercase">{children}</span>
    </Badge>
  );
}

/** A number with a label. `tone` tints it when the number wants attention. */
export function StatTile({
  label,
  value,
  note,
  tone = "default",
  loading = false,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: "default" | "brand" | "warning" | "danger";
  loading?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border p-3.5 transition-colors",
        tone === "brand" && "border-transparent bg-brand-soft",
        tone === "warning" && "border-transparent bg-warning-soft",
        tone === "danger" && "border-transparent bg-danger-soft",
      )}
    >
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="mt-1.5 h-7 w-12" />
      ) : (
        <p
          className={cn(
            "num mt-0.5 text-2xl font-semibold tracking-tight",
            tone === "brand" && "text-brand-soft-foreground",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-danger",
          )}
        >
          {value}
        </p>
      )}
      {note ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
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
    <StatTile
      label={label}
      value={value}
      tone={active ? (variant === "warning" ? "warning" : "brand") : "default"}
    />
  );
}

/** A failure with a way out. */
export function RetryAlert({
  message,
  onRetry,
  className,
}: {
  message: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Alert variant="destructive" className={cn(onRetry && "pr-36", className)}>
      <AlertCircle />
      <AlertDescription>{message}</AlertDescription>
      {onRetry ? (
        <AlertAction>
          <Button variant="outline" size="xs" onClick={onRetry}>
            {t("settings.retry")}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

/** Placeholder rows for a list that is on its way. */
export function RowsSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-label={t("root.loading")}
      className={cn("flex flex-col gap-2.5", className)}
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** A secret shown once: highlighted, monospaced and one click from the clipboard. */
export function SecretBlock({
  value,
  copied,
  onCopy,
}: {
  value: string;
  copied?: boolean;
  onCopy?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-2 rounded-lg bg-brand-soft p-3 ring-1 ring-brand/25">
      <code className="min-w-0 flex-1 self-center font-mono text-sm break-all text-brand-soft-foreground">
        {value}
      </code>
      {onCopy ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("settings.copy")}
          onClick={onCopy}
          className="shrink-0"
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      ) : null}
    </div>
  );
}

/** The warning that goes with a one-time reveal. */
export function ShownOnceNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
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
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        {t("settings.loadingExtractedFields")}
      </p>
    );
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
    <div className="flex flex-col gap-3">
      {document.metadata.reviewEvidence?.confidence != null && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            {t("settings.confidence")}:{" "}
            <span className={confidenceTextClass(document.metadata.reviewEvidence.confidence)}>
              <span className="num">{(document.metadata.reviewEvidence.confidence * 100).toFixed(0)}%</span>
            </span>
          </span>
          {document.metadata.reviewEvidence.confidenceThreshold != null && (
            <span>
              {t("settings.threshold")}:{" "}
              <span className="num">
                {(document.metadata.reviewEvidence.confidenceThreshold * 100).toFixed(0)}%
              </span>
            </span>
          )}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("settings.foundValues")}</p>
          <div className="mt-2 grid gap-2">
            {foundFields.length > 0 ? (
              foundFields.map(({ field, value }) => (
                <div key={field} className="rounded-lg bg-muted px-3 py-2">
                  <p className="text-xs text-muted-foreground">
                    {formatWatchFolderFieldLabel(field)}
                  </p>
                  <p className="num text-sm font-medium">{value}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("settings.noKeyFieldsFound")}</p>
            )}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {t("settings.missingKeyFields")}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
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
  if (confidence >= 0.8) return "font-medium text-success";
  if (confidence >= 0.5) return "font-medium text-warning";
  return "font-medium text-danger";
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

