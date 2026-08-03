import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, FileSearch, Loader2, Plus, Send } from "lucide-react";
import type { AnswerCitation, HealthProvidersResponse } from "@openkeep/types";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useAnswerStream, linkifyCitations } from "@/hooks/use-answer-stream";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { api, authFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type SearchParams = { q?: string };

export const Route = createFileRoute("/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: (search.q as string) || undefined,
  }),
  component: ChatPage,
});

// ---------------------------------------------------------------------------
// Conversation persistence (local, like recent searches)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "openkeep.chat-conversations";
const MAX_CONVERSATIONS = 20;

type StructuredRow = { title: string; date: string | null; amount: string | null };

type Turn = {
  question: string;
  answer: string;
  citations: AnswerCitation[];
  structuredRows: StructuredRow[] | null;
  structuredTitle: string | null;
};

type Conversation = { id: string; title: string; at: number; turns: Turn[] };

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistConversations(conversations: Conversation[]) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)),
    );
  } catch {
    // storage full or unavailable — the session still works in memory
  }
}

function relativeAge(at: number, language: string): string {
  const days = Math.round((Date.now() - at) / 86_400_000);
  if (days < 1) return language === "de" ? "jetzt" : "now";
  if (days < 7) return `${days} ${language === "de" ? "T" : "d"}`;
  if (days < 30) return `${Math.round(days / 7)} ${language === "de" ? "W" : "w"}`;
  return `${Math.round(days / 30)} M`;
}

