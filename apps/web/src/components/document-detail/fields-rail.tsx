import { useState, type ReactNode } from "react";
import { ChevronRight, Loader2, Lock, LockOpen, Pencil, Plus, TriangleAlert, X } from "lucide-react";
import type {
  Correspondent as TaxonomyCorrespondent,
  DocumentType as TaxonomyDocumentType,
  Tag as TaxonomyTag,
} from "@openkeep/types";

/** Structural: the route file has its own richer Document shape. */
type RailDocument = {
  title: string;
  status: string;
  issueDate: string | null;
  dueDate: string | null;
  expiryDate: string | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  holderName: string | null;
  issuingAuthority: string | null;
  correspondent: { id: string } | null;
  documentType: { id: string } | null;
  tags: Array<{ id: string }>;
  confidence: number | null;
  reviewStatus: string;
  reviewReasons: string[];
  reviewNote: string | null;
  parseProvider: string | null;
  chunkCount: number;
  embeddingStatus: string;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  lastProcessingError: string | null;
  latestProcessingJob?: { status: string } | null;
  metadata: { pageCount?: number };
};
import { DocumentStatusBadge } from "@/components/document-detail/detail-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { isEnterKey } from "@/lib/keyboard";

export const EMPTY_SELECT_VALUE = "__none__";

/** The route owns this state; the rail renders and edits it. */
export type DetailEditForm = {
  title: string;
  issueDate: string;
  dueDate: string;
  expiryDate: string;
  amount: string;
  currency: string;
  referenceNumber: string;
  holderName: string;
  issuingAuthority: string;
  correspondentId: string;
  documentTypeId: string;
  tagIds: string[];
};

type FieldsRailProps = {
  doc: RailDocument;
  form: DetailEditForm;
  onFormChange: (patch: Partial<DetailEditForm>) => void;
  correspondents: TaxonomyCorrespondent[];
  documentTypes: TaxonomyDocumentType[];
  tags: TaxonomyTag[];
  onCreateTag: (name: string) => void;
  createTagPending: boolean;
  onCreateCorrespondent: (name: string) => void;
  createCorrespondentPending: boolean;
  /** manually overridden fields, e.g. ["issueDate", "amount"] */
  lockedFields?: string[];
  /** clears the manual override on the given fields in one request */
  onUnlockFields?: (fields: string[]) => void;
  onSave: () => void;
  onReset: () => void;
  saving: boolean;
  saveError: string | null;
  actionError: string | null;
  lockNote: string | null;
  /** how sure the extraction is, keyed like `lockedFields` */
  fieldConfidence?: Record<string, number | null | undefined>;
  /** the archive is an offline copy: everything reads, nothing edits */
  readOnly?: boolean;
  /** extra read-only panels below the processing section */
  children?: ReactNode;
};

const PARSE_PROVIDER_LABELS: Record<string, string> = {
  "local-ocr": "Local OCR",
  "google-document-ai-enterprise-ocr": "Google Doc AI Enterprise",
  "google-document-ai-gemini-layout-parser": "Google Doc AI Gemini",
  "amazon-textract": "Amazon Textract",
  "azure-ai-document-intelligence": "Azure Document Intelligence",
  "mistral-ocr": "Mistral OCR",
};

export function parseProviderLabel(id: string | null | undefined): string {
  if (!id) return "—";
  return PARSE_PROVIDER_LABELS[id] ?? id;
}

const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  "local-embeddings": "Local (bge-m3)",
  openai: "OpenAI",
  "gemini-embeddings": "Gemini",
  voyage: "Voyage",
  "mistral-embeddings": "Mistral",
};

function formatRailDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatReviewReason(reason: string): string {
  return reason.replace(/_/g, " ");
}

