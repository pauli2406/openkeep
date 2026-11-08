import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RotateCcw, Sparkles } from "lucide-react";
import Markdown from "react-markdown";
import { IconTile } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { authFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { consumeJsonSseResponse, isAbortError } from "@/lib/sse-stream";

type SummaryState = {
  status: "idle" | "loading" | "streaming" | "error";
  text: string;
  provider: string | null;
  model: string | null;
  error: string | null;
};

export function DocumentSummarySection({
  documentId,
  initialSummary,
  initialProvider,
  initialModel,
}: {
  documentId: string;
  initialSummary?: string | null;
  initialProvider?: string | null;
  initialModel?: string | null;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<SummaryState>({
    status: "idle",
    text: initialSummary ?? "",
    provider: initialProvider ?? null,
    model: initialModel ?? null,
    error: null,
  });
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const streamSummary = useCallback(
    async (force: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const generation = generationRef.current + 1;
      generationRef.current = generation;
      const update = (updater: (current: SummaryState) => SummaryState) => {
        if (generation === generationRef.current) setState(updater);
      };
      update((current) => ({
        ...current,
        status: "loading",
        text: force ? "" : current.text,
        error: null,
      }));

      try {
        const response = await authFetch(
          `/api/documents/${documentId}/summarize/stream${force ? "?force=true" : ""}`,
          { method: "POST", signal: controller.signal },
        );
        let terminalEvent = false;
        await consumeJsonSseResponse(response, (event, payload) => {
          if (generation !== generationRef.current) return "stop";
          if (event === "summary-token") {
            update((current) => ({
              ...current,
              status: "streaming",
              text:
                current.text +
                (typeof payload.text === "string" ? payload.text : ""),
            }));
          } else if (event === "cached" || event === "done") {
            terminalEvent = true;
            update((current) => ({
              ...current,
              status: "idle",
              text:
                typeof payload.summary === "string"
                  ? payload.summary
                  : current.text,
              provider:
                typeof payload.provider === "string"
                  ? payload.provider
                  : current.provider,
              model:
                typeof payload.model === "string"
                  ? payload.model
                  : current.model,
              error: null,
            }));
            return "stop";
          } else if (event === "error") {
            terminalEvent = true;
            update((current) => ({
              ...current,
              status: "error",
              error:
                typeof payload.message === "string"
                  ? payload.message
                  : t("documentDetail.summaryFailed"),
            }));
            return "stop";
          }
        });
        if (!terminalEvent && generation === generationRef.current) {
          update((current) => ({
            ...current,
            status: "error",
            error: t("documentDetail.summaryStreamEnded"),
          }));
        }
      } catch (error) {
        if (
          isAbortError(error, controller.signal) ||
          generation !== generationRef.current
        ) {
          return;
        }
        update((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : t("documentDetail.summaryFailed"),
        }));
      }
    },
    [documentId, t],
  );

  useEffect(() => {
    if (!initialSummary) void streamSummary(false);
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, [documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const streaming = state.status === "loading" || state.status === "streaming";

  return (
    <section className="flex flex-col gap-3 rounded-xl bg-brand-soft/60 p-4">
      <div className="flex items-center gap-2.5">
        <IconTile size="sm" tone="solid">
          <Sparkles />
        </IconTile>
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
          {t("documentDetail.generatedSummary")}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          disabled={streaming}
          onClick={() => void streamSummary(true)}
        >
          {streaming ? <Spinner /> : <RotateCcw />}
          {streaming
            ? t("documentDetail.summaryGenerating")
            : t("documentDetail.summaryRegenerate")}
        </Button>
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.text ? (
        <div className="typeset text-sm">
          <Markdown>{state.text}</Markdown>
          {state.status === "streaming" ? (
            <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse rounded-full bg-brand" />
          ) : null}
        </div>
      ) : streaming ? (
        <div
          className="flex flex-col gap-2"
          aria-label={t("documentDetail.summaryGenerating")}
        >
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-11/12 rounded-full" />
          <Skeleton className="h-3 w-3/5 rounded-full" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}

      {state.provider ? (
        <p className="text-xs text-muted-foreground">
          {t("documentDetail.provider")}: {state.provider}
          {state.model ? ` / ${state.model}` : ""}
        </p>
      ) : null}
    </section>
  );
}
