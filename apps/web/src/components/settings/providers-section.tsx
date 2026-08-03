import { useQuery } from "@tanstack/react-query";
import type {
  HealthProvidersResponse,
  HealthResponse,
  ProcessingStatusResponse,
} from "@openkeep/types";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CHAT_PROVIDER_LABELS,
  EMBEDDING_PROVIDER_LABELS,
  PARSE_PROVIDER_LABELS,
} from "./shared";

type Tone =
  | "active"
  | "fallback"
  | "available"
  | "incomplete"
  | "unconfigured"
  | "failed";

type ProviderRow = {
  id: string;
  name: string;
  note: string;
  model: string | null;
  tone: Tone;
};

function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "h-2 w-2 flex-shrink-0 rounded-full",
        tone === "failed"
          ? "bg-[var(--ok-red)]"
          : tone === "incomplete"
            ? "bg-[var(--ok-amber)]"
            : tone === "unconfigured"
              ? "bg-[var(--ok-border-strong)]"
              : "bg-[var(--ok-green)]",
      )}
    />
  );
}

function jobDuration(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null;
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function AiProvidersSection() {
  const { language, t } = useI18n();

  const copy =
    language === "de"
      ? {
          processingQueue: "Verarbeitungswarteschlange",
          embeddingQueue: "Embedding-Warteschlange",
          failedToday: "Zuletzt fehlgeschlagen",
          avgPerDoc: "Ø pro Dokument",
          parsing: "Parsing",
          parsingSub: "OCR und Textextraktion",
          embeddings: "Embeddings",
          embeddingsSub: "Vektorindex für semantische Suche",
          chat: "Chat",
          chatSub: "Antworten in Suche und Omnibar",
          active: "Aktiv",
          fallback: "Fallback",
          available: "Verfügbar",
          incomplete: "Unvollständig",
          notConfigured: "Nicht konfiguriert",
          activeSummary: (n: string) => `${n} aktiv`,
          none: "keiner aktiv",
          recentJobs: "Letzte Jobs",
          recentJobsSub: "Über beide Warteschlangen.",
          localNote: "Läuft auf diesem Rechner",
          cloudNote: "Cloud · Dokumente verlassen den Rechner",
          keyStored: "Schlüssel hinterlegt",
          noKey: "Kein Schlüssel hinterlegt",
          onlyText: "Nur extrahierter Text wird gesendet",
          running: "Läuft",
          done: "Fertig",
          failed: "Fehlgeschlagen",
          queued: "Wartend",
          loadError: "Anbieterstatus konnte nicht geladen werden.",
          noJobs: "Keine Jobs in letzter Zeit.",
        }
      : {
          processingQueue: "Processing queue",
          embeddingQueue: "Embedding queue",
          failedToday: "Failed recently",
          avgPerDoc: "Avg. per document",
          parsing: "Parsing",
          parsingSub: "OCR and text extraction",
          embeddings: "Embeddings",
          embeddingsSub: "Vector index for semantic search",
          chat: "Chat",
          chatSub: "Answers in search and the omnibar",
          active: "Active",
          fallback: "Fallback",
          available: "Available",
          incomplete: "No model set",
          notConfigured: "Not configured",
          activeSummary: (n: string) => `${n} active`,
          none: "none active",
          recentJobs: "Recent jobs",
          recentJobsSub: "Across both queues.",
          localNote: "Runs on this machine",
          cloudNote: "Cloud · documents leave the machine",
          keyStored: "Key stored",
          noKey: "No key stored",
          onlyText: "Only extracted text is sent",
          running: "Running",
          done: "Done",
          failed: "Failed",
          queued: "Queued",
          loadError: "Failed to load provider status.",
          noJobs: "No recent jobs.",
        };

  const healthQuery = useQuery({
    queryKey: ["health", "config"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health");
      if (!response.ok || error || !data) throw new Error(copy.loadError);
      return data as HealthResponse;
    },
    refetchInterval: 30_000,
  });

  const providersQuery = useQuery({
    queryKey: ["health", "providers"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/providers");
      if (!response.ok || error || !data) throw new Error(copy.loadError);
      return data as unknown as HealthProvidersResponse;
    },
    refetchInterval: 30_000,
  });

  const statusQuery = useQuery({
    queryKey: ["health", "processing-status"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/status");
      if (!response.ok || error || !data) throw new Error(copy.loadError);
      return data as unknown as ProcessingStatusResponse;
    },
    refetchInterval: 15_000,
  });

  if (healthQuery.isLoading || providersQuery.isLoading || statusQuery.isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const cfg = healthQuery.data?.provider;
  const providers = providersQuery.data;
  const status = statusQuery.data;

  if (!cfg || !providers || !status) {
    return <p className="py-6 text-center text-sm text-[var(--ok-red)]">{copy.loadError}</p>;
  }

  // ---- the four numbers ----
  // /api/health/status returns only the newest jobs, so this counts failures
  // in that window, not "today" across the archive. The label says so.
  const failedToday = status.recentJobs.filter((job) => job.status === "failed").length;
  const durations = status.recentJobs
    .map((job) => jobDuration(job.startedAt, job.finishedAt))
    .filter((ms): ms is number => ms !== null);
  const avgSeconds = durations.length
    ? (durations.reduce((sum, ms) => sum + ms, 0) / durations.length / 1000).toFixed(1)
    : null;

  // ---- provider rows ----
  const parseConfigured: Record<string, boolean> = {
    "local-ocr": true,
    "amazon-textract": cfg.hasAwsTextractConfig,
    "azure-ai-document-intelligence": cfg.hasAzureDocumentIntelligenceConfig,
    "google-document-ai-enterprise-ocr": cfg.hasGoogleCloudConfig,
    "google-document-ai-gemini-layout-parser": cfg.hasGoogleCloudConfig,
    "mistral-ocr": cfg.hasMistralOcrConfig,
  };
  const parseRows: ProviderRow[] = providers.parseProviders.map((provider) => {
    const configured = parseConfigured[provider.id] ?? false;
    const tone: Tone = !configured
      ? "unconfigured"
      : !provider.available
        ? "incomplete"
        : provider.id === providers.activeParseProvider
          ? "active"
          : provider.id === providers.fallbackParseProvider
            ? "fallback"
            : "available";
    return {
      id: provider.id,
      name: PARSE_PROVIDER_LABELS[provider.id] ?? provider.id,
      note: provider.id === "local-ocr" ? copy.localNote : copy.cloudNote,
      model: provider.id === "local-ocr" ? "tesseract" : provider.id,
      tone,
    };
  });

  const embeddingConfigured: Record<string, boolean> = {
    openai: cfg.hasOpenAiKey,
    "google-gemini": cfg.hasGeminiKey,
    voyage: cfg.hasVoyageKey,
    mistral: cfg.hasMistralEmbeddingConfig,
  };
  const embeddingRows: ProviderRow[] = providers.embeddingProviders.map((provider) => {
    const configured = embeddingConfigured[provider.id] ?? false;
    const tone: Tone = !configured
      ? "unconfigured"
      : !provider.available
        ? "incomplete"
        : provider.id === providers.activeEmbeddingProvider
          ? "active"
          : "available";
    return {
      id: provider.id,
      name: EMBEDDING_PROVIDER_LABELS[provider.id] ?? provider.id,
      note: copy.cloudNote,
      model: provider.model,
      tone,
    };
  });

  const chatRows: ProviderRow[] = (
    [
      ["openai", cfg.hasOpenAiKey, cfg.openaiModel],
      ["gemini", cfg.hasGeminiKey, cfg.geminiModel],
      ["mistral", cfg.hasMistralKey, cfg.mistralModel],
    ] as Array<[string, boolean, string | undefined]>
  ).map(([id, hasKey, model]) => ({
    id,
    name: CHAT_PROVIDER_LABELS[id] ?? id,
    note: hasKey
      ? id === providers.activeChatProvider
        ? copy.onlyText
        : copy.keyStored
      : copy.noKey,
    model: model ?? null,
    tone: !hasKey
      ? "unconfigured"
      : id === providers.activeChatProvider
        ? "active"
        : "available",
  }));

  const groups: Array<{
    title: string;
    sub: string;
    summary: string;
    rows: ProviderRow[];
  }> = [
    {
      title: copy.parsing,
      sub: copy.parsingSub,
      summary: copy.activeSummary(providers.activeParseProvider),
      rows: parseRows,
    },
    {
      title: copy.embeddings,
      sub: copy.embeddingsSub,
      summary: providers.activeEmbeddingProvider
        ? copy.activeSummary(providers.activeEmbeddingProvider)
        : copy.none,
      rows: embeddingRows,
    },
    {
      title: copy.chat,
      sub: copy.chatSub,
      summary: providers.activeChatProvider
        ? copy.activeSummary(providers.activeChatProvider)
        : copy.none,
      rows: chatRows,
    },
  ];

  const badgeFor = (tone: Tone) =>
    tone === "active" ? (
      <span className="rounded-[var(--r-sm)] bg-accent px-[7px] py-px text-[11px] font-semibold text-accent-foreground">
        {copy.active}
      </span>
    ) : tone === "fallback" ? (
      <span className="rounded-[var(--r-sm)] bg-[var(--ok-amber-soft)] px-[7px] py-px text-[11px] font-semibold text-[var(--ok-amber)]">
        {copy.fallback}
      </span>
    ) : null;

  const availabilityFor = (tone: Tone) =>
    tone === "incomplete" ? (
      <span className="rounded-[var(--r-sm)] bg-[var(--ok-amber-soft)] px-[7px] py-px text-[11px] font-semibold text-[var(--ok-amber)]">
        {copy.incomplete}
      </span>
    ) : tone === "unconfigured" ? (
      <span className="rounded-[var(--r-sm)] border px-[7px] py-px text-[11px] font-semibold text-muted-foreground">
        {copy.notConfigured}
      </span>
    ) : (
      <span className="rounded-[var(--r-sm)] border px-[7px] py-px text-[11px] font-semibold text-muted-foreground">
        {copy.available}
      </span>
    );

  return (
    <div className="space-y-4">
      {/* The four numbers */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {[
          {
            label: copy.processingQueue,
            value: String(status.queues.processing.depth),
            note: null,
          },
          {
            label: copy.embeddingQueue,
            value: String(status.queues.embedding.depth),
            note: providers.activeEmbeddingProvider,
          },
          {
            label: copy.failedToday,
            value: String(failedToday),
            note: null,
            bad: failedToday > 0,
          },
          {
            label: copy.avgPerDoc,
            value: avgSeconds != null ? `${avgSeconds}s` : "—",
            note: null,
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-[var(--r-lg)] border bg-card px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{stat.label}</p>
            <p
              className={cn(
                "ok-num mt-0.5 text-xl font-semibold",
                "bad" in stat && stat.bad && "text-[var(--ok-red)]",
              )}
            >
              {stat.value}
            </p>
            {stat.note ? (
              <p className="ok-num truncate text-xs text-muted-foreground">{stat.note}</p>
            ) : null}
          </div>
        ))}
      </div>

      {/* Grouped provider panels */}
      {groups.map((group) => (
        <div key={group.title} className="overflow-hidden rounded-[var(--r-lg)] border bg-card">
          <div className="flex items-center gap-2 border-b bg-[var(--ok-bar)] px-3.5 py-2">
            <div className="min-w-0">
              <p className="ok-section-title">{group.title}</p>
              <p className="text-xs text-muted-foreground">{group.sub}</p>
            </div>
            <span className="ok-num ml-auto flex-shrink-0 text-xs text-muted-foreground">
              {group.summary}
            </span>
          </div>
          {group.rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 border-b border-[var(--ok-border-soft)] px-3.5 py-2.5 last:border-b-0"
            >
              <StatusDot tone={row.tone} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">{row.note}</p>
              </div>
              <span className="ok-num hidden w-52 flex-shrink-0 truncate text-sm text-muted-foreground md:block">
                {row.model ?? "—"}
              </span>
              <span className="flex w-44 flex-shrink-0 items-center justify-end gap-1.5">
                {badgeFor(row.tone)}
                {availabilityFor(row.tone)}
              </span>
            </div>
          ))}
        </div>
      ))}

      {/* Recent jobs */}
      <div className="overflow-hidden rounded-[var(--r-lg)] border bg-card">
        <div className="border-b bg-[var(--ok-bar)] px-3.5 py-2">
          <p className="ok-section-title">{copy.recentJobs}</p>
          <p className="text-xs text-muted-foreground">{copy.recentJobsSub}</p>
        </div>
        {status.recentJobs.length === 0 ? (
          <p className="px-3.5 py-4 text-center text-sm text-muted-foreground">
            {copy.noJobs}
          </p>
        ) : (
          status.recentJobs.slice(0, 8).map((job) => {
            const duration = jobDuration(job.startedAt, job.finishedAt);
            return (
              <div
                key={job.id}
                className="flex items-center gap-3 border-b border-[var(--ok-border-soft)] px-3.5 py-2 last:border-b-0"
              >
                <StatusDot
                  tone={
                    job.status === "failed"
                      ? "failed"
                      : job.status === "completed"
                        ? "available"
                        : "active"
                  }
                />
                <span className="ok-num min-w-0 flex-1 truncate text-sm">
                  {job.documentId.slice(0, 8)}
                </span>
                <span className="ok-num hidden w-44 flex-shrink-0 truncate text-xs text-muted-foreground sm:block">
                  {job.queueName}
                </span>
                <span className="ok-num w-16 flex-shrink-0 text-right text-xs text-muted-foreground">
                  {duration != null ? `${(duration / 1000).toFixed(1)}s` : copy.running}
                </span>
                <span
                  className={cn(
                    "w-24 flex-shrink-0 text-right text-[11px] font-semibold",
                    job.status === "failed"
                      ? "text-[var(--ok-red)]"
                      : job.status === "completed"
                        ? "text-[var(--ok-green)]"
                        : "text-muted-foreground",
                  )}
                >
                  {job.status === "failed"
                    ? copy.failed
                    : job.status === "completed"
                      ? copy.done
                      : job.status === "running"
                        ? copy.running
                        : copy.queued}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
