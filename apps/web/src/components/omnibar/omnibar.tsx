import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Command as CommandPrimitive } from "cmdk";
import {
  ArrowLeftIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  FilesIcon,
  HistoryIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunriseIcon,
  TagIcon,
  TriangleAlertIcon,
  UploadIcon,
  UserRoundIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import type {
  AnswerCitation,
  DashboardInsightsResponse,
  SemanticSearchResult,
} from "@openkeep/types";
import { AnswerMarkdown } from "@/components/chat/answer-markdown";
import { Sources } from "@/components/chat/sources";
import { IconTile } from "@/components/layout/page";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Message, MessageAvatar, MessageContent } from "@/components/ui/message";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { useAnswerStream } from "@/hooks/use-answer-stream";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { api } from "@/lib/api";
import {
  fetchDashboardInsights,
  fetchExplorerFacets,
  type ExplorerFacets,
} from "@/lib/explorer";
import { usePrimaryModifierLabel } from "@/lib/host-shell";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isEnterKey } from "@/lib/keyboard";

type Translate = (key: TranslationKey) => string;

/** `t()` has no interpolation; these strings carry `{name}` style slots. */
function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (slot, key: string) =>
    key in values ? String(values[key]) : slot,
  );
}

// ---------------------------------------------------------------------------
// Suggestion generation
// ---------------------------------------------------------------------------

