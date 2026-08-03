import { useCallback, useRef } from "react";
import { ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import type { Document } from "@openkeep/types";
import { Badge } from "@/components/ui/badge";
import { colorForValue, formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Only these are sortable — the API's sort enum is createdAt|issueDate|dueDate|title. */
export type SortField = "issueDate" | "title" | "createdAt" | "dueDate";

type Props = {
  documents: Document[];
  emptyLabel: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onOpen: (documentId: string) => void;
  sort: SortField;
  direction: "asc" | "desc";
  onSortChange: (sort: SortField, direction: "asc" | "desc") => void;
};

function formatRowDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function HeaderCell({
  label,
  className,
  field,
  sort,
  direction,
  onSortChange,
}: {
  label: string;
  className?: string;
  field?: SortField;
  sort: SortField;
  direction: "asc" | "desc";
  onSortChange: (sort: SortField, direction: "asc" | "desc") => void;
}) {
  if (!field) {
    return <span className={cn("ok-eyebrow", className)}>{label}</span>;
  }
  const active = sort === field;
  return (
    <button
      type="button"
      className={cn(
        "ok-eyebrow inline-flex items-center gap-1 transition-colors hover:text-foreground",
        active && "text-foreground",
        className,
      )}
      onClick={() =>
        onSortChange(field, active && direction === "desc" ? "asc" : "desc")
      }
    >
      {label}
      {active ? (
        direction === "desc" ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUp className="h-3 w-3" />
        )
      ) : null}
    </button>
  );
}

export function DocumentTable({
  documents,
  emptyLabel,
  selectedIds,
  onSelectionChange,
  onOpen,
  sort,
  direction,
  onSortChange,
}: Props) {
  const { t } = useI18n();
  // Anchored by id: a re-sort or filter changes indices under us.
  const lastClickedId = useRef<string | null>(null);
  const selected = new Set(selectedIds);
  const allSelected = documents.length > 0 && selectedIds.length === documents.length;

  const toggleRow = useCallback(
    (index: number, shiftKey: boolean) => {
      const document = documents[index];
      if (!document) return;

      // Shift extends from the last row the user touched, resolved by id
      // so re-sorting or filtering cannot slice a stale range.
      const anchorIndex = lastClickedId.current
        ? documents.findIndex((item) => item.id === lastClickedId.current)
        : -1;
      if (shiftKey && anchorIndex !== -1) {
        const [from, to] = [anchorIndex, index].sort((a, b) => a - b);
        const range = documents.slice(from, to + 1).map((item) => item.id);
        const next = new Set(selectedIds);
        const turningOn = !selected.has(document.id);
        for (const id of range) {
          if (turningOn) next.add(id);
          else next.delete(id);
        }
        onSelectionChange([...next]);
        return;
      }

      lastClickedId.current = document.id;
      const next = new Set(selectedIds);
      if (next.has(document.id)) next.delete(document.id);
      else next.add(document.id);
      onSelectionChange([...next]);
    },
    [documents, onSelectionChange, selected, selectedIds],
  );

  if (documents.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center border-t text-sm text-muted-foreground">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex h-8 items-center gap-3 border-b bg-[var(--ok-bar)] px-4">
        <input
          type="checkbox"
          aria-label={t("documents.selectAll")}
          checked={allSelected}
          onChange={() =>
            onSelectionChange(allSelected ? [] : documents.map((item) => item.id))
          }
          className="h-3 w-3 flex-shrink-0 accent-[var(--ok-accent)]"
        />
        <HeaderCell
          label={t("documents.date")}
          className="w-24"
          field="issueDate"
          sort={sort}
          direction={direction}
          onSortChange={onSortChange}
        />
        <HeaderCell
          label={t("dashboard.document")}
          className="min-w-0 flex-1"
          field="title"
          sort={sort}
          direction={direction}
          onSortChange={onSortChange}
        />
        <HeaderCell
          label={t("dashboard.correspondent")}
          className="hidden w-44 lg:block"
          sort={sort}
          direction={direction}
          onSortChange={onSortChange}
        />
        <HeaderCell
          label={t("today.documentType")}
          className="hidden w-28 md:block"
          sort={sort}
          direction={direction}
          onSortChange={onSortChange}
        />
        <HeaderCell
          label={t("dashboard.amount")}
          className="w-24 text-right"
          sort={sort}
          direction={direction}
          onSortChange={onSortChange}
        />
        <span className="w-5 flex-shrink-0" />
      </div>

      {documents.map((document, index) => {
        const isSelected = selected.has(document.id);
        const statusTone =
          document.reviewStatus === "pending"
            ? "warn"
            : document.status === "failed"
              ? "bad"
              : null;

        return (
          <div
            key={document.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(document.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onOpen(document.id);
            }}
            className={cn(
              "ok-row group cursor-pointer gap-3 px-4",
              isSelected && "bg-accent shadow-[inset_2px_0_0_var(--ok-accent)]",
            )}
          >
            <input
              type="checkbox"
              aria-label={document.title}
              checked={isSelected}
              onClick={(event) => {
                event.stopPropagation();
                toggleRow(index, event.shiftKey);
              }}
              onChange={() => {}}
              className={cn(
                "h-3 w-3 flex-shrink-0 accent-[var(--ok-accent)] transition-opacity",
                // Hidden only where hover exists; always visible on touch,
                // and always visible once focused.
                !isSelected &&
                  "focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
              )}
            />

            <span className="ok-num w-24 flex-shrink-0 text-sm text-muted-foreground">
              {formatRowDate(document.issueDate ?? document.createdAt)}
            </span>

            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 flex-shrink-0 rounded-[2px]"
                style={{
                  background: colorForValue(
                    document.correspondent?.name ?? document.status,
                  ),
                }}
              />
              <span className="truncate text-sm text-foreground">{document.title}</span>
              {statusTone ? (
                <Badge variant={statusTone} className="flex-shrink-0">
                  {document.reviewStatus === "pending"
                    ? t("documents.flagReview")
                    : t("documents.flagFailed")}
                </Badge>
              ) : null}
              {!document.correspondent ? (
                <Badge variant="outline" className="flex-shrink-0">
                  {t("documents.flagUnfiled")}
                </Badge>
              ) : null}
            </span>

            <span className="hidden w-44 flex-shrink-0 truncate text-sm text-muted-foreground lg:block">
              {document.correspondent?.name ?? t("dashboard.unfiled")}
            </span>

            <span className="hidden w-28 flex-shrink-0 truncate text-sm text-muted-foreground md:block">
              {document.documentType?.name ?? "—"}
            </span>

            <span className="ok-num w-24 flex-shrink-0 text-right text-sm text-foreground">
              {document.amount != null
                ? (formatCurrency(document.amount, document.currency ?? "EUR") ?? "—")
                : "—"}
            </span>

            {/* Open, revealed on hover — no permanent per-row buttons. */}
            <span
              aria-hidden="true"
              className="w-5 flex-shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </span>
          </div>
        );
      })}
    </div>
  );
}
