import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Sidebar, Sparkles, Rows3, CalendarRange } from "lucide-react";
import type { ExplorerSearch, ExplorerView } from "@/lib/explorer";
import {
  fetchDocumentsProjection,
  fetchDocumentsTimeline,
  fetchExplorerFacets,
  fetchFilteredDocuments,
  nextExplorerSearch,
} from "@/lib/explorer";
import { Button } from "@/components/ui/button";
import { FilterSidebar } from "./filter-sidebar";
import { GalaxyCanvas } from "./galaxy-canvas";
import {
  DocumentRows,
  ErrorBlock,
  ExplorerSectionHeader,
  LoadingBlock,
} from "./shared";
import { TimelineView } from "./timeline-view";

type ExplorerSurfaceProps = {
  title: string;
  eyebrow: string;
  description: string;
  search: ExplorerSearch;
  onSearchChange: (next: ExplorerSearch) => void;
  openDocument: (documentId: string) => void;
  allowViewSwitch?: boolean;
  forcedView?: ExplorerView;
};

const VIEW_OPTIONS: Array<{
  value: ExplorerView;
  label: string;
  icon: typeof Rows3;
}> = [
  { value: "list", label: "List", icon: Rows3 },
  { value: "timeline", label: "Timeline", icon: CalendarRange },
  { value: "galaxy", label: "Galaxy", icon: Sparkles },
];

export function ExplorerSurface({
  title,
  eyebrow,
  description,
  search,
  onSearchChange,
  openDocument,
  allowViewSwitch = true,
  forcedView,
}: ExplorerSurfaceProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [queryDraft, setQueryDraft] = useState(search.query ?? "");
  const activeView = forcedView ?? search.view ?? "list";

  useEffect(() => {
    setQueryDraft(search.query ?? "");
  }, [search.query]);

  const facetsQuery = useQuery({
    queryKey: ["documents", "facets"],
    queryFn: fetchExplorerFacets,
  });
  const documentsQuery = useQuery({
    queryKey: ["documents", "explorer", search],
    queryFn: () => fetchFilteredDocuments(search),
    enabled: activeView === "list",
  });
  const timelineQuery = useQuery({
    queryKey: ["documents", "timeline", search],
    queryFn: () => fetchDocumentsTimeline(search),
    enabled: activeView === "timeline",
  });
  const projectionQuery = useQuery({
    queryKey: ["documents", "projection", search],
    queryFn: () => fetchDocumentsProjection(search),
    enabled: activeView === "galaxy",
  });

  return (
    <div className="space-y-6 p-6 md:p-8">
      <ExplorerSectionHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
      />

      <div className="flex flex-wrap items-center gap-3">
        <form
          className="flex min-w-[280px] flex-1 items-center gap-2 rounded-full border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] px-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            onSearchChange(
              nextExplorerSearch(search, {
                query: queryDraft || undefined,
                page: undefined,
              }),
            );
          }}
        >
          <Search className="h-4 w-4 text-[color:var(--explorer-muted)]" />
          <input
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="Search titles, snippets, or archive terms"
            className="h-10 w-full bg-transparent text-sm text-[color:var(--explorer-ink)] outline-none placeholder:text-[color:var(--explorer-muted)]"
          />
        </form>

        {allowViewSwitch ? (
          <div className="flex items-center gap-2 rounded-full border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-1">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() =>
                    onSearchChange(
                      nextExplorerSearch(search, {
                        view: option.value,
                        page: undefined,
                      }),
                    )
                  }
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                    activeView === option.value
                      ? "bg-[color:var(--explorer-cobalt-soft)] text-[color:var(--explorer-cobalt)]"
                      : "text-[color:var(--explorer-muted)]"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </button>
              );
            })}
          </div>
        ) : null}

        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => setSidebarOpen((current) => !current)}
        >
          <Sidebar className="h-4 w-4" />
          {sidebarOpen ? "Hide filters" : "Show filters"}
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        {sidebarOpen ? (
          <FilterSidebar
            facets={facetsQuery.data}
            search={search}
            onSearchChange={(updates) =>
              onSearchChange(nextExplorerSearch(search, updates))
            }
          />
        ) : null}

        <div className="space-y-5">
          {activeView === "list" ? (
            documentsQuery.isLoading ? (
              <LoadingBlock label="Loading filtered documents" />
            ) : documentsQuery.isError ? (
              <ErrorBlock
                label="Failed to load the filtered archive list."
                action={
                  <Button variant="outline" onClick={() => documentsQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : (
              <DocumentRows
                documents={documentsQuery.data?.items ?? []}
                emptyLabel="No documents match the current explorer filters."
              />
            )
          ) : null}

          {activeView === "timeline" ? (
            timelineQuery.isLoading ? (
              <LoadingBlock label="Loading timeline map" />
            ) : timelineQuery.isError || !timelineQuery.data ? (
              <ErrorBlock
                label="Failed to load the timeline buckets."
                action={
                  <Button variant="outline" onClick={() => timelineQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : (
              <TimelineView
                timeline={timelineQuery.data}
                search={search}
                expanded={search.expanded ?? []}
                onToggleMonth={(monthKey) =>
                  onSearchChange(
                    nextExplorerSearch(search, {
                      expanded: search.expanded?.includes(monthKey)
                        ? search.expanded.filter((value) => value !== monthKey)
                        : [...(search.expanded ?? []), monthKey],
                    }),
                  )
                }
              />
            )
          ) : null}

          {activeView === "galaxy" ? (
            projectionQuery.isLoading ? (
              <LoadingBlock label="Computing semantic projection" />
            ) : projectionQuery.isError || !projectionQuery.data ? (
              <ErrorBlock
                label="Failed to compute the semantic galaxy view."
                action={
                  <Button variant="outline" onClick={() => projectionQuery.refetch()}>
                    Retry
                  </Button>
                }
              />
            ) : (
              <GalaxyCanvas
                projection={projectionQuery.data}
                colorBy={search.colorBy ?? "correspondent"}
                onColorByChange={(value) =>
                  onSearchChange(nextExplorerSearch(search, { colorBy: value }))
                }
                onOpenDocument={openDocument}
              />
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