function generateSuggestions(
  facets: ExplorerFacets | undefined,
  insights: DashboardInsightsResponse | undefined,
  t: Translate,
): string[] {
  if (!facets && !insights) return [];
  const suggestions: string[] = [];

  if (insights?.overdueItems && insights.overdueItems.length > 0) {
    suggestions.push(t("omnibar.suggestOverdue"));
  }

  if (insights?.upcomingDeadlines && insights.upcomingDeadlines.length > 0) {
    suggestions.push(t("omnibar.suggestDeadlines"));
  }

  const topCorrespondent = facets?.correspondents[0];
  if (topCorrespondent) {
    suggestions.push(fill(t("omnibar.suggestSummarize"), { name: topCorrespondent.name }));
  }

  const secondCorrespondent = facets?.correspondents[1];
  if (secondCorrespondent) {
    suggestions.push(fill(t("omnibar.suggestTopics"), { name: secondCorrespondent.name }));
  }

  const topDocType = facets?.documentTypes[0];
  if (topDocType) {
    suggestions.push(fill(t("omnibar.suggestType"), { name: topDocType.name }));
  }

  const topTag = facets?.tags[0];
  if (topTag) {
    suggestions.push(fill(t("omnibar.suggestTag"), { name: topTag.name }));
  }

  if (facets?.years && facets.years.length >= 2) {
    const latestYear = facets.years[facets.years.length - 1];
    if (latestYear) {
      suggestions.push(
        fill(t("omnibar.suggestCompare"), {
          year: latestYear.year,
          previous: latestYear.year - 1,
        }),
      );
    }
  }

  if (
    facets?.amountRange?.max !== null &&
    facets?.amountRange?.max !== undefined &&
    facets.amountRange.max > 0
  ) {
    suggestions.push(t("omnibar.suggestHighest"));
  }

  return suggestions.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OmnibarScreen =
  | "idle"
  | "zero-state"
  | "searching"
  | "results"
  | "citation-preview";

interface CitationTarget {
  documentId: string;
  title: string;
  quote?: string;
  pageFrom?: number | null;
  pageTo?: number | null;
}

function citationTarget(citation: AnswerCitation): CitationTarget {
  return {
    documentId: citation.documentId,
    title: citation.documentTitle,
    quote: citation.quote,
    pageFrom: citation.pageFrom,
    pageTo: citation.pageTo,
  };
}

// ---------------------------------------------------------------------------
// Text block type for document text API
// ---------------------------------------------------------------------------

interface TextBlock {
  documentId: string;
  page: number;
  lineIndex: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  text: string;
}

// ---------------------------------------------------------------------------
// Main Omnibar
// ---------------------------------------------------------------------------

/** Fired by the top bar's search field; the Omnibar keeps owning its state. */
export const OMNIBAR_OPEN_EVENT = "openkeep:omnibar-open";

export function openOmnibar() {
  window.dispatchEvent(new Event(OMNIBAR_OPEN_EVENT));
}

export function Omnibar() {
  const [screen, setScreen] = useState<OmnibarScreen>("idle");
  const [query, setQuery] = useState("");
  const [citation, setCitation] = useState<CitationTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const answerStream = useAnswerStream();
  const { recentSearches, addSearch } = useRecentSearches();
  const navigate = useNavigate();
  const { t } = useI18n();
  const primaryModifier = usePrimaryModifierLabel();
  const askShortcut = primaryModifier === "⌘" ? "⌘↵" : `${primaryModifier}+↵`;
  const [selectedIndex, setSelectedIndex] = useState(0);

  const isOpen = screen !== "idle";

  // Data for zero state suggestions
  const facetsQuery = useQuery({
    queryKey: ["explorer", "facets"],
    // Wrapped: fetchExplorerFacets now takes an optional search, and a bare
    // reference would receive TanStack's query context as that argument.
    queryFn: () => fetchExplorerFacets(),
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const insightsQuery = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
    staleTime: 5 * 60 * 1000,
    enabled: isOpen,
  });

  const suggestions = useMemo(
    () => generateSuggestions(facetsQuery.data, insightsQuery.data, t),
    [facetsQuery.data, insightsQuery.data, t],
  );

  // Document results come from the answer stream's search-results SSE event —
  // the previous separate POST /api/search/semantic embedded and retrieved the
  // same query a second time on every submit.
  const streamedResults = answerStream.searchResults;

  // ─── Open / Close ───

  const open = useCallback(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setScreen("zero-state");
    setQuery("");
    answerStream.reset();
    setCitation(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [answerStream]);

  const close = useCallback(() => {
    setScreen("idle");
    setQuery("");
    answerStream.reset();
    setCitation(null);
  }, [answerStream]);

  const stepBack = useCallback(() => {
    if (screen === "citation-preview") {
      setCitation(null);
      setScreen("results");
    } else if (screen === "results" || screen === "searching") {
      setScreen("zero-state");
      setQuery("");
      answerStream.reset();
    } else {
      close();
    }
  }, [screen, answerStream, close]);

  // ─── Submit query ───

  const submitQuery = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setQuery(trimmed);
      setScreen("searching");
      addSearch(trimmed);
      answerStream.startStream(trimmed);
    },
    [addSearch, answerStream],
  );

  // The palette rows the arrows walk. `>` switches to command mode.
  const paletteRows = useMemo<PaletteRow[]>(() => {
    const rows: PaletteRow[] = [];
    const go = (to: string) => () => {
      close();
      navigate({ to });
    };
    const tab = (to: string) => () => window.open(to, "_blank");
    const commandMode = query.startsWith(">");
    const needle = (commandMode ? query.slice(1) : query).trim().toLowerCase();

    const jump: PaletteRow[] = [
      { id: "go-today", section: "jump", label: t("omnibar.goToday"), icon: SunriseIcon, hint: "T", run: go("/"), newTab: tab("/") },
      { id: "go-documents", section: "jump", label: t("omnibar.goDocuments"), icon: FilesIcon, hint: "D", run: go("/documents"), newTab: tab("/documents") },
      {
        id: "go-review",
        section: "jump",
        label: `${t("omnibar.goReview")}${insightsQuery.data?.stats.pendingReview ? ` · ${insightsQuery.data.stats.pendingReview}` : ""}`,
        icon: ClipboardCheckIcon,
        hint: "R",
        run: go("/review"),
        newTab: tab("/review"),
      },
      { id: "go-taxes", section: "jump", label: t("omnibar.goTaxes"), icon: LandmarkIcon, run: go("/taxes"), newTab: tab("/taxes") },
      { id: "go-import", section: "jump", label: t("omnibar.goImport"), icon: UploadIcon, hint: "U", run: go("/upload"), newTab: tab("/upload") },
      { id: "go-settings", section: "jump", label: t("omnibar.goSettings"), icon: SettingsIcon, run: go("/settings"), newTab: tab("/settings") },
    ];

    if (commandMode) {
      return jump
        .map((row) => ({ ...row, section: "actions" as const }))
        .filter((row) => !needle || row.label.toLowerCase().includes(needle));
    }

    if (!needle) {
      const suggested = suggestions.slice(0, 3);
      const recent = [...new Set(recentSearches.slice(0, 2).map((entry) => entry.query))].filter(
        (text) => !suggested.includes(text),
      );
      return [
        ...[...new Set(suggested)].map((text, index) => ({
          id: `ask-${index}`,
          section: "ask" as const,
          label: text,
          icon: SparklesIcon,
          run: () => submitQuery(text),
        })),
        ...recent.map((text, index) => ({
          id: `recent-${index}`,
          section: "recent" as const,
          label: text,
          icon: HistoryIcon,
          run: () => submitQuery(text),
        })),
        ...jump.slice(0, 4),
      ];
    }

    // Type-ahead: ask row first, then matching taxonomy entries and routes.
    rows.push({
      id: "ask-query",
      section: "ask",
      label: query,
      icon: SparklesIcon,
      run: () => submitQuery(query),
      newTab: () => window.open(`/search?q=${encodeURIComponent(query)}`, "_blank"),
    });

    const facets = facetsQuery.data;
    const matches = <T extends { name: string }>(list: T[] | undefined) =>
      (list ?? []).filter((entry) => entry.name.toLowerCase().includes(needle)).slice(0, 4);

    for (const correspondent of matches(facets?.correspondents)) {
      // The explorer parses these as CSV (see parseExplorerSearch), so a
      // JSON-encoded array would arrive as the literal `["id"]` and match
      // nothing. Send the bare id.
      const to = `/documents?correspondentIds=${encodeURIComponent(correspondent.id)}`;
      rows.push({
        id: `c-${correspondent.id}`,
        section: "documents",
        label: correspondent.name,
        icon: UserRoundIcon,
        meta: t("omnibar.kindCorrespondent"),
        run: go(to),
        newTab: tab(to),
      });
    }
    for (const documentType of matches(facets?.documentTypes)) {
      const to = `/documents?documentTypeIds=${encodeURIComponent(documentType.id)}`;
      rows.push({
        id: `t-${documentType.id}`,
        section: "documents",
        label: documentType.name,
        icon: FileTextIcon,
        meta: t("omnibar.kindType"),
        run: go(to),
        newTab: tab(to),
      });
    }
    for (const tag of matches(facets?.tags)) {
      const to = `/documents?tags=${encodeURIComponent(tag.id)}`;
      rows.push({
        id: `g-${tag.id}`,
        section: "documents",
        label: tag.name,
        icon: TagIcon,
        meta: t("omnibar.kindTag"),
        run: go(to),
        newTab: tab(to),
      });
    }
    rows.push(...jump.filter((row) => row.label.toLowerCase().includes(needle)));
    return rows;
  }, [query, suggestions, recentSearches, facetsQuery.data, insightsQuery.data, close, navigate, submitQuery, t]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, screen]);

  // ─── Open citation preview ───

  const openCitation = useCallback((target: CitationTarget) => {
    setCitation(target);
    setScreen("citation-preview");
  }, []);

  // ─── Update screen when stream completes ───

  useEffect(() => {
    if (
      screen === "searching" &&
      (answerStream.status === "done" || answerStream.status === "error")
    ) {
      setScreen("results");
    }
  }, [screen, answerStream.status]);

  // ─── Keyboard shortcuts ───

  // Escape steps back through the dialog's onEscapeKeyDown below, so that an
  // open citation hover card takes the key first.
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      // Cmd+K / Ctrl+K to toggle
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, open, close]);

  // The top bar's search field opens the omnibar without owning its state.
  useEffect(() => {
    window.addEventListener(OMNIBAR_OPEN_EVENT, open);
    return () => window.removeEventListener(OMNIBAR_OPEN_EVENT, open);
  }, [open]);

  // ─── Input key handler ───

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // cmdk also binds these on its root. Selection is driven from here, and
    // Home/End should keep moving the caret.
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) e.stopPropagation();

    if (screen !== "zero-state") {
      if (isEnterKey(e)) {
        e.preventDefault();
        submitQuery(query);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, paletteRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (isEnterKey(e) && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      // ⌘↵: ask the archive with the raw query (new tab when a row offers one).
      const row = paletteRows[selectedIndex];
      if (row?.newTab) row.newTab();
      else submitQuery(query);
    } else if (isEnterKey(e)) {
      e.preventDefault();
      const row = paletteRows[selectedIndex];
      if (row) row.run();
      else submitQuery(query);
    }
  };

  if (!isOpen) return null;

  const isStreaming =
    answerStream.status === "searching" || answerStream.status === "streaming";
  const isPreview = screen === "citation-preview" && citation !== null;
  const suggestionsLoading =
    !query.trim() && (facetsQuery.isLoading || insightsQuery.isLoading) && suggestions.length === 0;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby="omnibar-description"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          restoreFocusRef.current?.focus();
        }}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          stepBack();
        }}
        className={cn(
          "top-[3svh] flex translate-y-0 flex-col gap-0 overflow-hidden rounded-2xl border bg-popover p-0 shadow-raised ring-0 outline-none sm:top-[9svh]",
          isPreview
            ? "h-[min(760px,94svh)] sm:h-[min(760px,84svh)] sm:max-w-[min(1100px,calc(100%-2rem))]"
            : "max-h-[94svh] sm:max-h-[min(640px,84svh)]",
          !isPreview && (screen === "zero-state" ? "sm:max-w-2xl" : "sm:max-w-3xl"),
        )}
      >
        <DialogTitle className="sr-only">{t("omnibar.title")}</DialogTitle>
        <DialogDescription id="omnibar-description" className="sr-only">
          {t("omnibar.description")}
        </DialogDescription>

        {isPreview ? (
          <CitationPreviewPane
            citation={citation}
            answerStream={answerStream}
            onSelectCitation={setCitation}
            onClose={() => {
              setCitation(null);
              setScreen("results");
            }}
            onOpenDocument={close}
          />
        ) : (
          <>
            {/* The results below sit outside cmdk, which would otherwise swallow Enter on their buttons. */}
            <Command
              shouldFilter={false}
              vimBindings={false}
              label={t("omnibar.title")}
              value={paletteRows[selectedIndex]?.id ?? ""}
              onValueChange={(value) => {
                const index = paletteRows.findIndex((row) => row.id === value);
                if (index >= 0) setSelectedIndex(index);
              }}
              className="h-auto min-h-0 rounded-none! bg-transparent p-0"
            >
              <div className={cn("flex shrink-0 items-center gap-3 px-4 sm:px-5", "border-b")}>
                {isStreaming ? (
                  <Spinner className="size-5 shrink-0 text-brand" />
                ) : (
                  <SearchIcon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
                )}
                <CommandPrimitive.Input
                  ref={inputRef}
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  onKeyDown={handleInputKeyDown}
                  aria-label={t("omnibar.placeholder")}
                  placeholder={t("omnibar.placeholder")}
                  className="h-14 min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-lg"
                />
                {query.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    aria-label={t("omnibar.clear")}
                    onClick={() => {
                      setQuery("");
                      setScreen("zero-state");
                      answerStream.reset();
                      inputRef.current?.focus();
                    }}
                  >
                    <XIcon />
                  </Button>
                ) : null}
                <Kbd className="hidden sm:inline-flex">Esc</Kbd>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="-mr-1.5 text-muted-foreground sm:hidden"
                  onClick={close}
                >
                  {t("omnibar.close")}
                </Button>
              </div>

              {screen === "zero-state" ? (
                <Palette
                  rows={paletteRows}
                  loading={suggestionsLoading}
                  onRun={(row) => row.run()}
                  emptyLabel={t("omnibar.noMatches")}
                  sectionLabels={{
                    ask: t("omnibar.sectionAsk"),
                    recent: t("omnibar.sectionRecent"),
                    documents: t("omnibar.sectionDocuments"),
                    actions: t("omnibar.sectionActions"),
                    jump: t("omnibar.sectionJump"),
                  }}
                />
              ) : null}
            </Command>

            {screen === "searching" || screen === "results" ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ResultsPane
                  query={query}
                  answerStream={answerStream}
                  searchResults={streamedResults}
                  onCitationClick={openCitation}
                  onFollowUp={submitQuery}
                  onRetry={() => answerStream.startStream(query)}
                  onOpenFullPage={close}
                />
              </div>
            ) : null}

            {screen === "zero-state" ? (
              <div className="hidden shrink-0 items-center gap-4 border-t bg-muted/50 px-5 py-2 text-xs text-muted-foreground sm:flex">
                <span className="flex items-center gap-1.5">
                  <KbdGroup>
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                  </KbdGroup>
                  {t("omnibar.footerNavigate")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>↵</Kbd>
                  {t("omnibar.footerOpen")}
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>{askShortcut}</Kbd>
                  {t("omnibar.footerAsk")}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Kbd>&gt;</Kbd>
                  {t("omnibar.footerCommands")}
                </span>
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Palette (zero state + type-ahead)
// ---------------------------------------------------------------------------

export type PaletteRow = {
  id: string;
  section: "jump" | "documents" | "actions" | "ask" | "recent";
  label: string;
  icon: LucideIcon;
  /** A key hint, drawn as a `Kbd`. */
  hint?: string;
  /** What kind of thing the row is, in words. */
  meta?: string;
  run: () => void;
  newTab?: () => void;
};

function Palette({
  rows,
  loading,
  onRun,
  emptyLabel,
  sectionLabels,
}: {
  rows: PaletteRow[];
  loading: boolean;
  onRun: (row: PaletteRow) => void;
  emptyLabel: string;
  sectionLabels: Record<PaletteRow["section"], string>;
}) {
  const sections: Array<PaletteRow["section"]> = ["ask", "recent", "documents", "actions", "jump"];

  return (
    <CommandList className="max-h-none min-h-0 flex-1 p-2 pb-2.5">
      {sections.map((section) => {
        const sectionRows = rows.filter((row) => row.section === section);
        const showSkeleton = section === "ask" && loading;
        if (sectionRows.length === 0 && !showSkeleton) return null;
        return (
          <CommandGroup key={section} heading={sectionLabels[section]}>
            {sectionRows.map((row) => {
              const Icon = row.icon;
              return (
                <CommandItem
                  key={row.id}
                  value={row.id}
                  onSelect={() => onRun(row)}
                  className="min-h-10 gap-3 px-2 data-selected:bg-accent data-selected:text-accent-foreground"
                >
                  {section === "ask" ? (
                    <IconTile size="sm">
                      <Icon />
                    </IconTile>
                  ) : (
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-data-selected/command-item:bg-background">
                      <Icon className="size-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.meta ? (
                    <Badge variant="secondary" className="shrink-0 font-normal">
                      {row.meta}
                    </Badge>
                  ) : null}
                  <CommandShortcut className="flex shrink-0 tracking-normal">
                    {row.hint ? (
                      <Kbd className="hidden sm:inline-flex">{row.hint}</Kbd>
                    ) : (
                      <Kbd className="hidden group-data-selected/command-item:sm:inline-flex">↵</Kbd>
                    )}
                  </CommandShortcut>
                </CommandItem>
              );
            })}
            {showSkeleton
              ? [78, 62, 70].map((width) => (
                  <div key={width} className="flex min-h-10 items-center gap-3 px-2">
                    <Skeleton className="size-7 shrink-0 rounded-md" />
                    <Skeleton className="h-3 rounded-full" style={{ width: `${width}%` }} />
                  </div>
                ))
              : null}
          </CommandGroup>
        );
      })}
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>
      ) : null}
    </CommandList>
  );
}

// ---------------------------------------------------------------------------
// Results Pane
// ---------------------------------------------------------------------------

function ResultsPane({
  query,
  answerStream,
  searchResults,
  onCitationClick,
  onFollowUp,
  onRetry,
  onOpenFullPage,
}: {
  query: string;
  answerStream: ReturnType<typeof useAnswerStream>;
  searchResults: SemanticSearchResult[];
  onCitationClick: (target: CitationTarget) => void;
  onFollowUp: (query: string) => void;
  onRetry: () => void;
  onOpenFullPage: () => void;
}) {
  const { t } = useI18n();
  const { status, answerText, citations, toolStatus, lowConfidence } = answerStream;
  const isStreaming = status === "searching" || status === "streaming";

  // Generate follow-up suggestions from context
  const followUps = useMemo(() => {
    if (status !== "done" || searchResults.length === 0) return [];
    const items: string[] = [];

    const firstDoc = searchResults[0]?.document;
    if (firstDoc?.correspondent) {
      items.push(fill(t("omnibar.followUpFrom"), { name: firstDoc.correspondent.name }));
    }
    if (firstDoc?.documentType) {
      items.push(fill(t("omnibar.followUpSimilar"), { name: firstDoc.documentType.name }));
    }
    items.push(fill(t("omnibar.followUpMore"), { query }));

    return items.slice(0, 3);
  }, [status, searchResults, query, t]);

  // Show what the answer actually cited; the full retrieval set only appears
  // when no marker survived (legacy payloads have no `used` flag and count as used).
  const shownCitations = citations.some((entry) => entry.used !== false)
    ? citations.filter((entry) => entry.used !== false)
    : citations;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <h2 className="min-w-0 flex-1 basis-60 text-lg leading-snug font-semibold tracking-tight wrap-break-word">
          {query}
        </h2>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/search" search={{ q: query }} onClick={onOpenFullPage}>
            {t("omnibar.openFullSearch")}
          </Link>
        </Button>
      </div>

      {status === "error" ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>{t("omnibar.retrievalFailed")}</AlertTitle>
          <AlertDescription>
            {answerStream.errorMessage ?? t("omnibar.tryRephrasing")}
          </AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              {t("omnibar.retry")}
            </Button>
          </AlertAction>
        </Alert>
      ) : (
        <Message className="gap-3">
          <MessageAvatar className="self-start">
            <IconTile size="sm" tone="solid">
              <SparklesIcon />
            </IconTile>
          </MessageAvatar>
          <MessageContent className="min-w-0 flex-1 gap-3">
            {isStreaming ? (
              <Trace>
                {status === "searching" ? (
                  <TraceLine status="running">
                    <TraceIcon>
                      <SearchIcon />
                    </TraceIcon>
                    <TraceTitle>{t("omnibar.searching")}</TraceTitle>
                  </TraceLine>
                ) : searchResults.length > 0 ? (
                  <TraceLine>
                    <TraceIcon>
                      <CircleCheckIcon />
                    </TraceIcon>
                    <TraceTitle>
                      {searchResults.length === 1
                        ? t("omnibar.searchedOne")
                        : fill(t("omnibar.searchedMany"), { count: searchResults.length })}
                    </TraceTitle>
                  </TraceLine>
                ) : null}
                {toolStatus ? (
                  <TraceLine status="running">
                    <TraceIcon>
                      <LoaderCircleIcon className="animate-spin" />
                    </TraceIcon>
                    <TraceTitle>{toolStatus}</TraceTitle>
                  </TraceLine>
                ) : null}
              </Trace>
            ) : null}

            {answerText ? (
              <AnswerMarkdown
                text={answerText}
                citations={citations}
                onCitationSelect={(entry) => onCitationClick(citationTarget(entry))}
              />
            ) : isStreaming ? (
              <div className="flex flex-col gap-2 pt-1">
                {[92, 88, 94, 60].map((width) => (
                  <Skeleton
                    key={width}
                    className="h-3 rounded-full"
                    style={{ width: `${width}%` }}
                  />
                ))}
              </div>
            ) : null}

            {lowConfidence || (status === "done" && !answerText) ? (
              <p className="flex items-center gap-1.5 text-xs text-warning">
                <TriangleAlertIcon className="size-3.5 shrink-0" />
                {t("omnibar.insufficient")}
              </p>
            ) : null}

            {shownCitations.length > 0 ? (
              <Sources
                citations={shownCitations}
                label={
                  shownCitations.length === 1
                    ? t("omnibar.usedSourcesOne")
                    : fill(t("omnibar.usedSourcesMany"), { count: shownCitations.length })
                }
                defaultOpen
                pageLabel={t("omnibar.pageAbbrev")}
                onSelect={(entry) => onCitationClick(citationTarget(entry))}
              />
            ) : null}

            {citations.length === 0 && searchResults.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("omnibar.matchingDocuments")}
                </p>
                <div className="flex flex-col gap-1.5 sm:grid sm:grid-cols-2">
                  {searchResults.slice(0, 4).map((result) => (
                    <Button
                      key={result.document.id}
                      type="button"
                      variant="outline"
                      className="h-auto min-w-0 justify-start rounded-lg py-2 text-left font-normal shadow-none"
                      onClick={() =>
                        onCitationClick({
                          documentId: result.document.id,
                          title: result.document.title,
                          quote: result.matchedChunks[0]?.text,
                        })
                      }
                    >
                      <FileTextIcon className="text-muted-foreground" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{result.document.title}</span>
                        {result.document.correspondent ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {result.document.correspondent.name}
                          </span>
                        ) : null}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {followUps.length > 0 ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <p className="text-xs font-medium text-muted-foreground">{t("omnibar.followUp")}</p>
                <div className="flex flex-wrap gap-2">
                  {followUps.map((followUp) => (
                    <Button
                      key={followUp}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto max-w-full rounded-full py-1.5 text-left font-normal whitespace-normal text-muted-foreground shadow-none"
                      onClick={() => onFollowUp(followUp)}
                    >
                      {followUp}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </MessageContent>
        </Message>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Citation Preview (Split Pane)
// ---------------------------------------------------------------------------

function CitationPreviewPane({
  citation,
  answerStream,
  onSelectCitation,
  onClose,
  onOpenDocument,
}: {
  citation: CitationTarget;
  answerStream: ReturnType<typeof useAnswerStream>;
  onSelectCitation: (target: CitationTarget) => void;
  onClose: () => void;
  onOpenDocument: () => void;
}) {
  const { t, language } = useI18n();

  // Fetch document detail
  const documentQuery = useQuery({
    queryKey: ["document", citation.documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}", {
        params: { path: { id: citation.documentId } },
      });
      if (error) throw new Error("Failed to load document");
      return data as unknown as {
        id: string;
        title: string;
        correspondent: { id: string; name: string; slug: string } | null;
        documentType: { id: string; name: string; slug: string } | null;
        issueDate: string | null;
        createdAt: string;
        tags: Array<{ id: string; name: string; slug: string }>;
      };
    },
  });

  // Fetch document text blocks
  const textQuery = useQuery({
    queryKey: ["document-text", citation.documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}/text", {
        params: { path: { id: citation.documentId } },
      });
      if (error) throw new Error("Failed to load document text");
      return data as unknown as { documentId: string; blocks: TextBlock[] };
    },
    enabled: documentQuery.isSuccess,
  });

  const doc = documentQuery.data;
  const blocks = textQuery.data?.blocks ?? [];
  // Group blocks by page
  const pages = useMemo(() => {
    const pageMap = new Map<number, TextBlock[]>();
    for (const block of blocks) {
      const existing = pageMap.get(block.page) ?? [];
      existing.push(block);
      pageMap.set(block.page, existing);
    }
    return Array.from(pageMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([pageNum, pageBlocks]) => ({
        page: pageNum,
        blocks: pageBlocks.sort((a, b) => a.lineIndex - b.lineIndex),
      }));
  }, [blocks]);

  // Find the page containing the cited text
  const citedPage = useMemo(() => {
    if (citation.pageFrom) return citation.pageFrom;
    if (!citation.quote) return null;

    const quoteLower = citation.quote.toLowerCase().slice(0, 80);
    for (const page of pages) {
      const pageText = page.blocks.map((b) => b.text).join(" ").toLowerCase();
      if (pageText.includes(quoteLower)) return page.page;
    }
    return null;
  }, [citation, pages]);

  // Scroll to cited page
  const docViewerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (citedPage !== null && docViewerRef.current) {
      const pageEl = docViewerRef.current.querySelector(
        `[data-page="${citedPage}"]`,
      );
      if (pageEl) {
        pageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [citedPage, pages]);

  const documentHash = citation.pageFrom ? `page-${citation.pageFrom}` : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* The document, first on a phone. */}
      <div className="order-2 flex max-h-[38%] min-h-0 flex-col overflow-y-auto border-t md:order-1 md:max-h-none md:w-2/5 md:border-t-0 md:border-r">
        <div className="sticky top-0 z-10 hidden h-14 shrink-0 items-center gap-2 border-b bg-popover px-3 md:flex">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-label={t("omnibar.backToResults")}
            onClick={onClose}
          >
            <ArrowLeftIcon />
          </Button>
          <h3 className="text-sm font-medium">{t("omnibar.answer")}</h3>
        </div>

        {answerStream.answerText ? (
          <div className="border-b p-4">
            <AnswerMarkdown
              text={answerStream.answerText}
              citations={answerStream.citations}
              onCitationSelect={(entry) => onSelectCitation(citationTarget(entry))}
              className="text-[13px]"
            />
          </div>
        ) : null}

        {answerStream.citations.length > 0 ? (
          <div className="flex flex-col gap-1.5 p-4">
            <h4 className="text-xs font-medium text-muted-foreground">{t("omnibar.allSources")}</h4>
            <div className="flex flex-col gap-1">
              {answerStream.citations.map((entry, index) => (
                <Button
                  key={`${entry.documentId}-${entry.chunkIndex}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-auto justify-start py-1.5 text-left font-normal",
                    entry.documentId === citation.documentId && "bg-brand-soft text-brand-soft-foreground",
                  )}
                  onClick={() => onSelectCitation(citationTarget(entry))}
                >
                  <span className="num flex size-4.5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand-soft-foreground">
                    {entry.index ?? index + 1}
                  </span>
                  <span className="truncate">{entry.documentTitle}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col md:order-2">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5 md:min-h-14 md:px-4 md:py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground md:hidden"
            aria-label={t("omnibar.backToResults")}
            onClick={onClose}
          >
            <ArrowLeftIcon />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-medium">{doc?.title ?? citation.title}</h2>
            {doc?.correspondent || doc?.issueDate || doc?.documentType ? (
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {doc.correspondent ? <span className="truncate">{doc.correspondent.name}</span> : null}
                {doc.issueDate ? (
                  <span className="num">
                    {new Date(doc.issueDate).toLocaleDateString(language, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                ) : null}
                {doc.documentType ? (
                  <Badge variant="secondary" className="font-normal">
                    {doc.documentType.name}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0">
            <Link
              to="/documents/$documentId"
              params={{ documentId: citation.documentId }}
              hash={documentHash}
              onClick={onOpenDocument}
            >
              {t("omnibar.openDocument")}
            </Link>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="hidden text-muted-foreground md:inline-flex"
            aria-label={t("omnibar.close")}
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>

        <div ref={docViewerRef} className="min-h-0 flex-1 overflow-y-auto bg-stage p-3 sm:p-5">
          {documentQuery.isLoading || textQuery.isLoading ? (
            <div className="flex flex-col gap-2.5 rounded-lg border border-paper-border bg-paper p-5 shadow-card">
              {[64, 92, 88, 94, 70, 90, 42].map((width) => (
                <Skeleton
                  key={width}
                  className="h-3 rounded-full"
                  style={{ width: `${width}%` }}
                />
              ))}
            </div>
          ) : documentQuery.isError ? (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertTitle>{t("omnibar.documentFailed")}</AlertTitle>
              <AlertAction>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void documentQuery.refetch()}
                >
                  {t("omnibar.retry")}
                </Button>
              </AlertAction>
            </Alert>
          ) : pages.length === 0 ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileTextIcon />
                </EmptyMedia>
                <EmptyTitle>{t("omnibar.noTextTitle")}</EmptyTitle>
                <EmptyDescription>{t("omnibar.noTextDetail")}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild variant="outline" size="sm">
                  <Link
                    to="/documents/$documentId"
                    params={{ documentId: citation.documentId }}
                    hash={documentHash}
                    onClick={onOpenDocument}
                  >
                    {t("omnibar.openDocument")}
                  </Link>
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="flex flex-col gap-5">
              {pages.map((page) => (
                <div key={page.page} data-page={page.page} className="flex flex-col gap-1.5">
                  <p className="num text-xs font-medium text-muted-foreground">
                    {fill(t("omnibar.page"), { page: page.page })}
                  </p>
                  <div className="flex flex-col gap-0.5 rounded-lg border border-paper-border bg-paper p-4 text-paper-foreground shadow-card sm:p-6">
                    {page.blocks.map((block, bi) => {
                      // Highlight the block if it matches the cited quote
                      const isHighlighted =
                        citation.quote &&
                        citation.pageFrom === page.page &&
                        citation.quote
                          .toLowerCase()
                          .includes(block.text.toLowerCase().slice(0, 40));

                      return (
                        <p
                          key={bi}
                          className={cn(
                            "text-sm leading-relaxed",
                            isHighlighted &&
                              "-mx-1 rounded-sm bg-highlight px-1 text-highlight-foreground",
                          )}
                        >
                          {block.text}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
