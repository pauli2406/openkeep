import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CircleCheckBig,
  FileSearch,
  ListTodo,
  ReceiptText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { GradientPanel, Page } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBlock, LoadingBlock } from "@/components/explorer/shared";
import { useAuth } from "@/hooks/use-auth";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import { processingRefetchInterval } from "@/lib/document-processing";
import { fetchFilteredDocuments, formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Document } from "@openkeep/types";

export const Route = createFileRoute("/")({
  component: TodayPage,
});

type TaskFilter = "open" | "overdue" | "month" | "invoices";

/** A queue row derived from a document with a due date. */
type TaskItem = {
  documentId: string;
  title: string;
  dueDate: string;
  amount: number | null;
  currency: string | null;
  correspondentName: string | null;
  documentTypeName: string | null;
  taskLabel: string;
  daysUntilDue: number;
  isOverdue: boolean;
};

/** Parse `YYYY-MM-DD` in local time; `new Date(str)` treats it as UTC. */
function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Mirrors the API's buildTaskLabel so rows read the same either way. */
function taskLabelFor(documentTypeName: string | null, isOverdue: boolean): string {
  const normalized = documentTypeName?.trim().toLowerCase() ?? "";
  if (normalized.includes("invoice") || normalized.includes("bill")) {
    return isOverdue ? "Pay immediately" : "Pay";
  }
  if (normalized.includes("contract") || normalized.includes("legal")) {
    return isOverdue ? "Respond immediately" : "Respond";
  }
  if (normalized.includes("insurance")) {
    return isOverdue ? "Review immediately" : "Review";
  }
  return isOverdue ? "Handle immediately" : "Handle";
}

function toTask(document: Document): TaskItem {
  const due = parseDateOnly(document.dueDate ?? "");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysUntilDue = due
    ? Math.round((due.getTime() - today.getTime()) / 86_400_000)
    : 0;
  const isOverdue = daysUntilDue < 0;
  return {
    documentId: document.id,
    title: document.title,
    dueDate: document.dueDate ?? "",
    amount: document.amount ?? null,
    currency: document.currency ?? null,
    correspondentName: document.correspondent?.name ?? null,
    documentTypeName: document.documentType?.name ?? null,
    taskLabel: taskLabelFor(document.documentType?.name ?? null, isOverdue),
    daysUntilDue,
    isOverdue,
  };
}

/** "-4d" when overdue, "6d" otherwise — the design's DUE column. */
function dueLabel(item: TaskItem): string {
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

/** One cell of the extracted-fields grid; `attention` flags what to look at. */
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
        "min-w-0 rounded-lg px-3 py-2",
        attention ? "bg-warning-soft" : "bg-muted",
      )}
    >
      <div className={cn("text-xs", attention ? "text-warning" : "text-muted-foreground")}>
        {label}
      </div>
      <div className="num mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

