import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import Markdown from "react-markdown";
import { Button } from "@/components/ui/button";
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
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {t("documentDetail.generatedSummary")}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={streaming}
          onClick={() => void streamSummary(true)}
        >
          {streaming ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" />
          )}
          {streaming
            ? t("documentDetail.summaryGenerating")
            : t("documentDetail.summaryRegenerate")}
        </Button>
      </div>

      {state.error ? (
        <div className="flex items-start gap-2 rounded-md bg-[var(--ok-amber-soft)] px-2.5 py-2 text-xs text-[var(--ok-amber)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{state.error}</span>
        </div>
      ) : null}

      {state.text ? (
        <div className="prose prose-sm max-w-none text-sm prose-p:my-1 prose-ul:my-1">
          <Markdown>{state.text}</Markdown>
          {state.status === "streaming" ? (
            <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse rounded-full bg-[var(--ok-accent)]" />
          ) : null}
        </div>
      ) : streaming ? (
        <div
          className="space-y-1.5"
          aria-label={t("documentDetail.summaryGenerating")}
        >
          <span className="block h-2 animate-pulse rounded bg-secondary" />
          <span className="block h-2 w-4/5 animate-pulse rounded bg-secondary" />
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
    </div>
  );
}
