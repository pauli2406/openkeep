import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ErrorBlock, LoadingBlock } from "@/components/explorer/shared";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import { processingRefetchInterval } from "@/lib/document-processing";
import { fetchDashboardInsights, formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { DashboardDeadlineItem, Document } from "@openkeep/types";

export const Route = createFileRoute("/")({
  component: TodayPage,
});

type TaskFilter = "open" | "overdue" | "month" | "invoices";

/** "-4d" when overdue, "6d" otherwise — the design's DUE column. */
function dueLabel(item: DashboardDeadlineItem): string {
  return item.isOverdue
    ? `-${Math.abs(item.daysUntilDue)}d`
    : `${item.daysUntilDue}d`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** One cell of the extracted-fields grid; `attention` tints it amber. */
function Field({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: string;
  attention?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--r-md)] border px-2.5 py-1.5",
        attention
          ? "border-[var(--ok-amber)]/30 bg-[var(--ok-amber-soft)]"
          : "border-border bg-card",
      )}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "truncate text-sm",
          attention ? "ok-num text-[var(--ok-amber)]" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function TaskPreview({ documentId }: { documentId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}", {
        params: { path: { id: documentId } },
      });
      if (error) throw new Error(getApiErrorMessage(error, t("today.previewUnavailable")));
      return data as unknown as Document;
    },
  });

  const previewQuery = useQuery({
    queryKey: ["document-preview", documentId],
    queryFn: async () => {
      const response = await authFetch(`/api/documents/${documentId}/download`);
      if (!response.ok) throw new Error(t("today.previewUnavailable"));
      return response.blob();
    },
    retry: false,
  });

  useEffect(() => {
    if (!previewQuery.data) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(previewQuery.data);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [previewQuery.data]);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      // Same endpoint the review queue uses; keeps one resolve path.
      const { error } = await api.POST("/api/documents/{id}/review/resolve", {
        params: { path: { id: documentId } },
        body: {},
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("dashboard.failedToCompleteTask")));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", "insights"] });
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents", "review"] });
    },
  });

  const doc = documentQuery.data;
  const needsReview = doc?.reviewStatus === "pending";
  const isImage = previewQuery.data?.type.startsWith("image/");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b px-3.5">
        <span className="ok-section-title min-w-0 flex-1 truncate">
          {doc?.title ?? "—"}
        </span>
        {needsReview ? <Badge variant="warn">{t("today.needsReview")}</Badge> : null}
        <button
          type="button"
          aria-label={t("today.openDocument")}
          className="text-muted-foreground transition-colors hover:text-foreground"
          onClick={() =>
            navigate({ to: "/documents/$documentId", params: { documentId } })
          }
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* A scan is a scan: paper stays light, the frame darkens. */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-[var(--ok-sunken)] p-5">
        {previewUrl && isImage ? (
          <img
            src={previewUrl}
            alt=""
            className="max-w-full rounded-[var(--r-sm)] border border-[var(--ok-paper-border)] bg-[var(--ok-paper)]"
          />
        ) : previewUrl ? (
          <iframe
            src={previewUrl}
            title={doc?.title ?? ""}
            className="h-full min-h-[420px] w-full rounded-[var(--r-sm)] border border-[var(--ok-paper-border)] bg-[var(--ok-paper)]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            {previewQuery.isLoading ? "…" : t("today.previewUnavailable")}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 border-t px-3.5 py-3">
        <div className="ok-eyebrow mb-2">{t("today.extractedFields")}</div>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label={t("dashboard.correspondent")}
            value={doc?.correspondent?.name ?? t("dashboard.unfiled")}
          />
          <Field
            label={t("today.documentType")}
            value={doc?.documentType?.name ?? "—"}
          />
          <Field label={t("today.issueDate")} value={formatDate(doc?.issueDate)} />
          <Field
            label={t("dashboard.deadline")}
            value={formatDate(doc?.dueDate)}
            attention={Boolean(doc?.dueDate)}
          />
          <Field
            label={t("dashboard.amount")}
            value={
              doc?.amount != null
                ? (formatCurrency(doc.amount, doc.currency ?? "EUR") ?? "—")
                : "—"
            }
          />
          <Field
            label={t("today.reference")}
            value={doc?.referenceNumber ?? "—"}
            attention={!doc?.referenceNumber}
          />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending || !needsReview}
          >
            <Check />
            {t("today.confirmAndFile")}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              navigate({ to: "/documents/$documentId", params: { documentId } })
            }
          >
            <RotateCw />
            {t("today.openDocument")}
          </Button>
          <span className="ok-num ml-auto text-[10.5px] text-muted-foreground">
            ↵ {t("today.confirmHint")} · ⇥ {t("today.nextHint")}
          </span>
        </div>
      </div>
    </div>
  );
}

function TodayPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const insightsQuery = useQuery({
    queryKey: ["dashboard", "insights"],
    queryFn: fetchDashboardInsights,
    refetchInterval: (query) =>
      processingRefetchInterval(query.state.data, (data) => data?.recentDocuments),
  });

  const allTasks = useMemo(() => {
    const data = insightsQuery.data;
    if (!data) return [] as DashboardDeadlineItem[];
    return [...data.overdueItems, ...data.upcomingDeadlines].sort(
      (a, b) => a.daysUntilDue - b.daysUntilDue,
    );
  }, [insightsQuery.data]);

  const tasks = useMemo(() => {
    switch (filter) {
      case "overdue":
        return allTasks.filter((item) => item.isOverdue);
      case "month":
        return allTasks.filter((item) => item.daysUntilDue <= 31);
      case "invoices":
        return allTasks.filter((item) =>
          (item.documentTypeName ?? "").toLowerCase().includes("invoice"),
        );
      default:
        return allTasks;
    }
  }, [allTasks, filter]);

  const overdueCount = allTasks.filter((item) => item.isOverdue).length;

  // Keep a selection so the right rail always has something to show.
  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !tasks.some((item) => item.documentId === selectedId)) {
      setSelectedId(tasks[0].documentId);
    }
  }, [tasks, selectedId]);

  const selectedIndex = tasks.findIndex((item) => item.documentId === selectedId);

  // Row click selects; ↵ opens; ↑/↓ and ⇥ move.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (tasks.length === 0) return;

      if (event.key === "ArrowDown" || event.key === "Tab") {
        event.preventDefault();
        const next = tasks[Math.min(selectedIndex + 1, tasks.length - 1)];
        if (next) setSelectedId(next.documentId);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = tasks[Math.max(selectedIndex - 1, 0)];
        if (prev) setSelectedId(prev.documentId);
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        navigate({ to: "/documents/$documentId", params: { documentId: selectedId } });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tasks, selectedIndex, selectedId, navigate]);

  if (insightsQuery.isLoading) {
    return <LoadingBlock label={t("dashboard.loadingAtlas")} />;
  }

  if (insightsQuery.isError || !insightsQuery.data) {
    return (
      <div className="p-6">
        <ErrorBlock
          label={t("dashboard.failedToLoadInsights")}
          action={
            <Button variant="outline" onClick={() => insightsQuery.refetch()}>
              {t("dashboard.retry")}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filter strip */}
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b px-4">
        <Chip active={filter === "open"} onClick={() => setFilter("open")}>
          {t("today.openTasks")}
        </Chip>
        <Chip active={filter === "overdue"} onClick={() => setFilter("overdue")}>
          {t("today.overdue")} · <span className="ok-num">{overdueCount}</span>
        </Chip>
        <Chip active={filter === "month"} onClick={() => setFilter("month")}>
          {t("today.thisMonth")}
        </Chip>
        <Chip active={filter === "invoices"} onClick={() => setFilter("invoices")}>
          {t("today.invoices")}
        </Chip>
        <span className="ml-auto text-xs text-muted-foreground">
          {t("today.sortedBy")}{" "}
          <span className="font-semibold text-foreground">{t("today.dueDate")}</span> ·{" "}
          <span className="ok-num">{tasks.length}</span> {t("today.openCount")}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_minmax(340px,480px)]">
        {/* Left: what needs you */}
        <div ref={listRef} className="min-h-0 overflow-auto">
          <div className="flex h-8 items-center border-b bg-[var(--ok-bar)] px-4">
            <span className="ok-eyebrow w-16">{t("today.due")}</span>
            <span className="ok-eyebrow flex-1">{t("dashboard.document")}</span>
            <span className="ok-eyebrow w-40">{t("today.task")}</span>
            <span className="ok-eyebrow w-24 text-right">{t("dashboard.amount")}</span>
          </div>

          {tasks.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {t("today.nothingDue")}
            </div>
          ) : (
            tasks.map((item) => {
              const active = item.documentId === selectedId;
              return (
                <button
                  key={item.documentId}
                  type="button"
                  onClick={() => setSelectedId(item.documentId)}
                  onDoubleClick={() =>
                    navigate({
                      to: "/documents/$documentId",
                      params: { documentId: item.documentId },
                    })
                  }
                  className={cn(
                    "ok-row ok-row-2 w-full px-4 text-left",
                    active && "bg-accent shadow-[inset_2px_0_0_var(--ok-accent)]",
                  )}
                >
                  <span
                    className={cn(
                      "ok-num w-16 text-sm",
                      item.isOverdue
                        ? "font-semibold text-[var(--ok-red)]"
                        : "text-muted-foreground",
                    )}
                  >
                    {dueLabel(item)}
                  </span>
                  <span className="min-w-0 flex-1 pr-3">
                    <span className="block truncate text-sm text-foreground">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.correspondentName ?? t("dashboard.unfiled")}
                      {item.documentTypeName ? ` · ${item.documentTypeName}` : ""}
                    </span>
                  </span>
                  <span className="w-40 truncate text-sm text-muted-foreground">
                    {item.taskLabel}
                  </span>
                  <span className="ok-num w-24 text-right text-sm text-foreground">
                    {item.amount != null
                      ? (formatCurrency(item.amount, item.currency ?? "EUR") ?? "—")
                      : "—"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Right: live preview of the selection */}
        <div className="hidden min-h-0 border-l lg:block">
          {selectedId ? (
            <TaskPreview key={selectedId} documentId={selectedId} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
              {t("today.selectPrompt")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
