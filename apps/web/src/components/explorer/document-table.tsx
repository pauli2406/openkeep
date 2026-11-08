import type { ReactNode } from "react";
import { useCallback, useRef } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, ChevronsUpDown, FileSearch } from "lucide-react";
import type { Document } from "@openkeep/types";
import { DocumentProcessingIndicator } from "@/components/document-processing-indicator";
import { CategoryDot } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { colorForValue, formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Only these are sortable — the API's sort enum is createdAt|issueDate|dueDate|title. */
export type SortField = "issueDate" | "title" | "createdAt" | "dueDate";

type Props = {
  documents: Document[];
  /** The full match count, when the API returned only a page of it. */
  total?: number;
  emptyLabel: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onOpen: (documentId: string) => void;
  sort: SortField;
  direction: "asc" | "desc";
  onSortChange: (sort: SortField, direction: "asc" | "desc") => void;
};

export function formatRowDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function SortButton({
  label,
  field,
  sort,
  direction,
  onSortChange,
  className,
}: {
  label: string;
  field: SortField;
  sort: SortField;
  direction: "asc" | "desc";
  onSortChange: (sort: SortField, direction: "asc" | "desc") => void;
  className?: string;
}) {
  const active = sort === field;
  const SortIcon = !active ? ChevronsUpDown : direction === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      className={cn(
        "group/sort inline-flex items-center gap-1 rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        active && "text-foreground",
        className,
      )}
      onClick={() => onSortChange(field, active && direction === "desc" ? "asc" : "desc")}
    >
      {label}
      <SortIcon
        className={cn(
          "size-3.5",
          !active && "opacity-0 transition-opacity group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
        )}
      />
    </button>
  );
}

function SortableHead({
  label,
  className,
  field,
  sort,
  direction,
  onSortChange,
  children,
}: {
  label: string;
  className?: string;
  field: SortField;
  sort: SortField;
  direction: "asc" | "desc";
  onSortChange: (sort: SortField, direction: "asc" | "desc") => void;
  children?: ReactNode;
}) {
  return (
    <TableHead
      className={className}
      aria-sort={
        sort === field ? (direction === "desc" ? "descending" : "ascending") : undefined
      }
    >
      <SortButton
        label={label}
        field={field}
        sort={sort}
        direction={direction}
        onSortChange={onSortChange}
      />
      {children}
    </TableHead>
  );
}

const headClassName = "h-10 text-xs font-medium text-muted-foreground";
const dateColumn = "hidden w-28 @md:table-cell";
const typeColumn = "hidden w-32 @xl:table-cell";
const amountColumn = "w-24 pr-4 text-right @md:w-28 @3xl:pr-2";
const openColumn = "hidden w-10 @3xl:table-cell";

