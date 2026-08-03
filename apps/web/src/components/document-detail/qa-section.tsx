import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { AlertTriangle, Loader2, Quote, Send, Trash2 } from "lucide-react";
import { createSseParser } from "@openkeep/sdk";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { authFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type QaStreamState = {
  status: "idle" | "loading" | "streaming" | "done" | "error";
  answerText: string;
  citations: Array<{
    chunkIndex: number;
    pageFrom: number | null;
    pageTo: number | null;
    quote: string;
    score: number;
  }>;
  errorMessage: string | null;
};

export function DocumentQaSection({
  documentId,
}: {
  documentId: string;
}) {
  const { t } = useI18n();
  // ─── Q&A state ───
  const [qa, setQa] = useState<QaStreamState>({
    status: "idle",
    answerText: "",
    citations: [],
    errorMessage: null,
  });
  const qaAbortRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState("");

  // ─── Q&A history ───
  const [qaHistory, setQaHistory] = useState<
    Array<{ question: string; answer: string; citations: QaStreamState["citations"] }>
  >([]);

  // ─── Load persisted Q&A history on mount ───
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch(`/api/documents/${documentId}/qa-history`);
        if (res.ok) {
          const entries = await res.json();
          setQaHistory(
            entries.map((e: { question: string; answer: string; citations: QaStreamState["citations"] }) => ({
              question: e.question,
              answer: e.answer,
              citations: e.citations,
            })),
          );
        }
      } catch {
        // Non-critical — history simply starts empty
      }
    })();
    return () => {
      qaAbortRef.current?.abort();
    };
  }, [documentId]);

  // ─── Stream Q&A ───
  const streamQa = useCallback(
    async (q: string) => {
      qaAbortRef.current?.abort();
      const controller = new AbortController();
      qaAbortRef.current = controller;

      setQa({
        status: "loading",
        answerText: "",
        citations: [],
        errorMessage: null,
      });

      try {
        const response = await authFetch(
          `/api/documents/${documentId}/ask/stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question: q }),
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const reader = response.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        const parser = createSseParser((currentEvent, data) => {
          {
            {
              try {
                const parsed = JSON.parse(data);

                if (currentEvent === "citations") {
                  setQa((s) => ({
                    ...s,
                    status: "streaming",
                    citations: parsed.citations ?? [],
                  }));
                } else if (currentEvent === "answer-token") {
                  setQa((s) => ({
                    ...s,
                    status: "streaming",
                    answerText: s.answerText + (parsed.text ?? ""),
                  }));
                } else if (currentEvent === "done") {
                  setQa((s) => {
                    const finalAnswer = parsed.answer ?? s.answerText;
                    const finalCitations = parsed.citations ?? s.citations;
                    // Add to local history. The server persists the entry at
                    // stream end and reports historyEntryId; when that is absent
                    // (older API, or a failed server-side write) fall back to the
                    // deprecated client write so the turn is not lost on reload.
                    if (finalAnswer) {
                      setQaHistory((h) => [
                        ...h,
                        {
                          question: q,
                          answer: finalAnswer,
                          citations: finalCitations,
                        },
                      ]);

                      if (!parsed.historyEntryId) {
                        authFetch(`/api/documents/${documentId}/qa-history`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            question: q,
                            answer: finalAnswer,
                            citations: finalCitations,
                          }),
                        }).catch(() => {});
                      }
                    }
                    // Reset to idle so the answer only shows in the history list
                    return {
                      status: "idle",
                      answerText: "",
                      citations: [],
                      errorMessage: null,
                    };
                  });
                } else if (currentEvent === "error") {
                  setQa((s) => ({
                    ...s,
                    status: "error",
                    errorMessage: parsed.message,
                  }));
                }
              } catch {
                // skip malformed
              }
            }
          }
        });

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        parser.flush();
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setQa((s) => ({
          ...s,
          status: "error",
          errorMessage: err instanceof Error ? err.message : t("documentDetail.failedToAnswer"),
        }));
      }
    },
    [documentId, t],
  );

  function handleAskSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (q.length === 0) return;
    setQuestion("");
    streamQa(q);
  }

  const isQaStreaming = qa.status === "loading" || qa.status === "streaming";

  return (
    <div className="space-y-4">
      {/* ─── Q&A Section ─── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Quote className="h-4 w-4 text-[var(--ok-accent)]" />
              {t("documentDetail.askAboutDocument")}
            </CardTitle>
            {qaHistory.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setQaHistory([]);
                  authFetch(`/api/documents/${documentId}/qa-history`, {
                    method: "DELETE",
                  }).catch(() => {});
                }}
              >
                <Trash2 className="h-3 w-3" />
                {t("documentDetail.clearHistory")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Q&A history */}
          {qaHistory.length > 0 && (
            <div className="space-y-3">
              {qaHistory.map((entry, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-[var(--explorer-border)] bg-[var(--ok-app)] px-3.5 py-3"
                >
                  <p className="text-sm font-medium text-foreground">{entry.question}</p>
                  <div className="mt-2 prose prose-sm max-w-none text-muted-foreground prose-p:leading-relaxed">
                    <Markdown>{entry.answer}</Markdown>
                  </div>
                  {entry.citations.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-[var(--explorer-border)] pt-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {t("documentDetail.referencedExcerpts")}
                      </p>
                      {entry.citations.map((cit, ci) => (
                        <div
                          key={ci}
                          className="rounded-md border border-[var(--explorer-border)] bg-card px-3 py-2"
                        >
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {cit.quote}
                          </p>
                          {(cit.pageFrom || cit.pageTo) && (
                            <span className="mt-0.5 inline-block text-[10px] text-muted-foreground/60">
                              {t("documentDetail.pageWord")} {cit.pageFrom ?? cit.pageTo}
                              {cit.pageTo && cit.pageTo !== cit.pageFrom
                                ? `\u2013${cit.pageTo}`
                                : ""}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Current answer stream */}
          {(qa.status === "loading" || qa.status === "streaming" || qa.status === "error") && (
              <div className="rounded-lg border border-[var(--ok-accent-soft)] bg-[var(--ok-accent-soft)] px-4 py-3">
                {qa.status === "loading" && (
                  <div className="flex items-center gap-2.5 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--ok-accent)]" />
                    <span className="text-sm">{t("documentDetail.searchingChunks")}</span>
                  </div>
                )}

                {qa.status === "error" && (
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ok-amber)]" />
                    <p className="text-sm text-[var(--ok-amber)]">
                      {qa.errorMessage ?? t("documentDetail.failedToAnswer")}
                    </p>
                  </div>
                )}

                {qa.status === "streaming" && (
                  <div>
                    <div className="prose prose-sm max-w-none text-foreground prose-headings:font-semibold prose-p:leading-relaxed prose-strong:text-foreground">
                      <Markdown>{qa.answerText}</Markdown>
                      <span className="inline-block h-4 w-1.5 animate-pulse rounded-full bg-[var(--ok-accent)]" />
                    </div>
                  </div>
                )}
              </div>
            )}

          {/* Question input */}
          <form onSubmit={handleAskSubmit} className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t("documentDetail.askQuestionPlaceholder")}
              disabled={isQaStreaming}
              className="h-10 flex-1 rounded-lg border-[var(--explorer-border-strong)] bg-card text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={isQaStreaming || question.trim().length === 0}
              className="h-10 gap-1.5 rounded-lg px-4"
            >
              {isQaStreaming ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t("documentDetail.ask")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
