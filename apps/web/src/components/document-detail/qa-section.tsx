import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpIcon,
  CircleCheckIcon,
  CopyIcon,
  FileTextIcon,
  LoaderCircleIcon,
  SearchIcon,
  Sparkles,
  Trash2,
  TriangleAlertIcon,
} from "lucide-react";
import type { AnswerCitation } from "@openkeep/types";
import { AnswerMarkdown } from "@/components/chat/answer-markdown";
import { IconTile } from "@/components/layout/page";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { authFetch } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { consumeJsonSseResponse, isAbortError } from "@/lib/sse-stream";

/** A document-scoped citation: it never names a document, this one is implied. */
type QaCitation = {
  chunkIndex: number;
  pageFrom: number | null;
  pageTo: number | null;
  // 1-based excerpt number matching the [n] markers; absent on legacy entries.
  index?: number;
  used?: boolean;
  quote: string;
  score: number;
};

type QaStreamState = {
  status: "idle" | "loading" | "streaming" | "done" | "error";
  answerText: string;
  citations: QaCitation[];
  errorMessage: string | null;
};

export function DocumentQaSection({
  documentId,
  documentTitle,
  onOpenPage,
}: {
  documentId: string;
  documentTitle: string;
  /** Shows a cited page in the viewer next to the thread. */
  onOpenPage?: (page: number) => void;
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
  const qaGenerationRef = useRef(0);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const composerRef = useRef<HTMLFormElement>(null);

  // ─── Q&A history ───
  const [qaHistory, setQaHistory] = useState<
    Array<{ question: string; answer: string; citations: QaStreamState["citations"] }>
  >([]);

  // ─── Load persisted Q&A history on mount ───
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch(`/api/documents/${documentId}/qa-history`);
        if (res.ok && active) {
          const entries = await res.json();
          if (active) {
            setQaHistory(
              entries.map((e: { question: string; answer: string; citations: QaStreamState["citations"] }) => ({
                question: e.question,
                answer: e.answer,
                citations: e.citations,
              })),
            );
          }
        }
      } catch {
        // Non-critical — history simply starts empty
      }
    })();
    return () => {
      active = false;
      qaGenerationRef.current += 1;
      qaAbortRef.current?.abort();
    };
  }, [documentId]);

  // ─── Stream Q&A ───
  const streamQa = useCallback(
    async (q: string) => {
      qaAbortRef.current?.abort();
      const controller = new AbortController();
      qaAbortRef.current = controller;
      const generation = qaGenerationRef.current + 1;
      qaGenerationRef.current = generation;
      const update = (updater: (state: QaStreamState) => QaStreamState) => {
        if (generation === qaGenerationRef.current) setQa(updater);
      };

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
        let terminalEvent = false;
        await consumeJsonSseResponse(response, (currentEvent, parsed) => {
          if (generation !== qaGenerationRef.current) return "stop";
          if (currentEvent === "citations") {
            update((s) => ({
                    ...s,
                    status: "streaming",
                    citations: Array.isArray(parsed.citations)
                      ? (parsed.citations as QaStreamState["citations"])
                      : [],
            }));
          } else if (currentEvent === "answer-token") {
            update((s) => ({
                    ...s,
                    status: "streaming",
                    answerText: s.answerText + (typeof parsed.text === "string" ? parsed.text : ""),
            }));
          } else if (currentEvent === "done") {
            terminalEvent = true;
            update((s) => {
                    const finalAnswer = typeof parsed.answer === "string" ? parsed.answer : s.answerText;
                    const finalCitations = Array.isArray(parsed.citations)
                      ? (parsed.citations as QaStreamState["citations"])
                      : s.citations;
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

                      if (typeof parsed.historyEntryId !== "string") {
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
            return "stop";
          } else if (currentEvent === "error") {
            terminalEvent = true;
            update((s) => ({
              ...s,
              status: "error",
              errorMessage: typeof parsed.message === "string"
                ? parsed.message
                : t("documentDetail.failedToAnswer"),
            }));
            return "stop";
          }
        });

        if (!terminalEvent && generation === qaGenerationRef.current) {
          update((s) => ({
            ...s,
            status: "error",
            errorMessage: t("documentDetail.qaStreamEnded"),
          }));
        }
      } catch (err: unknown) {
        if (isAbortError(err, controller.signal) || generation !== qaGenerationRef.current) return;
        update((s) => ({
          ...s,
          status: "error",
          errorMessage: err instanceof Error ? err.message : t("documentDetail.failedToAnswer"),
        }));
      }
    },
    [documentId, t],
  );

  function ask(raw: string) {
    const q = raw.trim();
    if (q.length === 0) return;
    setQuestion("");
    setPendingQuestion(q);
    void streamQa(q);
  }

  const isQaStreaming = qa.status === "loading" || qa.status === "streaming";
  // A finished answer moves to the history list; a failed one stays put next
  // to its question so it can be retried.
  const visiblePending = qa.status === "idle" ? null : pendingQuestion;
  const isEmpty = qaHistory.length === 0 && visiblePending === null;
  const openCitation = (citation: AnswerCitation) => {
    if (citation.pageFrom != null) onOpenPage?.(citation.pageFrom);
  };
  const withDocument = (citations: QaCitation[]): AnswerCitation[] =>
    citations.map((citation) => ({ ...citation, documentId, documentTitle }));

  const composer = (
    <form
      ref={composerRef}
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        if (!isQaStreaming) ask(question);
      }}
    >
      <InputGroup className="h-auto rounded-2xl bg-card shadow-raised has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-3 has-[textarea:focus-visible]:ring-ring/30 dark:bg-card">
        <InputGroupTextarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              composerRef.current?.requestSubmit();
            }
          }}
          placeholder={t("documentDetail.askQuestionPlaceholder")}
          aria-label={t("documentDetail.askQuestionPlaceholder")}
          rows={1}
          className="max-h-32 min-h-11 px-3.5 pt-3"
        />
        <InputGroupAddon align="block-end" className="px-2.5 pb-2">
          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            className="ml-auto rounded-full"
            disabled={isQaStreaming || question.trim().length === 0}
            aria-label={t("documentDetail.ask")}
          >
            {isQaStreaming ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );

  if (isEmpty) {
    const starters = [
      t("documentDetail.qaStarterSummary"),
      t("documentDetail.qaStarterDates"),
      t("documentDetail.qaStarterAction"),
    ];
    return (
      <div className="flex h-full min-h-0 flex-col justify-center gap-5 overflow-auto bg-gradient-wash p-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <IconTile size="lg" tone="solid">
            <Sparkles />
          </IconTile>
          <h2 className="text-base font-semibold tracking-tight">
            {t("documentDetail.askAboutDocument")}
          </h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            {t("documentDetail.qaEmptyBody")}
          </p>
        </div>
        {composer}
        <div className="flex flex-wrap justify-center gap-1.5">
          {starters.map((starter) => (
            <Button
              key={starter}
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full font-normal text-muted-foreground shadow-none"
              onClick={() => ask(starter)}
            >
              {starter}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {qaHistory.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
            {t("documentDetail.askAboutDocument")}
          </h2>
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => {
              setQaHistory([]);
              authFetch(`/api/documents/${documentId}/qa-history`, {
                method: "DELETE",
              }).catch(() => {});
            }}
          >
            <Trash2 />
            {t("documentDetail.clearHistory")}
          </Button>
        </div>
      ) : null}

      <MessageScrollerProvider key={documentId} autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent aria-busy={isQaStreaming} className="gap-6 px-4 py-5">
              {qaHistory.map((entry, index) => {
                const citations = withDocument(entry.citations);
                // Legacy payloads have no `used` flag: treat them as used.
                const used = citations.filter((citation) => citation.used !== false);
                const unused = citations.filter((citation) => citation.used === false);
                return (
                  <MessageScrollerItem
                    key={index}
                    messageId={`qa-${index}`}
                    scrollAnchor
                    className="flex flex-col gap-4"
                  >
                    <QuestionMessage question={entry.question} />
                    <Message className="gap-2.5">
                      <AnswerAvatar />
                      <MessageContent className="min-w-0 flex-1 gap-3">
                        <AnswerMarkdown
                          text={entry.answer}
                          citations={citations}
                          onCitationSelect={openCitation}
                        />
                        {used.length > 0 ? (
                          <Excerpts
                            citations={used}
                            label={`${t("documentDetail.referencedExcerpts")} (${used.length})`}
                            pageWord={t("documentDetail.pageWord")}
                            onSelect={openCitation}
                          />
                        ) : null}
                        {unused.length > 0 ? (
                          <Excerpts
                            citations={unused}
                            label={`${t("documentDetail.qaFurtherMatches")} (${unused.length})`}
                            pageWord={t("documentDetail.pageWord")}
                            onSelect={openCitation}
                          />
                        ) : null}
                        <MessageFooter>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="text-muted-foreground"
                            aria-label={t("documentDetail.copyAnswer")}
                            onClick={() => void navigator.clipboard.writeText(entry.answer)}
                          >
                            <CopyIcon />
                          </Button>
                        </MessageFooter>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                );
              })}

              {/* The turn in flight */}
              {visiblePending ? (
                <MessageScrollerItem
                  messageId="qa-streaming"
                  scrollAnchor
                  className="flex flex-col gap-4"
                >
                  <QuestionMessage question={visiblePending} />
                  <Message className="gap-2.5">
                    <AnswerAvatar />
                    <MessageContent className="min-w-0 flex-1 gap-3">
                      {qa.status === "error" ? (
                        <Alert variant="destructive">
                          <TriangleAlertIcon />
                          <AlertDescription>
                            {qa.errorMessage ?? t("documentDetail.failedToAnswer")}
                          </AlertDescription>
                          <AlertAction>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              onClick={() => ask(visiblePending)}
                            >
                              {t("documentDetail.retry")}
                            </Button>
                          </AlertAction>
                        </Alert>
                      ) : (
                        <>
                          <Trace>
                            {qa.status === "loading" ? (
                              <TraceLine status="running">
                                <TraceIcon>
                                  <SearchIcon />
                                </TraceIcon>
                                <TraceTitle>{t("documentDetail.searchingChunks")}</TraceTitle>
                              </TraceLine>
                            ) : qa.citations.length > 0 ? (
                              <TraceLine>
                                <TraceIcon>
                                  <CircleCheckIcon />
                                </TraceIcon>
                                <TraceTitle>
                                  {t("documentDetail.referencedExcerpts")} ({qa.citations.length})
                                </TraceTitle>
                              </TraceLine>
                            ) : null}
                          </Trace>
                          {qa.answerText ? (
                            <AnswerMarkdown
                              text={qa.answerText}
                              citations={withDocument(qa.citations)}
                              onCitationSelect={openCitation}
                            />
                          ) : (
                            <div className="flex flex-col gap-2 pt-1">
                              {[92, 88, 60].map((width) => (
                                <Skeleton
                                  key={width}
                                  className="h-3 rounded-full"
                                  style={{ width: `${width}%` }}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <div className="shrink-0 px-4 pt-1 pb-4">{composer}</div>
    </div>
  );
}

function QuestionMessage({ question }: { question: string }) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end">
          <BubbleContent className="rounded-2xl rounded-br-md bg-gradient-action px-3.5 py-2">
            {question}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}

function AnswerAvatar() {
  return (
    <MessageAvatar className="self-start">
      <IconTile size="sm" tone="solid">
        <Sparkles />
      </IconTile>
    </MessageAvatar>
  );
}

/** The passages an answer rests on. Each one opens its page in the viewer. */
function Excerpts({
  citations,
  label,
  pageWord,
  onSelect,
}: {
  citations: AnswerCitation[];
  label: string;
  pageWord: string;
  onSelect: (citation: AnswerCitation) => void;
}) {
  return (
    <Trace>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <FileTextIcon />
            </TraceIcon>
            <TraceTitle>{label}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-1.5 pt-1.5">
            {citations.map((citation, position) => (
              <button
                key={citation.index ?? position}
                type="button"
                onClick={() => onSelect(citation)}
                className="flex w-full items-start gap-2 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="num flex size-4.5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand-soft-foreground">
                  {citation.index ?? position + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {citation.quote}
                  </span>
                  {citation.pageFrom || citation.pageTo ? (
                    <span className="num mt-0.5 block text-xs font-medium">
                      {pageWord} {citation.pageFrom ?? citation.pageTo}
                      {citation.pageTo && citation.pageTo !== citation.pageFrom
                        ? `\u2013${citation.pageTo}`
                        : ""}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