/** The summary tile in the hero. It is also the queue's filter. */
function FilterTile({
  label,
  count,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl p-3.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-white/50",
        active
          ? "bg-white text-[color:var(--brand)] shadow-raised dark:bg-white/20 dark:text-white"
          : "bg-white/12 text-white hover:bg-white/20",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium">{label}</span>
        <Icon className="size-4 shrink-0 opacity-80" />
      </span>
      <span className="num text-3xl font-semibold tracking-tight">{count}</span>
    </button>
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
      // Deadline rows are selected while task_completed_at IS NULL, so
      // completing the task is what takes the row out of the queue.
      const { error } = await api.PATCH("/api/documents/{id}", {
        params: { path: { id: documentId } },
        body: { taskCompletedAt: new Date().toISOString() },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("dashboard.failedToCompleteTask")));
      }
      // Resolve the review too, when there is one to resolve.
      if (needsReview) {
        await api.POST("/api/documents/{id}/review/resolve", {
          params: { path: { id: documentId } },
          body: {},
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "deadlines"] });
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
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <span className="min-w-0 flex-1 truncate font-medium">{doc?.title ?? "—"}</span>
        {needsReview ? <Badge variant="warning">{t("today.needsReview")}</Badge> : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("today.openDocument")}
          className="text-muted-foreground"
          onClick={() => navigate({ to: "/documents/$documentId", params: { documentId } })}
        >
          <ArrowUpRight />
        </Button>
      </div>

      {/* A scan is a scan: paper stays white, the stage around it takes the theme. */}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-stage p-4">
        {previewUrl && isImage ? (
          <img
            src={previewUrl}
            alt=""
            className="max-w-full rounded-md border border-paper-border bg-paper shadow-card"
          />
        ) : previewUrl ? (
          <iframe
            src={previewUrl}
            title={doc?.title ?? ""}
            className="h-full min-h-[320px] w-full rounded-md border border-paper-border bg-paper shadow-card"
          />
        ) : previewQuery.isLoading ? (
          <Skeleton className="h-full min-h-[320px] w-full" />
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileSearch />
              </EmptyMedia>
              <EmptyDescription>{t("today.previewUnavailable")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <div className="shrink-0 border-t p-4">
        <div className="mb-2.5 text-xs font-medium text-muted-foreground">
          {t("today.extractedFields")}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label={t("dashboard.correspondent")}
            value={doc?.correspondent?.name ?? t("dashboard.unfiled")}
          />
          <Field label={t("today.documentType")} value={doc?.documentType?.name ?? "—"} />
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

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
            <Check />
            {t("today.confirmAndFile")}
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/documents/$documentId", params: { documentId } })}
          >
            {t("today.openDocument")}
          </Button>
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground xl:flex">
            <Kbd>↵</Kbd> {t("today.openHint")}
            <Kbd>⇥</Kbd> {t("today.nextHint")}
          </span>
        </div>
      </div>
    </div>
  );
}

function greetingKey(hour: number) {
  if (hour < 11) return "today.greeting.morning" as const;
  if (hour < 18) return "today.greeting.afternoon" as const;
  return "today.greeting.evening" as const;
}

function TodayPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The insights endpoint caps deadlines at 6 overdue + 6 upcoming, which is
  // not a queue. Take them from the documents endpoint sorted by due date and
  // derive the queue fields the design needs.
  const insightsQuery = useQuery({
    queryKey: ["documents", "deadlines"],
    queryFn: () =>
      fetchFilteredDocuments({
        sort: "dueDate",
        direction: "asc",
        page: 1,
        pageSize: 100,
      }),
    refetchInterval: (query) =>
      processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const allTasks = useMemo(() => {
    const items = insightsQuery.data?.items ?? [];
    return items
      .filter((document) => document.dueDate && !document.taskCompletedAt)
      .map(toTask)
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  }, [insightsQuery.data]);

  const groups = useMemo(() => {
    // Calendar month, matching the API's current-month semantics —
    // not "within 31 days", which would sweep in old overdue items.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      open: allTasks,
      overdue: allTasks.filter((item) => item.isOverdue),
      month: allTasks.filter((item) => {
        const due = parseDateOnly(item.dueDate);
        return due !== null && due >= start && due <= end;
      }),
      // Same family the API's invoiceOnly predicate recognises.
      invoices: allTasks.filter((item) => {
        const name = (item.documentTypeName ?? "").toLowerCase();
        return name.includes("invoice") || name.includes("bill") || name.includes("rechnung");
      }),
    } satisfies Record<TaskFilter, TaskItem[]>;
  }, [allTasks]);

  const tasks = groups[filter];
  const overdueCount = groups.overdue.length;

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
      // Never hijack a focused control: Enter belongs to it, not the queue.
      if (
        target &&
        (/^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName) ||
          target.isContentEditable ||
          target.closest("[role='dialog']"))
      ) {
        return;
      }
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

  const firstName = user?.displayName?.split(/\s+/)[0];
  const greeting = t(greetingKey(new Date().getHours()));
  const summary =
    allTasks.length === 0
      ? t("today.summary.allClear")
      : (overdueCount > 0 ? t("today.summary.open") : t("today.summary.openOnly"))
          .replace("{open}", String(allTasks.length))
          .replace("{overdue}", String(overdueCount));

  return (
    <Page width="wide" className="min-h-full lg:h-full">
      <GradientPanel className="shrink-0 p-5 md:p-6">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </h1>
        <p className="mt-1 text-sm text-white/85 md:text-base">{summary}</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <FilterTile
            label={t("today.openTasks")}
            count={groups.open.length}
            icon={ListTodo}
            active={filter === "open"}
            onClick={() => setFilter("open")}
          />
          <FilterTile
            label={t("today.overdue")}
            count={groups.overdue.length}
            icon={AlertTriangle}
            active={filter === "overdue"}
            onClick={() => setFilter("overdue")}
          />
          <FilterTile
            label={t("today.thisMonth")}
            count={groups.month.length}
            icon={CalendarDays}
            active={filter === "month"}
            onClick={() => setFilter("month")}
          />
          <FilterTile
            label={t("today.invoices")}
            count={groups.invoices.length}
            icon={ReceiptText}
            active={filter === "invoices"}
            onClick={() => setFilter("invoices")}
          />
        </div>
      </GradientPanel>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)]">
        {/* Left: what needs you */}
        <Card className="min-h-0 gap-0 py-0 shadow-card">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="font-medium">{t("today.task")}</h2>
            <span className="text-xs text-muted-foreground">
              {t("today.sortedBy")} {t("today.dueDate")} ·{" "}
              <span className="num">{tasks.length}</span> {t("today.openCount")}
            </span>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-auto p-1.5">
            {tasks.length === 0 ? (
              <Empty className="py-16">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CircleCheckBig />
                  </EmptyMedia>
                  <EmptyTitle>{t("today.nothingDue")}</EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              tasks.map((item) => {
                const active = item.documentId === selectedId;
                return (
                  <button
                    key={item.documentId}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      // The preview rail is hidden below lg, so on narrow
                      // screens a tap has to go straight to the document.
                      if (
                        typeof window !== "undefined" &&
                        !window.matchMedia("(min-width: 1024px)").matches
                      ) {
                        navigate({
                          to: "/documents/$documentId",
                          params: { documentId: item.documentId },
                        });
                        return;
                      }
                      setSelectedId(item.documentId);
                    }}
                    onDoubleClick={() =>
                      navigate({
                        to: "/documents/$documentId",
                        params: { documentId: item.documentId },
                      })
                    }
                    className={cn(
                      "flex w-full items-center gap-3.5 rounded-lg px-2.5 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                      active && "bg-brand-soft hover:bg-brand-soft",
                    )}
                  >
                    <Badge
                      variant={item.isOverdue ? "danger" : "secondary"}
                      className="num w-12 shrink-0"
                    >
                      {dueLabel(item)}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className={cn(item.isOverdue && "font-medium text-danger")}>
                          {item.taskLabel}
                        </span>
                        {" · "}
                        {item.correspondentName ?? t("dashboard.unfiled")}
                        {item.documentTypeName ? ` · ${item.documentTypeName}` : ""}
                      </span>
                    </span>
                    <span className="num w-20 shrink-0 text-right text-sm font-medium">
                      {item.amount != null
                        ? (formatCurrency(item.amount, item.currency ?? "EUR") ?? "—")
                        : "—"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right: live preview of the selection */}
        <Card className="hidden min-h-0 gap-0 py-0 shadow-card lg:flex">
          {selectedId ? (
            <TaskPreview key={selectedId} documentId={selectedId} />
          ) : (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileSearch />
                </EmptyMedia>
                <EmptyDescription>{t("today.selectPrompt")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </Card>
      </div>
    </Page>
  );
}
