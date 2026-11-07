import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpIcon,
  CircleCheckIcon,
  CopyIcon,
  FileSearchIcon,
  FileTextIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PlusIcon,
  SearchIcon,
  Sparkles,
  TriangleAlertIcon,
} from "lucide-react";
import type { AnswerCitation, HealthProvidersResponse } from "@openkeep/types";
import { AnswerMarkdown } from "@/components/chat/answer-markdown";
import { Sources } from "@/components/chat/sources";
import { IconTile } from "@/components/layout/page";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { useAnswerStream } from "@/hooks/use-answer-stream";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { api, authFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { useOfflineReadOnly } from "@/lib/host-shell";
import { cn } from "@/lib/utils";
import { createObjectUrlLease } from "@/lib/object-url";

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

/** One source pill per document instead of one per retrieved chunk. */
function relativeAge(at: number, language: string): string {
  const days = Math.round((Date.now() - at) / 86_400_000);
  if (days < 1) return language === "de" ? "jetzt" : "now";
  if (days < 7) return `${days} ${language === "de" ? "T" : "d"}`;
  if (days < 30) return `${Math.round(days / 7)} ${language === "de" ? "W" : "w"}`;
  return `${Math.round(days / 30)} M`;
}

function ChatPage() {
  const { language, t } = useI18n();
  const navigate = useNavigate();
  const { q } = Route.useSearch();
  const stream = useAnswerStream();
  const { recentSearches, addSearch } = useRecentSearches();

  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(conversations[0]?.id ?? null);
  const [draft, setDraft] = useState("");
  const offlineReadOnly = useOfflineReadOnly();
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  // The conversation the in-flight answer belongs to. Switching conversations
  // mid-stream must not append the turn to whatever is selected when it lands.
  const pendingTarget = useRef<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<AnswerCitation | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [citationSheetOpen, setCitationSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const isWide = useMediaQuery("(min-width: 1280px)");
  const composerRef = useRef<HTMLFormElement>(null);
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
          furtherMatches: (n: number) => `Weitere Treffer (${n})`,
          usedSources: (n: number) => `${n} ${n === 1 ? "Quelle" : "Quellen"} verwendet`,
          searching: "Durchsuche dein Archiv",
          copyAnswer: "Antwort kopieren",
          history: "Verlauf",
          noConversations: "Noch keine Unterhaltungen.",
          newOne: "Neu",
          starters: [
            "Welche Rechnungen sind überfällig?",
            "Welche Verträge laufen bald aus?",
            "Was steht diesen Monat an?",
            "Welche Dokumente muss ich noch prüfen?",
          ],
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
          furtherMatches: (n: number) => `Further matches (${n})`,
          usedSources: (n: number) => `Used ${n} ${n === 1 ? "source" : "sources"}`,
          searching: "Searching your archive",
          copyAnswer: "Copy answer",
          history: "History",
          noConversations: "No conversations yet.",
          newOne: "New",
          starters: [
            "Which invoices are overdue?",
            "Which contracts expire soon?",
            "What is due this month?",
            "Which documents still need review?",
          ],
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
      // Replay the visible thread so follow-up questions resolve server-side;
      // the hook caps how many turns are sent.
      const history = (active?.turns ?? [])
        .flatMap((turn) => [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: turn.answer },
        ])
        .filter((turn) => turn.content.trim().length > 0);
      void stream.startStream(trimmed, history);
    },
    [active, activeId, addSearch, pendingQuestion, stream],
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

    if (stream.citations.length > 0) {
      // Prefer the first citation the answer actually used for the preview pane.
      setSelectedCitation(
        stream.citations.find((citation) => citation.used !== false) ??
          stream.citations[0],
      );
    }
    pendingTarget.current = null;
    setPendingQuestion(null);
    stream.reset();
  }, [stream.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview of the cited page.
  useEffect(() => {
    const objectUrl = createObjectUrlLease();
    let cancelled = false;
    setPreviewUrl(null);
    if (!selectedCitation) return;
    (async () => {
      const response = await authFetch(
        `/api/documents/${selectedCitation.documentId}/download`,
      );
      if (!response.ok || cancelled) return;
      const blob = await response.blob();
      const nextUrl = objectUrl.replace(blob);
      if (nextUrl) setPreviewUrl(nextUrl);
    })().catch(() => {});
    return () => {
      cancelled = true;
      objectUrl.dispose();
    };
  }, [selectedCitation?.documentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const chatModel = providersQuery.data?.activeChatProvider ?? null;

  const followUps = useMemo(
    () =>
      recentSearches
        .filter((entry) => entry.query !== active?.turns.at(-1)?.question)
        .slice(0, 3),
    [recentSearches, active],
  );

  const openCitation = (citation: AnswerCitation) => {
    setSelectedCitation(citation);
    if (!isWide) setCitationSheetOpen(true);
  };

  const startNewConversation = () => {
    setActiveId(null);
    setSelectedCitation(null);
    setHistoryOpen(false);
  };

  const conversationList = (
    <>
      <div className="flex flex-col gap-0.5 p-2">
        {conversations.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">{copy.noConversations}</p>
        ) : null}
        {conversations.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-current={entry.id === activeId ? "true" : undefined}
            onClick={() => {
              setActiveId(entry.id);
              setSelectedCitation(entry.turns.at(-1)?.citations[0] ?? null);
              setHistoryOpen(false);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
              entry.id === activeId && "bg-brand-soft font-medium text-brand-soft-foreground",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{entry.title}</span>
            <span className="num shrink-0 text-xs text-muted-foreground">
              {relativeAge(entry.at, language)}
            </span>
          </button>
        ))}
      </div>
    </>
  );

  const citationPanel = selectedCitation ? (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b px-4 py-3 pe-12 xl:pe-4">
        <span className="num flex size-5.5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-soft-foreground">
          {selectedCitation.index ?? 1}
        </span>
        <span className="min-w-0 truncate text-sm font-medium">
          {selectedCitation.documentTitle}
        </span>
        {selectedCitation.pageFrom ? (
          <span className="num ml-auto shrink-0 text-xs text-muted-foreground">
            {copy.page} {selectedCitation.pageFrom}
            {selectedCitation.pageTo && selectedCitation.pageTo !== selectedCitation.pageFrom
              ? `–${selectedCitation.pageTo}`
              : ""}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-stage p-4">
        {previewUrl ? (
          <iframe
            key={selectedCitation.documentId}
            src={`${previewUrl}#page=${selectedCitation.pageFrom ?? 1}`}
            title={selectedCitation.documentTitle}
            className="h-full min-h-[320px] w-full rounded-md border border-paper-border bg-paper shadow-card"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Spinner />
          </div>
        )}
      </div>
      <div className="shrink-0 border-t p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">{copy.citedPassage}</p>
        <blockquote className="rounded-lg bg-highlight px-3 py-2.5 text-sm text-highlight-foreground">
          „{selectedCitation.quote}"
        </blockquote>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => {
              setCitationSheetOpen(false);
              navigate({
                to: "/documents/$documentId",
                params: { documentId: selectedCitation.documentId },
                hash: selectedCitation.pageFrom
                  ? `page-${selectedCitation.pageFrom}`
                  : undefined,
              });
            }}
          >
            <FileSearchIcon />
            {copy.findInDocument}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(selectedCitation.quote)}
          >
            <CopyIcon />
            {copy.copyQuote}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  const composer = (
    <form
      ref={composerRef}
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        if (!offlineReadOnly) ask(draft);
      }}
    >
      <InputGroup className="h-auto rounded-2xl bg-card shadow-raised has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-3 has-[textarea:focus-visible]:ring-ring/30 dark:bg-card">
        <InputGroupTextarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              composerRef.current?.requestSubmit();
            }
          }}
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          rows={1}
          className="max-h-40 min-h-12 px-4 pt-3.5 text-[0.95rem] md:text-[0.95rem]"
        />
        <InputGroupAddon align="block-end" className="gap-2 px-3 pb-2.5">
          <InputGroupText className="min-w-0 truncate text-xs">
            {chatModel ? `${chatModel} · ${copy.onlyText}` : copy.onlyText}
          </InputGroupText>
          <InputGroupText className="ml-auto hidden text-xs sm:inline">
            {copy.sendHint}
          </InputGroupText>
          <InputGroupButton
            type="submit"
            size="icon-sm"
            variant="default"
            className="ml-auto rounded-full sm:ml-0"
            disabled={!draft.trim() || pendingQuestion !== null || offlineReadOnly}
            aria-label={offlineReadOnly ? t("offline.askDisabled") : copy.sendHint}
          >
            {pendingQuestion ? <LoaderCircleIcon className="animate-spin" /> : <ArrowUpIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );

  const suggestionRow = (items: string[]) => (
    <div className="flex scroll-fade-x scrollbar-none gap-2 overflow-x-auto overscroll-x-contain">
      {items.map((item) => (
        <Button
          key={item}
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 rounded-full font-normal text-muted-foreground shadow-none"
          disabled={offlineReadOnly || pendingQuestion !== null}
          onClick={() => ask(item)}
        >
          {item}
        </Button>
      ))}
    </div>
  );

  const isEmpty = !active && !pendingQuestion;

  return (
    <div className="flex h-full min-h-0">
      {/* Conversations */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/40 md:flex">
        <div className="shrink-0 p-3">
          <Button variant="outline" className="w-full justify-start" onClick={startNewConversation}>
            <PlusIcon />
            {copy.newConversation}
          </Button>
        </div>
        <p className="shrink-0 px-4.5 pb-1 text-xs font-medium text-muted-foreground">
          {copy.recent}
        </p>
        <div className="min-h-0 flex-1 overflow-auto">{conversationList}</div>
        <p className="shrink-0 border-t p-4 text-xs leading-relaxed text-muted-foreground">
          {copy.privacyNote}
        </p>
      </aside>

      {/* Thread */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!isEmpty ? (
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3 md:px-6">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground md:hidden"
              aria-label={copy.history}
              onClick={() => setHistoryOpen(true)}
            >
              <HistoryIcon />
            </Button>
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
              {active?.title ?? pendingQuestion}
            </h1>
            {active ? (
              <span className="num shrink-0 text-xs text-muted-foreground">
                {copy.turns(active.turns.length)}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground md:hidden"
              onClick={startNewConversation}
            >
              <PlusIcon />
              {copy.newOne}
            </Button>
          </div>
        ) : null}

        {isEmpty ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto bg-gradient-wash p-4 md:p-8">
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 left-3 text-muted-foreground md:hidden"
              aria-label={copy.history}
              onClick={() => setHistoryOpen(true)}
            >
              <HistoryIcon />
            </Button>
            <div className="flex w-full max-w-2xl flex-col gap-5">
              <div className="flex flex-col items-center gap-3 text-center">
                <IconTile size="lg" tone="solid">
                  <Sparkles />
                </IconTile>
                <h1 className="text-gradient text-3xl font-semibold tracking-tight md:text-4xl">
                  {copy.emptyTitle}
                </h1>
                <p className="max-w-md text-muted-foreground">{copy.emptyBody}</p>
              </div>
              {composer}
              {suggestionRow(copy.starters)}
            </div>
          </div>
        ) : (
          <>
            <MessageScrollerProvider key={activeId ?? "pending"} autoScroll>
              <MessageScroller className="min-h-0 flex-1">
                <MessageScrollerViewport>
                  <MessageScrollerContent
                    aria-busy={pendingQuestion !== null}
                    className="mx-auto w-full max-w-3xl gap-7 px-4 py-6 md:px-6"
                  >
                    {(active?.turns ?? []).map((turn, turnIndex) => {
                      // Legacy payloads have no `used` flag — treat them as used.
                      const used = turn.citations.filter((c) => c.used !== false);
                      const unused = turn.citations.filter((c) => c.used === false);
                      return (
                        <MessageScrollerItem
                          key={turnIndex}
                          messageId={`turn-${turnIndex}`}
                          scrollAnchor
                          className="flex flex-col gap-5"
                        >
                          <Message align="end">
                            <MessageContent>
                              <Bubble align="end">
                                <BubbleContent className="rounded-2xl rounded-br-md bg-gradient-action px-4 py-2.5">
                                  {turn.question}
                                </BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                          <Message className="gap-3">
                            <MessageAvatar className="self-start">
                              <IconTile size="sm" tone="solid">
                                <Sparkles />
                              </IconTile>
                            </MessageAvatar>
                            <MessageContent className="min-w-0 flex-1 gap-3">
                              <AnswerMarkdown
                                text={turn.answer}
                                citations={turn.citations}
                                onCitationSelect={openCitation}
                              />

                              {turn.structuredRows && turn.structuredRows.length > 0 ? (
                                <div className="overflow-hidden rounded-xl border bg-card shadow-card">
                                  <div className="border-b bg-muted/60 px-3.5 py-2 text-xs font-medium text-muted-foreground">
                                    {turn.structuredTitle ?? copy.document}
                                  </div>
                                  {turn.structuredRows.map((row, rowIndex) => (
                                    <div
                                      key={rowIndex}
                                      className="flex items-center gap-3 border-b px-3.5 py-2 last:border-b-0"
                                    >
                                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                        {row.title}
                                      </span>
                                      <span className="num shrink-0 text-xs text-muted-foreground">
                                        {row.date ?? ""}
                                      </span>
                                      <span className="num w-20 shrink-0 text-right text-sm">
                                        {row.amount ?? "—"}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {used.length > 0 ? (
                                <Sources
                                  citations={used}
                                  label={copy.usedSources(used.length)}
                                  defaultOpen
                                  selected={selectedCitation}
                                  pageLabel={copy.page}
                                  onSelect={openCitation}
                                />
                              ) : null}
                              {unused.length > 0 ? (
                                <Sources
                                  citations={unused}
                                  label={copy.furtherMatches(unused.length)}
                                  selected={selectedCitation}
                                  pageLabel={copy.page}
                                  onSelect={openCitation}
                                />
                              ) : null}

                              <MessageFooter>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-muted-foreground"
                                  aria-label={copy.copyAnswer}
                                  onClick={() => void navigator.clipboard.writeText(turn.answer)}
                                >
                                  <CopyIcon />
                                </Button>
                              </MessageFooter>
                            </MessageContent>
                          </Message>
                        </MessageScrollerItem>
                      );
                    })}

                    {/* The streaming turn */}
                    {pendingQuestion ? (
                      <MessageScrollerItem
                        messageId="streaming"
                        scrollAnchor
                        className="flex flex-col gap-5"
                      >
                        <Message align="end">
                          <MessageContent>
                            <Bubble align="end">
                              <BubbleContent className="rounded-2xl rounded-br-md bg-gradient-action px-4 py-2.5">
                                {pendingQuestion}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                        <Message className="gap-3">
                          <MessageAvatar className="self-start">
                            <IconTile size="sm" tone="solid">
                              <Sparkles />
                            </IconTile>
                          </MessageAvatar>
                          <MessageContent className="min-w-0 flex-1 gap-3">
                            <Trace>
                              {stream.status === "searching" ? (
                                <TraceLine status="running">
                                  <TraceIcon>
                                    <SearchIcon />
                                  </TraceIcon>
                                  <TraceTitle>{copy.searching}</TraceTitle>
                                </TraceLine>
                              ) : stream.searchResults.length > 0 ? (
                                <TraceLine>
                                  <TraceIcon>
                                    <CircleCheckIcon />
                                  </TraceIcon>
                                  <TraceTitle>{copy.searched(stream.searchResults.length)}</TraceTitle>
                                </TraceLine>
                              ) : null}
                              {stream.toolStatus ? (
                                <TraceLine status="running">
                                  <TraceIcon>
                                    <LoaderCircleIcon className="animate-spin" />
                                  </TraceIcon>
                                  <TraceTitle>{stream.toolStatus}</TraceTitle>
                                </TraceLine>
                              ) : null}
                            </Trace>
                            {stream.answerText ? (
                              <AnswerMarkdown
                                text={stream.answerText}
                                citations={stream.citations}
                                onCitationSelect={openCitation}
                              />
                            ) : (
                              <div className="flex flex-col gap-2 pt-1">
                                {[92, 88, 94, 60].map((width) => (
                                  <Skeleton
                                    key={width}
                                    className="h-3 rounded-full"
                                    style={{ width: `${width}%` }}
                                  />
                                ))}
                              </div>
                            )}
                            {stream.lowConfidence ? (
                              <p className="flex items-center gap-1.5 text-xs text-warning">
                                <TriangleAlertIcon className="size-3.5" />
                                {copy.insufficient}
                              </p>
                            ) : null}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    ) : null}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>

            {/* Composer */}
            <div className="shrink-0 px-4 pt-1 pb-4 md:px-6">
              <div className="mx-auto flex max-w-3xl flex-col gap-2.5">
                {followUps.length > 0
                  ? suggestionRow(followUps.map((entry) => entry.query))
                  : null}
                {composer}
              </div>
            </div>
          </>
        )}
      </section>

      {/* The cited passage */}
      {isWide && selectedCitation ? (
        <aside className="flex w-[400px] shrink-0 flex-col border-l">{citationPanel}</aside>
      ) : null}
      {!isWide ? (
        <Sheet open={citationSheetOpen && selectedCitation !== null} onOpenChange={setCitationSheetOpen}>
          <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
            <SheetHeader className="sr-only">
              <SheetTitle>{copy.citedPassage}</SheetTitle>
            </SheetHeader>
            {citationPanel}
          </SheetContent>
        </Sheet>
      ) : null}

      {/* Conversations on narrow screens */}
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>{copy.history}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">{conversationList}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