/** How sure the AI is, as a small meter that colours itself by threshold. */
export function ConfidenceMeter({
  value,
  showValue = false,
  className,
}: {
  /** 0 to 1 */
  value: number;
  showValue?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const percent = Math.round(value * 100);
  const label = `${t("documentDetail.confidence")} ${percent}%`;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5", className)} title={label}>
      <Progress
        value={percent}
        aria-label={label}
        className={cn(
          "h-1 w-7",
          value >= 0.8 && "[&>[data-slot=progress-indicator]]:bg-success",
          value >= 0.5 && value < 0.8 && "[&>[data-slot=progress-indicator]]:bg-warning",
          value < 0.5 && "[&>[data-slot=progress-indicator]]:bg-danger",
        )}
      />
      {showValue ? <span className="num text-xs text-muted-foreground">{percent}%</span> : null}
    </span>
  );
}

/** A manual override: the lock says so, and clicking it gives the field back to the AI. */
function UnlockButton({ label, onUnlock }: { label: string; onUnlock: () => void }) {
  const { t } = useI18n();
  const name = `${t("documentDetail.unlock")} ${label}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={name}
          onClick={onUnlock}
          className="group/lock shrink-0 text-warning hover:bg-warning-soft hover:text-warning"
        >
          <Lock className="group-hover/lock:hidden" />
          <LockOpen className="hidden group-hover/lock:block" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  );
}

/** One label-left / value-right row; click to edit in place, dirty in amber. */
function FieldRow({
  label,
  display,
  dirty,
  numeric = false,
  locked = false,
  confidence,
  blurCloses = true,
  onUnlock,
  children,
}: {
  label: string;
  display: string;
  dirty: boolean;
  numeric?: boolean;
  /** the field carries a manual override that pins it against reprocessing */
  locked?: boolean;
  confidence?: number | null;
  /**
   * Rows whose editor owns a portalled popup (the selects) opt out: the popup
   * takes focus outside this element, so a blur handler would tear the editor
   * down the moment the dropdown opened. Those rows close themselves through
   * the popup's own open state instead.
   */
  blurCloses?: boolean;
  onUnlock?: () => void;
  children: (close: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className={cn(
        "group/row flex min-h-9 gap-2 rounded-lg px-2 py-1 transition-colors",
        editing ? "items-start" : "items-center",
        dirty && "bg-warning-soft",
      )}
    >
      <span className={cn("w-28 shrink-0 text-xs font-medium text-muted-foreground", editing && "pt-2")}>
        {label}
      </span>
      {editing ? (
        <div
          className="min-w-0 flex-1"
          // Only leave edit mode when focus lands outside the editor: the
          // amount row holds two inputs and tabbing between them would
          // otherwise close it mid-edit.
          onBlur={(event) => {
            if (!blurCloses) return;
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setEditing(false);
            }
          }}
        >
          {children(() => setEditing(false))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className={cn(
            "-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm font-medium outline-none enabled:hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
            numeric && "num",
            dirty && "text-warning",
            display === "—" && "font-normal text-muted-foreground",
          )}
        >
          <span className="min-w-0 truncate">{display}</span>
          <Pencil
            aria-hidden="true"
            className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-has-disabled/row:hidden"
          />
        </button>
      )}
      {confidence != null && !locked && !dirty && !editing ? (
        <ConfidenceMeter value={confidence} />
      ) : null}
      {locked && onUnlock ? <UnlockButton label={label} onUnlock={onUnlock} /> : null}
    </div>
  );
}

const optionClass = "rounded-full font-normal shadow-none";

export function FieldsRail({
  doc,
  form,
  onFormChange,
  correspondents,
  documentTypes,
  tags,
  onCreateTag,
  createTagPending,
  onCreateCorrespondent,
  createCorrespondentPending,
  lockedFields = [],
  onUnlockFields,
  onSave,
  onReset,
  saving,
  saveError,
  actionError,
  lockNote,
  fieldConfidence = {},
  readOnly = false,
  children,
}: FieldsRailProps) {
  const { t } = useI18n();
  const [tagQuery, setTagQuery] = useState("");
  const [correspondentQuery, setCorrespondentQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(() =>
    Boolean(doc.expiryDate || doc.holderName || doc.issuingAuthority),
  );

  /**
   * Every field the API can pin needs its own unlock control. A row may own
   * more than one lockable field (amount carries currency), so this takes a
   * list and clears them in a single request.
   */
  const unlockProps = (...fields: string[]) => {
    const locked = fields.filter((field) => lockedFields.includes(field));
    return {
      locked: locked.length > 0,
      onUnlock: onUnlockFields ? () => onUnlockFields(locked) : undefined,
      confidence: fieldConfidence[fields[0]!],
    };
  };

  const correspondentName = (id: string) =>
    correspondents.find((entry) => entry.id === id)?.name ?? "—";
  const typeName = (id: string) =>
    documentTypes.find((entry) => entry.id === id)?.name ?? "—";

  const dirty = {
    title: form.title !== doc.title,
    correspondent:
      (doc.correspondent?.id ?? EMPTY_SELECT_VALUE) !== form.correspondentId,
    type: (doc.documentType?.id ?? EMPTY_SELECT_VALUE) !== form.documentTypeId,
    issueDate: (doc.issueDate ?? "") !== form.issueDate,
    dueDate: (doc.dueDate ?? "") !== form.dueDate,
    expiryDate: (doc.expiryDate ?? "") !== form.expiryDate,
    amount: (doc.amount != null ? String(doc.amount) : "") !== form.amount,
    currency: (doc.currency ?? "") !== form.currency,
    reference: (doc.referenceNumber ?? "") !== form.referenceNumber,
    holderName: (doc.holderName ?? "") !== form.holderName,
    issuingAuthority: (doc.issuingAuthority ?? "") !== form.issuingAuthority,
    tags:
      [...form.tagIds].sort().join(",") !==
      doc.tags.map((tag) => tag.id).sort().join(","),
  };
  const isDirty = Object.values(dirty).some(Boolean);

  const selectedTags = tags.filter((tag) => form.tagIds.includes(tag.id));
  const tagFilter = tagQuery.trim().toLowerCase();
  const suggestions = tagFilter
    ? tags
        .filter(
          (tag) =>
            !form.tagIds.includes(tag.id) &&
            tag.name.toLowerCase().includes(tagFilter),
        )
        .slice(0, 6)
    : [];
  const exactTagMatch = tags.some(
    (tag) => tag.name.trim().toLowerCase() === tagFilter,
  );

  const correspondentFilter = correspondentQuery.trim().toLowerCase();
  const correspondentMatches = (
    correspondentFilter
      ? correspondents.filter((entry) =>
          entry.name.toLowerCase().includes(correspondentFilter),
        )
      : correspondents
  ).slice(0, 6);
  const canCreateCorrespondent =
    correspondentFilter.length > 0 &&
    !correspondents.some(
      (entry) => entry.name.trim().toLowerCase() === correspondentFilter,
    );

  const reviewReasons = doc.reviewReasons ?? [];
  const confidencePct =
    doc.confidence != null ? Math.round(doc.confidence * 100) : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-5 px-2 py-4 lg:overflow-y-auto">
        {doc.reviewStatus === "pending" ? (
          <div className="px-2">
            <Alert className="border-warning/30 bg-warning-soft text-warning">
              <TriangleAlert />
              <AlertTitle>{t("documentDetail.whyReview")}</AlertTitle>
              <AlertDescription className="text-warning">
                <p>
                  {reviewReasons.map(formatReviewReason).join(" · ") ||
                    t("documentDetail.needsReview")}
                  {confidencePct != null ? (
                    <>
                      {" · "}
                      <span className="num">{confidencePct}%</span>
                    </>
                  ) : null}
                </p>
                {doc.reviewNote ? <p className="mt-1 opacity-85">{doc.reviewNote}</p> : null}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <section className="flex flex-col gap-1">
          <h2 className="sr-only">{t("documentDetail.fields")}</h2>
          {lockedFields.length > 0 ? (
            <p className="flex items-center gap-1.5 px-2 pb-1 text-xs text-warning">
              <Lock aria-hidden="true" className="size-3" />
              <span>
                <span className="num">{lockedFields.length}</span>{" "}
                {lockedFields.length === 1
                  ? t("documentDetail.fieldLocked")
                  : t("documentDetail.fieldsLocked")}
              </span>
            </p>
          ) : null}

          <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-0.5">
            <FieldRow
              label={t("documentDetail.title")}
              display={form.title || "—"}
              dirty={dirty.title}
              {...unlockProps("title")}
            >
              {(close) => (
                <Input
                  autoFocus
                  value={form.title}
                  onChange={(event) => onFormChange({ title: event.target.value })}
                  onKeyDown={(event) => isEnterKey(event) && close()}
                  className="h-8"
                />
              )}
            </FieldRow>

            {/* Correspondent: search-and-create, the same shape as tags below.
                A plain select would strand you when the correspondent this
                document needs does not exist yet. */}
            <FieldRow
              label={t("dashboard.correspondent")}
              display={
                form.correspondentId === EMPTY_SELECT_VALUE
                  ? "—"
                  : correspondentName(form.correspondentId)
              }
              dirty={dirty.correspondent}
              {...unlockProps("correspondentId")}
            >
              {(close) => (
                <div className="min-w-0">
                  <Input
                    autoFocus
                    value={correspondentQuery}
                    onChange={(event) => setCorrespondentQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") close();
                    }}
                    placeholder={t("documentDetail.searchCorrespondent")}
                    className="h-8"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className={optionClass}
                      onClick={() => {
                        onFormChange({ correspondentId: EMPTY_SELECT_VALUE });
                        setCorrespondentQuery("");
                        close();
                      }}
                    >
                      —
                    </Button>
                    {correspondentMatches.map((entry) => (
                      <Button
                        key={entry.id}
                        type="button"
                        variant="outline"
                        size="xs"
                        className={optionClass}
                        onClick={() => {
                          onFormChange({ correspondentId: entry.id });
                          setCorrespondentQuery("");
                          close();
                        }}
                      >
                        {entry.name}
                      </Button>
                    ))}
                    {canCreateCorrespondent ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className={cn(optionClass, "border-dashed text-brand")}
                        disabled={createCorrespondentPending}
                        onClick={() => {
                          onCreateCorrespondent(correspondentQuery.trim());
                          setCorrespondentQuery("");
                          close();
                        }}
                      >
                        <Plus />
                        {correspondentQuery.trim()}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </FieldRow>

            <FieldRow
              label={t("today.documentType")}
              display={
                form.documentTypeId === EMPTY_SELECT_VALUE
                  ? "—"
                  : typeName(form.documentTypeId)
              }
              dirty={dirty.type}
              blurCloses={false}
              {...unlockProps("documentTypeId")}
            >
              {(close) => (
                <Select
                  defaultOpen
                  value={form.documentTypeId}
                  onValueChange={(value) => onFormChange({ documentTypeId: value })}
                  onOpenChange={(open) => {
                    if (!open) close();
                  }}
                >
                  <SelectTrigger className="h-8 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY_SELECT_VALUE}>—</SelectItem>
                    {documentTypes.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FieldRow>

            <FieldRow
              label={t("today.issueDate")}
              display={formatRailDate(form.issueDate || null)}
              dirty={dirty.issueDate}
              numeric
              {...unlockProps("issueDate")}
            >
              {(close) => (
                <Input
                  autoFocus
                  type="date"
                  value={form.issueDate}
                  onChange={(event) => onFormChange({ issueDate: event.target.value })}
                  onKeyDown={(event) => isEnterKey(event) && close()}
                  className="h-8"
                />
              )}
            </FieldRow>

            <FieldRow
              label={t("dashboard.deadline")}
              display={formatRailDate(form.dueDate || null)}
              dirty={dirty.dueDate}
              numeric
              {...unlockProps("dueDate")}
            >
              {(close) => (
                <Input
                  autoFocus
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => onFormChange({ dueDate: event.target.value })}
                  onKeyDown={(event) => isEnterKey(event) && close()}
                  className="h-8"
                />
              )}
            </FieldRow>

            <FieldRow
              label={t("dashboard.amount")}
              display={
                form.amount
                  ? (formatCurrency(Number(form.amount), form.currency || "EUR") ??
                    form.amount)
                  : "—"
              }
              dirty={dirty.amount || dirty.currency}
              numeric
              {...unlockProps("amount", "currency")}
            >
              {(close) => (
                <div className="flex gap-1">
                  <Input
                    autoFocus
                    type="number"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(event) => onFormChange({ amount: event.target.value })}
                    onKeyDown={(event) => isEnterKey(event) && close()}
                    className="num h-8"
                  />
                  <Input
                    value={form.currency}
                    placeholder="EUR"
                    maxLength={3}
                    onChange={(event) =>
                      onFormChange({ currency: event.target.value.toUpperCase() })
                    }
                    onKeyDown={(event) => isEnterKey(event) && close()}
                    className="num h-8 w-16"
                  />
                </div>
              )}
            </FieldRow>

            <FieldRow
              label={t("today.reference")}
              display={form.referenceNumber || "—"}
              dirty={dirty.reference}
              numeric
              {...unlockProps("referenceNumber")}
            >
              {(close) => (
                <Input
                  autoFocus
                  value={form.referenceNumber}
                  onChange={(event) =>
                    onFormChange({ referenceNumber: event.target.value })
                  }
                  onKeyDown={(event) => isEnterKey(event) && close()}
                  className="num h-8"
                />
              )}
            </FieldRow>

            {/* Tags */}
            <div
              className={cn(
                "flex flex-col gap-1.5 rounded-lg px-2 py-2",
                dirty.tags && "bg-warning-soft",
              )}
            >
              <div className="flex min-h-6 items-center gap-2">
                <span className="flex-1 text-xs font-medium text-muted-foreground">
                  {t("documentDetail.tags")}
                </span>
                {fieldConfidence.tagIds != null && !lockedFields.includes("tagIds") && !dirty.tags ? (
                  <ConfidenceMeter value={fieldConfidence.tagIds} />
                ) : null}
                {lockedFields.includes("tagIds") && onUnlockFields ? (
                  <UnlockButton
                    label={t("documentDetail.tags")}
                    onUnlock={() => onUnlockFields(["tagIds"])}
                  />
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {selectedTags.map((tag) => (
                  <Badge key={tag.id} variant="secondary" className="pr-1">
                    {tag.name}
                    <button
                      type="button"
                      aria-label={`${t("documentDetail.removeTag")} ${tag.name}`}
                      className="rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      onClick={() =>
                        onFormChange({
                          tagIds: form.tagIds.filter((id) => id !== tag.id),
                        })
                      }
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
                <Input
                  value={tagQuery}
                  onChange={(event) => setTagQuery(event.target.value)}
                  placeholder={t("documentDetail.addTag")}
                  className="h-7 w-28 flex-1 text-xs md:text-xs"
                />
              </div>
              {tagFilter ? (
                <div className="flex flex-wrap gap-1">
                  {suggestions.map((tag) => (
                    <Button
                      key={tag.id}
                      type="button"
                      variant="outline"
                      size="xs"
                      className={optionClass}
                      onClick={() => {
                        onFormChange({ tagIds: [...form.tagIds, tag.id] });
                        setTagQuery("");
                      }}
                    >
                      {tag.name}
                    </Button>
                  ))}
                  {!exactTagMatch ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className={cn(optionClass, "border-dashed text-brand")}
                      disabled={createTagPending}
                      onClick={() => {
                        onCreateTag(tagQuery.trim());
                        setTagQuery("");
                      }}
                    >
                      <Plus />
                      {tagQuery.trim()}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </fieldset>

          {/* Rarely-used fields stay out of the way until a document has them. */}
          <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="group/more ml-1 text-muted-foreground"
              >
                <ChevronRight className="transition-transform group-data-[state=open]/more:rotate-90" />
                {t("documentDetail.moreFields")}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-0.5 pt-1">
                <FieldRow
                  label={t("documentDetail.expiryDate")}
                  display={formatRailDate(form.expiryDate || null)}
                  dirty={dirty.expiryDate}
                  numeric
                  {...unlockProps("expiryDate")}
                >
                  {(close) => (
                    <Input
                      autoFocus
                      type="date"
                      value={form.expiryDate}
                      onChange={(event) => onFormChange({ expiryDate: event.target.value })}
                      onKeyDown={(event) => isEnterKey(event) && close()}
                      className="h-8"
                    />
                  )}
                </FieldRow>
                <FieldRow
                  label={t("documentDetail.holderName")}
                  display={form.holderName || "—"}
                  dirty={dirty.holderName}
                  {...unlockProps("holderName")}
                >
                  {(close) => (
                    <Input
                      autoFocus
                      value={form.holderName}
                      onChange={(event) => onFormChange({ holderName: event.target.value })}
                      onKeyDown={(event) => isEnterKey(event) && close()}
                      className="h-8"
                    />
                  )}
                </FieldRow>
                <FieldRow
                  label={t("documentDetail.issuingAuthority")}
                  display={form.issuingAuthority || "—"}
                  dirty={dirty.issuingAuthority}
                  {...unlockProps("issuingAuthority")}
                >
                  {(close) => (
                    <Input
                      autoFocus
                      value={form.issuingAuthority}
                      onChange={(event) =>
                        onFormChange({ issuingAuthority: event.target.value })
                      }
                      onKeyDown={(event) => isEnterKey(event) && close()}
                      className="h-8"
                    />
                  )}
                </FieldRow>
              </fieldset>
            </CollapsibleContent>
          </Collapsible>

          {actionError ? (
            <div className="px-2 pt-1">
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            </div>
          ) : null}
        </section>

        {/* Where the document stands in the pipeline. */}
        <section className="mx-2 flex flex-col gap-3 rounded-xl border bg-muted/40 p-3.5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{t("documentDetail.processing")}</h2>
            <DocumentStatusBadge doc={doc} />
          </div>
          {doc.lastProcessingError ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertDescription className="wrap-anywhere">
                {doc.lastProcessingError}
              </AlertDescription>
            </Alert>
          ) : null}
          <dl className="flex flex-col gap-1.5 text-xs">
            {(
              [
                [t("documentDetail.parseProvider"), parseProviderLabel(doc.parseProvider)],
                [
                  t("documentDetail.embedding"),
                  `${doc.embeddingStatus}${
                    doc.embeddingProvider
                      ? ` · ${
                          EMBEDDING_PROVIDER_LABELS[doc.embeddingProvider] ??
                          doc.embeddingProvider
                        }`
                      : ""
                  }${doc.embeddingModel ? ` · ${doc.embeddingModel}` : ""}`,
                ],
                [t("documentDetail.pages"), String(doc.metadata.pageCount ?? "—")],
                [t("documentDetail.chunks"), String(doc.chunkCount)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
                <dd className="num min-w-0 flex-1 truncate" title={value}>
                  {value}
                </dd>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <dt className="w-24 shrink-0 text-muted-foreground">
                {t("documentDetail.confidence")}
              </dt>
              <dd className="min-w-0 flex-1">
                {doc.confidence != null ? (
                  <ConfidenceMeter value={doc.confidence} showValue />
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </section>

        {children}
      </div>

      {/* One save bar at the bottom of the inspector. */}
      {isDirty ? (
        <div className="sticky bottom-0 z-10 flex shrink-0 flex-col gap-2 border-t bg-card px-4 py-3">
          {lockNote ? <p className="text-xs text-warning">{lockNote}</p> : null}
          {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onSave} disabled={saving || readOnly}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {t("documentDetail.save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onReset} disabled={saving || readOnly}>
              {t("documentDetail.discard")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
