import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  CheckCircle,
  AlertCircle,
  Loader2,
  Brain,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { EMBEDDING_PROVIDER_LABELS, PARSE_PROVIDER_LABELS, resolveChatProvider } from "./shared";

export function AiProvidersSection() {
  const { language, t } = useI18n();
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchHealth"));
      }
      return data as HealthResponse;
    },
    refetchInterval: 30000,
  });

  const providersQuery = useQuery({
    queryKey: ["health", "providers"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/providers");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchProviders"));
      }
      return data as HealthProvidersResponse;
    },
    refetchInterval: 30000,
  });

  const cfg = healthQuery.data?.provider as ProviderConfig | undefined;
  const activeChat = cfg ? resolveChatProvider(cfg) : null;

  // All chat providers with their key status
  const chatProviders = cfg
    ? [
        { id: "openai", label: "OpenAI", model: cfg.openaiModel, hasKey: cfg.hasOpenAiKey },
        { id: "gemini", label: "Gemini", model: cfg.geminiModel, hasKey: cfg.hasGeminiKey },
        { id: "mistral", label: "Mistral", model: cfg.mistralModel, hasKey: cfg.hasMistralKey },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5" />
          {t("settings.aiProviders")}
        </CardTitle>
        <CardDescription>
          {t("settings.aiProvidersDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {healthQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.loadingProviderConfiguration")}
          </div>
        )}

        {healthQuery.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {t("settings.unableToLoadProviderConfiguration")}
          </div>
        )}

        {cfg && (
          <>
            {/* Active Chat Model */}
            <div>
              <p className="mb-2 text-sm font-medium">{t("settings.chatModel")}</p>
              {activeChat ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-[var(--ok-green)]" />
                    <span className="text-sm font-medium">{activeChat.name}</span>
                    {activeChat.model && (
                      <Badge variant="secondary">{activeChat.model}</Badge>
                    )}
                  </div>
                  <Badge variant="success">{t("settings.active")}</Badge>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  {t("settings.noChatProviderConfigured")}
                </div>
              )}
            </div>

            {/* All Chat Providers */}
            <div>
              <p className="mb-2 text-sm font-medium">{t("settings.chatProviders")}</p>
              <div className="space-y-2">
                {chatProviders.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      {p.hasKey ? (
                        <CheckCircle className="h-4 w-4 text-[var(--ok-green)]" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm">{p.label}</span>
                      {p.hasKey && p.model && (
                        <Badge variant="outline">{p.model}</Badge>
                      )}
                    </div>
                    <Badge variant={p.hasKey ? "success" : "secondary"}>
                      {p.hasKey ? t("settings.configured") : t("settings.notConfigured")}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Embedding Providers */}
            {providersQuery.data && (
              <div>
                <p className="mb-2 text-sm font-medium">{t("settings.embeddingProviders")}</p>
                <div className="space-y-2">
                  {providersQuery.data.embeddingProviders.map((ep) => (
                    <div
                      key={ep.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {ep.available ? (
                          <CheckCircle className="h-4 w-4 text-[var(--ok-green)]" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">
                          {EMBEDDING_PROVIDER_LABELS[ep.id] ?? ep.id}
                        </span>
                        {ep.model && (
                          <Badge variant="outline">{ep.model}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {ep.id === cfg.activeEmbeddingProvider && (
                          <Badge variant="success">{t("settings.active")}</Badge>
                        )}
                        <Badge variant={ep.available ? "success" : "secondary"}>
                          {ep.available ? t("settings.available") : t("settings.notConfigured")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Parse Providers */}
            {providersQuery.data && (
              <div>
                <p className="mb-2 text-sm font-medium">{t("settings.parseProviders")}</p>
                <div className="space-y-2">
                  {providersQuery.data.parseProviders.map((pp) => (
                    <div
                      key={pp.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {pp.available ? (
                          <CheckCircle className="h-4 w-4 text-[var(--ok-green)]" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="text-sm">
                          {PARSE_PROVIDER_LABELS[pp.id] ?? pp.id}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {pp.id === cfg.activeParseProvider && (
                          <Badge variant="success">{t("settings.active")}</Badge>
                        )}
                        {pp.id === cfg.fallbackParseProvider && (
                          <Badge variant="warning">{t("settings.fallback")}</Badge>
                        )}
                        <Badge variant={pp.available ? "success" : "secondary"}>
                          {pp.available ? t("settings.available") : t("settings.notConfigured")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Processing mode */}
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{t("settings.processingMode")}</span>
              <Badge variant="outline">{cfg.mode}</Badge>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// --- System Health ---