function ChatPage() {
  const { language } = useI18n();
  const navigate = useNavigate();
  const { q } = Route.useSearch();
  const stream = useAnswerStream();
  const { recentSearches, addSearch } = useRecentSearches();

  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(conversations[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  // The conversation the in-flight answer belongs to. Switching conversations
  // mid-stream must not append the turn to whatever is selected when it lands.
  const pendingTarget = useRef<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<AnswerCitation | null>(null);
  const [hoveredDocId, setHoveredDocId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const startedFromParam = useRef<string | null>(null);

  const copy =
    language === "de"
      ? {
          newConversation: "Neue Unterhaltung",
          recent: "Zuletzt",
          privacyNote:
            "Antworten zitieren ihre Quelldokumente. Nur extrahierter Text wird an den Chat-Anbieter gesendet.",
          turns: (n: number) => `${n} ${n === 1 ? "Runde" : "Runden"}`,
          searched: (n: number) => `${n} Dokumente durchsucht`,
          placeholder: "Frag dein Archiv…",
          sendHint: "↵ senden · ⇧↵ neue Zeile",
          onlyText: "nur Textauszüge",
          citedPassage: "Zitierte Stelle",
          findInDocument: "Im Dokument suchen",
          copyQuote: "Kopieren",
          emptyTitle: "Frag dein Archiv",
          emptyBody:
            "Stelle Fragen über deine Dokumente — Antworten nennen ihre Quellen.",
          insufficient: "Nicht genug Belege im Archiv für eine sichere Antwort.",
          errorNote: "Antwort fehlgeschlagen.",
          amount: "Betrag",
          date: "Datum",
          document: "Dokument",
          page: "S.",
        }
      : {
          newConversation: "New conversation",
          recent: "Recent",
          privacyNote:
            "Answers cite the documents they came from. Only extracted text is sent to the chat provider.",
          turns: (n: number) => `${n} ${n === 1 ? "turn" : "turns"}`,
          searched: (n: number) => `Searched ${n} documents`,
          placeholder: "Ask your archive…",
          sendHint: "↵ send · ⇧↵ newline",
          onlyText: "only extracted text",
          citedPassage: "Cited passage",
          findInDocument: "Find in document",
          copyQuote: "Copy",
          emptyTitle: "Ask your archive",
          emptyBody: "Ask questions across your documents — answers name their sources.",
          insufficient: "Not enough evidence in the archive for a confident answer.",
          errorNote: "The answer failed.",
          amount: "Amount",
          date: "Date",
          document: "Document",
          page: "p.",
        };

  const providersQuery = useQuery({
    queryKey: ["health", "providers"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/health/providers", {});
      if (error) throw new Error("providers");
      return data as unknown as HealthProvidersResponse;
    },
    staleTime: 5 * 60_000,
  });

  const active = conversations.find((entry) => entry.id === activeId) ?? null;

  const ask = useCallback(
    (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || pendingQuestion) return;
      addSearch(trimmed);
      setDraft("");
      pendingTarget.current = activeId;
      setPendingQuestion(trimmed);
      void stream.startStream(trimmed);
    },
    [activeId, addSearch, pendingQuestion, stream],
  );

  // Deep link (?q= from the omnibar). The omnibar can be opened again while
  // already on /search, which updates `q` without remounting this route, so
  // remember the question consumed rather than latching a one-shot flag.
  useEffect(() => {
    if (q && startedFromParam.current !== q) {
      startedFromParam.current = q;
      ask(q);
      navigate({ to: "/search", search: {}, replace: true });
    }
  }, [q, ask, navigate]);

  // When a stream finishes, fold it into the active conversation.
  useEffect(() => {
    if (!pendingQuestion) return;
    if (stream.status !== "done" && stream.status !== "error") return;

    const structured = stream.structuredData;
    const structuredRows: StructuredRow[] | null = structured
      ? structured.items.slice(0, 8).map((item) => ({
          title: "title" in item ? item.title : "",
          // Show the date the result was actually selected on: expiry for
          // expiring contracts, otherwise the deadline, otherwise issue.
          date:
            structured.kind === "expiring_contracts" && "expiryDate" in item
              ? (item.expiryDate ?? null)
              : "dueDate" in item && item.dueDate
                ? item.dueDate
                : "issueDate" in item
                  ? (item.issueDate ?? null)
                  : null,
          amount:
            "amount" in item && item.amount != null
              ? (formatCurrency(item.amount, item.currency ?? "EUR") ?? null)
              : null,
        }))
      : null;

    const turn: Turn = {
      question: pendingQuestion,
      answer:
        stream.status === "error"
          ? (stream.errorMessage ?? copy.errorNote)
          : stream.answerStatus === "insufficient_evidence" && !stream.answerText
            ? copy.insufficient
            : stream.answerText,
      citations: stream.citations,
      structuredRows,
      structuredTitle: structured?.title ?? null,
    };

    const target = pendingTarget.current;
    setConversations((current) => {
      let next: Conversation[];
      if (target && current.some((entry) => entry.id === target)) {
        next = current.map((entry) =>
          entry.id === target
            ? { ...entry, at: Date.now(), turns: [...entry.turns, turn] }
            : entry,
        );
      } else {
        const id = crypto.randomUUID();
        next = [
          { id, title: pendingQuestion, at: Date.now(), turns: [turn] },
          ...current,
        ];
        // Only follow the new conversation if the user has not moved on to
        // another one while the answer was streaming.
        if (activeId === target) setActiveId(id);
      }
      persistConversations(next);
      return next;
    });

    if (stream.citations.length > 0) setSelectedCitation(stream.citations[0]);
    pendingTarget.current = null;
    setPendingQuestion(null);
    stream.reset();
  }, [stream.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview of the cited page.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setPreviewUrl(null);
    if (!selectedCitation) return;
    (async () => {
      const response = await authFetch(
        `/api/documents/${selectedCitation.documentId}/download`,
      );
      if (!response.ok || cancelled) return;
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setPreviewUrl(objectUrl);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selectedCitation?.documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the thread pinned to the bottom while streaming.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [active?.turns.length, stream.answerText]);

  const chatModel = providersQuery.data?.activeChatProvider ?? null;

  const followUps = useMemo(
    () =>
      recentSearches
        .filter((entry) => entry.query !== active?.turns.at(-1)?.question)
        .slice(0, 3),
    [recentSearches, active],
  );

  const renderAnswer = (text: string, citations: AnswerCitation[]) => (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children, title }) => {
          if (href?.startsWith("/documents/")) {
            const documentId = href.replace("/documents/", "");
            return (
              <button
                type="button"
                title={title}
                onMouseEnter={() => setHoveredDocId(documentId)}
                onMouseLeave={() => setHoveredDocId(null)}
                onClick={() => {
                  const citation = citations.find(
                    (entry) => entry.documentId === documentId,
                  );
                  if (citation) setSelectedCitation(citation);
                }}
                className="ok-num mx-0.5 inline-flex items-center rounded-[var(--r-sm)] bg-accent px-1.5 py-0.5 text-[11px] font-bold text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                {children}
              </button>
            );
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
        table: ({ children, ...props }) => (
          <div className="overflow-x-auto">
            <table {...props}>{children}</table>
          </div>
        ),
      }}
    >
      {linkifyCitations(text, citations, [])}
    </Markdown>
  );

  return (
    <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[212px_minmax(0,1.25fr)] xl:grid-cols-[212px_minmax(0,1.25fr)_minmax(0,1fr)]">
      {/* Conversation rail */}
      <div className="hidden min-h-0 flex-col border-r bg-[var(--ok-bar)] md:flex">
        <div className="flex-shrink-0 p-2.5">
          <Button
            className="w-full"
            onClick={() => {
              setActiveId(null);
              setSelectedCitation(null);
            }}
          >
            <Plus />
            {copy.newConversation}
          </Button>
        </div>
        <p className="ok-eyebrow flex-shrink-0 px-3 pb-1">{copy.recent}</p>
        <div className="min-h-0 flex-1 overflow-auto">
          {conversations.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setActiveId(entry.id);
                setSelectedCitation(
                  entry.turns.at(-1)?.citations[0] ?? null,
                );
              }}
              className={cn(
                "flex w-full items-center gap-2 border-b border-[var(--ok-border-soft)] px-3 py-2 text-left",
                entry.id === activeId &&
                  "bg-accent shadow-[inset_2px_0_0_var(--ok-accent)]",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {entry.title}
              </span>
              <span className="ok-num flex-shrink-0 text-[10.5px] text-muted-foreground">
                {relativeAge(entry.at, language)}
              </span>
            </button>
          ))}
        </div>
        <p className="flex-shrink-0 border-t px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {copy.privacyNote}
        </p>
      </div>

      {/* Thread */}
      <div className="flex min-h-0 flex-col">
        <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b px-4">
          <span className="min-w-0 truncate text-sm font-semibold">
            {active?.title ?? pendingQuestion ?? copy.emptyTitle}
          </span>
          {active ? (
            <span className="ok-num flex-shrink-0 text-xs text-muted-foreground">
              {copy.turns(active.turns.length)}
            </span>
          ) : null}
        </div>

        <div ref={threadRef} className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {!active && !pendingQuestion ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <FileSearch className="h-6 w-6" />
              <p className="text-sm font-semibold text-foreground">{copy.emptyTitle}</p>
              <p className="max-w-sm text-sm">{copy.emptyBody}</p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {(active?.turns ?? []).map((turn, turnIndex) => (
                <div key={turnIndex} className="flex flex-col gap-3">
                  <div className="ml-auto max-w-[75%] rounded-[var(--r-lg)] bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {turn.question}
                  </div>
                  <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground prose-p:my-1.5 prose-strong:text-foreground">
                    {renderAnswer(turn.answer, turn.citations)}
                  </div>

                  {turn.structuredRows && turn.structuredRows.length > 0 ? (
                    <div className="overflow-hidden rounded-[var(--r-md)] border">
                      <div className="flex h-7 items-center border-b bg-[var(--ok-bar)] px-2.5">
                        <span className="ok-eyebrow">
                          {turn.structuredTitle ?? copy.document}
                        </span>
                      </div>
                      {turn.structuredRows.map((row, rowIndex) => (
                        <div
                          key={rowIndex}
                          className="flex items-center gap-3 border-b border-[var(--ok-border-soft)] px-2.5 py-1.5 last:border-b-0"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {row.title}
                          </span>
                          <span className="ok-num flex-shrink-0 text-xs text-muted-foreground">
                            {row.date ?? ""}
                          </span>
                          <span className="ok-num w-20 flex-shrink-0 text-right text-sm">
                            {row.amount ?? "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {turn.citations.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {turn.citations.map((citation, citationIndex) => (
                        <button
                          key={citationIndex}
                          type="button"
                          onClick={() => setSelectedCitation(citation)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-[var(--r-pill)] border bg-card px-2.5 py-1 text-xs transition-colors hover:bg-secondary",
                            selectedCitation === citation &&
                              "border-[var(--ok-accent)] bg-accent",
                            hoveredDocId === citation.documentId &&
                              "border-[var(--ok-amber)] bg-[var(--ok-amber-soft)]",
                          )}
                        >
                          <span className="ok-num flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
                            {citation.index ?? citationIndex + 1}
                          </span>
                          <span className="max-w-[180px] truncate">
                            {citation.documentTitle}
                          </span>
                          {citation.pageFrom ? (
                            <span className="ok-num text-[10.5px] text-muted-foreground">
                              {copy.page}
                              {citation.pageFrom}
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}

              {/* The streaming turn */}
              {pendingQuestion ? (
                <div className="flex flex-col gap-3">
                  <div className="ml-auto max-w-[75%] rounded-[var(--r-lg)] bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {pendingQuestion}
                  </div>
                  {stream.searchResults.length > 0 || stream.status === "searching" ? (
                    <p className="ok-num flex items-center gap-2 text-xs text-muted-foreground">
                      {copy.searched(stream.searchResults.length)}
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ok-green)]" />
                    </p>
                  ) : null}
                  {stream.answerText ? (
                    <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground prose-p:my-1.5">
                      {renderAnswer(stream.answerText, stream.citations)}
                      <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-[var(--r-pill)] bg-[var(--ok-accent)]" />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {[92, 88, 94, 60].map((width, skeletonIndex) => (
                        <span
                          key={skeletonIndex}
                          className="h-2 animate-pulse rounded-[var(--r-pill)] bg-secondary"
                          style={{ width: `${width}%` }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="flex-shrink-0 border-t px-4 py-3">
          <div className="mx-auto max-w-3xl">
            {followUps.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {followUps.map((entry) => (
                  <Chip key={entry.query} onClick={() => ask(entry.query)}>
                    {entry.query}
                  </Chip>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    ask(draft);
                  }
                }}
                placeholder={copy.placeholder}
                rows={1}
                className="max-h-40 min-h-[38px] flex-1 resize-y rounded-[var(--r-md)] border border-input bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
              />
              <Button
                size="icon"
                onClick={() => ask(draft)}
                disabled={!draft.trim() || pendingQuestion !== null}
                aria-label={copy.sendHint}
              >
                {pendingQuestion ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="ok-num text-[10.5px] text-muted-foreground">
                {copy.sendHint}
              </span>
              {chatModel ? (
                <span className="ok-num text-[10.5px] text-muted-foreground">
                  {chatModel} · {copy.onlyText}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Citation preview */}
      <div className="hidden min-h-0 flex-col border-l xl:flex">
        {selectedCitation ? (
          <>
            <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b px-3.5">
              <span className="ok-num flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-accent-foreground">
                {selectedCitation.index ?? 1}
              </span>
              <span className="min-w-0 truncate text-sm font-semibold">
                {selectedCitation.documentTitle}
              </span>
              {selectedCitation.pageFrom ? (
                <span className="ok-num ml-auto flex-shrink-0 text-xs text-muted-foreground">
                  {copy.page} {selectedCitation.pageFrom}
                  {selectedCitation.pageTo &&
                  selectedCitation.pageTo !== selectedCitation.pageFrom
                    ? `–${selectedCitation.pageTo}`
                    : ""}
                </span>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-[var(--ok-sunken)] p-4">
              {previewUrl ? (
                <iframe
                  key={selectedCitation.documentId}
                  src={`${previewUrl}#page=${selectedCitation.pageFrom ?? 1}`}
                  title={selectedCitation.documentTitle}
                  className="h-full min-h-[320px] w-full rounded-[var(--r-sm)] border border-[var(--ok-paper-border)] bg-[var(--ok-paper)]"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </div>
            <div className="flex-shrink-0 border-t px-3.5 py-3">
              <p className="ok-eyebrow mb-1.5">{copy.citedPassage}</p>
              <blockquote className="rounded-[var(--r-md)] border border-[var(--ok-highlight-rule)]/30 bg-[var(--ok-highlight)] px-3 py-2 text-sm text-[var(--ok-paper-ink)]">
                „{selectedCitation.quote}"
              </blockquote>
              <div className="mt-2 flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate({
                      to: "/documents/$documentId",
                      params: { documentId: selectedCitation.documentId },
                    })
                  }
                >
                  <FileSearch />
                  {copy.findInDocument}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard.writeText(selectedCitation.quote)
                  }
                >
                  <Copy />
                  {copy.copyQuote}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            {copy.privacyNote}
          </div>
        )}
      </div>
    </div>
  );
}
