import { useQuery } from "@tanstack/react-query";
import type {
  HealthProvidersResponse,
  HealthResponse,
  ProcessingStatusResponse,
} from "@openkeep/types";
import { BrainCircuit, FileScan, ListChecks, MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CHAT_PROVIDER_LABELS,
  EMBEDDING_PROVIDER_LABELS,
  PARSE_PROVIDER_LABELS,
  RetryAlert,
  SectionCard,
  StatTile,
  StatusBadge,
  StatusDot,
  type StatusTone,
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

const TONE_DOT: Record<Tone, StatusTone> = {
  active: "brand",
  fallback: "warn",
  available: "ok",
  incomplete: "warn",
  unconfigured: "muted",
  failed: "bad",
};

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
      <div className="flex flex-col gap-5" role="status" aria-label={t("root.loading")}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    );
  }

  const cfg = healthQuery.data?.provider;
  const providers = providersQuery.data;
  const status = statusQuery.data;

  if (!cfg || !providers || !status) {
    return (
      <RetryAlert
        message={copy.loadError}
        onRetry={() => {
          void healthQuery.refetch();
          void providersQuery.refetch();
          void statusQuery.refetch();
        }}
      />
    );
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
    icon: ReactNode;
    rows: ProviderRow[];
  }> = [
    {
      title: copy.parsing,
      sub: copy.parsingSub,
      icon: <FileScan />,
      summary: copy.activeSummary(providers.activeParseProvider),
      rows: parseRows,
    },
    {
      title: copy.embeddings,
      sub: copy.embeddingsSub,
      icon: <BrainCircuit />,
      summary: providers.activeEmbeddingProvider
        ? copy.activeSummary(providers.activeEmbeddingProvider)
        : copy.none,
      rows: embeddingRows,
    },
    {
      title: copy.chat,
      sub: copy.chatSub,
      icon: <MessageSquareText />,
      summary: providers.activeChatProvider
        ? copy.activeSummary(providers.activeChatProvider)
        : copy.none,
      rows: chatRows,
    },
  ];

  // Active and fallback both imply "available", so each tile carries one pill.
  const badgeFor = (tone: Tone) =>
    tone === "active" ? (
      <Badge>{copy.active}</Badge>
    ) : tone === "fallback" ? (
      <Badge variant="warning">{copy.fallback}</Badge>
    ) : tone === "incomplete" ? (
      <Badge variant="warning">{copy.incomplete}</Badge>
    ) : tone === "unconfigured" ? (
      <Badge variant="outline" className="text-muted-foreground">
        {copy.notConfigured}
      </Badge>
    ) : (
      <Badge variant="success">{copy.available}</Badge>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={copy.processingQueue} value={status.queues.processing.depth} />
        <StatTile
          label={copy.embeddingQueue}
          value={status.queues.embedding.depth}
          note={providers.activeEmbeddingProvider}
        />
        <StatTile
          label={copy.failedToday}
          value={failedToday}
          tone={failedToday > 0 ? "danger" : "default"}
        />
        <StatTile
          label={copy.avgPerDoc}
          value={avgSeconds != null ? `${avgSeconds}s` : "—"}
        />
      </div>

      {groups.map((group) => (
        <SectionCard
          key={group.title}
          icon={group.icon}
          title={group.title}
          description={group.sub}
          action={
            <span className="font-mono text-xs text-muted-foreground">{group.summary}</span>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {group.rows.map((row) => (
              <div
                key={row.id}
                className={cn(
                  "flex min-w-0 flex-col gap-3 rounded-xl border p-3.5",
                  row.tone === "active" &&
                    "border-transparent bg-brand-soft ring-2 ring-brand/40",
                  row.tone === "unconfigured" && "bg-muted/40",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <StatusDot tone={TONE_DOT[row.tone]} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        row.tone === "unconfigured" && "text-muted-foreground",
                        row.tone === "active" && "text-brand-soft-foreground",
                      )}
                    >
                      {row.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{row.note}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pl-[1.125rem]">
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {row.model ?? "—"}
                  </span>
                  {badgeFor(row.tone)}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}

      <Card className="gap-0 py-0 shadow-card">
        <div className="border-b px-5 py-4">
          <h3 className="font-medium">{copy.recentJobs}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{copy.recentJobsSub}</p>
        </div>
        {status.recentJobs.length === 0 ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecks />
              </EmptyMedia>
              <EmptyDescription>{copy.noJobs}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableBody>
              {status.recentJobs.slice(0, 8).map((job) => {
                const duration = jobDuration(job.startedAt, job.finishedAt);
                return (
                  <TableRow key={job.id}>
                    <TableCell className="pl-5 font-mono text-xs">
                      {job.documentId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">
                      {job.queueName}
                    </TableCell>
                    <TableCell className="num text-right text-xs text-muted-foreground">
                      {duration != null ? `${(duration / 1000).toFixed(1)}s` : copy.running}
                    </TableCell>
                    <TableCell className="w-px pr-5 text-right">
                      <StatusBadge
                        tone={
                          job.status === "failed"
                            ? "bad"
                            : job.status === "completed"
                              ? "ok"
                              : job.status === "running"
                                ? "brand"
                                : "muted"
                        }
                      >
                        {job.status === "failed"
                          ? copy.failed
                          : job.status === "completed"
                            ? copy.done
                            : job.status === "running"
                              ? copy.running
                              : copy.queued}
                      </StatusBadge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