export function DocumentTable({
  documents,
  total,
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
      <Card className="py-0 shadow-card">
        <Empty className="py-20">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileSearch />
            </EmptyMedia>
            <EmptyTitle>{t("explorer.emptyTitle")}</EmptyTitle>
            <EmptyDescription>{emptyLabel}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Card>
    );
  }

  return (
    <Card className="@container gap-0 py-0 shadow-card">
      <Table className="table-fixed">
        <TableHeader className="bg-muted/60">
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-10 w-11 pl-4">
              <Checkbox
                aria-label={t("documents.selectAll")}
                checked={allSelected ? true : selectedIds.length > 0 ? "indeterminate" : false}
                onCheckedChange={() =>
                  onSelectionChange(allSelected ? [] : documents.map((item) => item.id))
                }
              />
            </TableHead>
            <SortableHead
              label={t("dashboard.document")}
              className={headClassName}
              field="title"
              sort={sort}
              direction={direction}
              onSortChange={onSortChange}
            >
              {/* The date column folds away on a narrow table; its sort must not. */}
              <SortButton
                label={t("documents.date")}
                field="issueDate"
                sort={sort}
                direction={direction}
                onSortChange={onSortChange}
                className="ml-4 @md:hidden"
              />
            </SortableHead>
            <TableHead className={cn(headClassName, typeColumn)}>
              {t("today.documentType")}
            </TableHead>
            <SortableHead
              label={t("documents.date")}
              className={cn(headClassName, dateColumn)}
              field="issueDate"
              sort={sort}
              direction={direction}
              onSortChange={onSortChange}
            />
            <TableHead className={cn(headClassName, amountColumn)}>
              {t("dashboard.amount")}
            </TableHead>
            <TableHead className={cn(headClassName, openColumn)} />
          </TableRow>
        </TableHeader>

        <TableBody>
          {documents.map((document, index) => {
            const isSelected = selected.has(document.id);
            const statusTone =
              document.reviewStatus === "pending"
                ? "warning"
                : document.status === "failed"
                  ? "danger"
                  : null;
            const date = formatRowDate(document.issueDate ?? document.createdAt);

            return (
              <TableRow
                key={document.id}
                data-state={isSelected ? "selected" : undefined}
                onClick={() => onOpen(document.id)}
                className="group cursor-pointer data-[state=selected]:bg-brand-soft"
              >
                {/* The whole cell is a safe target: a near-miss must not open the document. */}
                <TableCell className="pl-4" onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    aria-label={document.title}
                    checked={isSelected}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleRow(index, event.shiftKey);
                    }}
                  />
                </TableCell>

                <TableCell className="py-3">
                  <div className="flex min-w-0 gap-2">
                    <CategoryDot
                      className="mt-1.5"
                      color={colorForValue(document.correspondent?.name ?? document.status)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        {/* A real button, so a row opens from the keyboard too. */}
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(document.id);
                          }}
                          className="max-w-full min-w-0 truncate rounded-sm text-left font-medium outline-none group-hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {document.title}
                        </button>
                        {statusTone ? (
                          <Badge variant={statusTone}>
                            {document.reviewStatus === "pending"
                              ? t("documents.flagReview")
                              : t("documents.flagFailed")}
                          </Badge>
                        ) : null}
                        <DocumentProcessingIndicator document={document} />
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {document.correspondent ? (
                          <span className="truncate">{document.correspondent.name}</span>
                        ) : (
                          <Badge variant="outline">{t("documents.flagUnfiled")}</Badge>
                        )}
                        {document.documentType ? (
                          <span className="hidden truncate @md:inline @xl:hidden">
                            · {document.documentType.name}
                          </span>
                        ) : null}
                        <span className="num shrink-0 @md:hidden">· {date}</span>
                      </div>
                    </div>
                  </div>
                </TableCell>

                <TableCell className={cn(typeColumn, "truncate text-muted-foreground")}>
                  {document.documentType?.name ?? "—"}
                </TableCell>

                <TableCell className={cn(dateColumn, "num text-muted-foreground")}>{date}</TableCell>

                <TableCell className={cn(amountColumn, "num font-medium")}>
                  {document.amount != null
                    ? (formatCurrency(document.amount, document.currency ?? "EUR") ?? "—")
                    : "—"}
                </TableCell>

                {/* Open, revealed on hover — no permanent per-row buttons. */}
                <TableCell className={cn(openColumn, "pr-3 text-muted-foreground")}>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-4 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {total !== undefined && total > documents.length ? (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          {t("explorer.showing")
            .replace("{shown}", String(documents.length))
            .replace("{total}", String(total))}
        </p>
      ) : null}
    </Card>
  );
}

/** The table's shape while its rows are on their way. */
export function DocumentTableSkeleton({ label }: { label: string }) {
  return (
    <Card className="gap-0 py-0 shadow-card" role="status" aria-label={label}>
      <div className="h-10 border-b bg-muted/60" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
        <div key={row} className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0">
          <Skeleton className="size-4 shrink-0 rounded-[4px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3.5", row % 2 === 0 ? "w-3/5" : "w-2/5")} />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-3.5 w-20 sm:block" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      ))}
    </Card>
  );
}
