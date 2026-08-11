import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react";
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
  metadata: { pageCount?: number };
};
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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
  onReprocess: () => void;
  reprocessPending: boolean;
  onDelete: () => void;
  deletePending: boolean;
  processing: boolean;
};

const PARSE_PROVIDER_LABELS: Record<string, string> = {
  "local-ocr": "Local OCR",
  "aws-textract": "Amazon Textract",
  "azure-document-intelligence": "Azure Document Intelligence",
  "google-document-ai": "Google Document AI",
  "mistral-ocr": "Mistral OCR",
};

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

/** One label-left / value-right row; click to edit in place, dirty in amber. */
function FieldRow({
  label,
  display,
  dirty,
  mono = false,
  locked = false,
  blurCloses = true,
  onUnlock,
  children,
}: {
  label: string;
  display: string;
  dirty: boolean;
  mono?: boolean;
  /** the field carries a manual override that pins it against reprocessing */
  locked?: boolean;
  /**
   * Rows whose editor owns a portalled popup (the selects) opt out: the popup
   * takes focus outside this element, so a blur handler would tear the editor
   * down the moment the dropdown opened. Those rows close themselves through
   * the popup's own open state instead.
   */
  blurCloses?: boolean;
  onUnlock?: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);

  return (
    <div
      className={cn(
        "flex min-h-[30px] items-center gap-2 rounded-[var(--r-sm)] px-1.5 py-0.5",
        dirty && "bg-[var(--ok-amber-soft)]",
      )}
    >
      <span className="w-[112px] flex-shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      {editing ? (
        <div
          className="min-w-0 flex-1"
          // Only leave edit mode when focus lands outside the editor — the
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
            "min-w-0 flex-1 truncate rounded-[var(--r-sm)] text-left text-sm font-medium hover:bg-secondary",
            mono && "ok-num",
            dirty && "text-[var(--ok-amber)]",
            display === "—" && "font-normal text-muted-foreground",
          )}
        >
          {display}
        </button>
      )}
      {locked && onUnlock ? (
        <button
          type="button"
          aria-label={`${t("documentDetail.unlock")} ${label}`}
          title={`${t("documentDetail.unlock")} ${label}`}
          onClick={onUnlock}
          className="flex-shrink-0 rounded-[var(--r-sm)] border border-[var(--ok-amber)]/40 bg-[var(--ok-amber-soft)] px-1.5 text-[10px] font-semibold text-[var(--ok-amber)] hover:brightness-95"
        >
          {t("documentDetail.unlock")}
        </button>
      ) : null}
    </div>
  );
}

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
  onReprocess,
  reprocessPending,
  onDelete,
  deletePending,
  processing,
}: FieldsRailProps) {
  const { t } = useI18n();
  const [tagQuery, setTagQuery] = useState("");
  const [correspondentQuery, setCorrespondentQuery] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [processingOpen, setProcessingOpen] = useState(false);

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
    <aside className="flex min-h-0 flex-col border-l bg-[var(--ok-bar)]">
      <div className="min-h-0 flex-1 overflow-auto">
        {/* Fields */}
        <section className="border-b px-3.5 py-3">
          <p className="ok-eyebrow mb-2">{t("documentDetail.fields")}</p>
          {lockedFields.length > 0 ? (
            <p className="mb-1.5 text-xs text-[var(--ok-amber)]">
              <span className="ok-num">{lockedFields.length}</span>{" "}
              {lockedFields.length === 1
                ? t("documentDetail.fieldLocked")
                : t("documentDetail.fieldsLocked")}
            </p>
          ) : null}
          <div className="flex flex-col gap-0.5">
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
                  onKeyDown={(event) => event.key === "Enter" && close()}
                  className="h-[26px]"
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
                    className="h-[26px]"
                  />
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onFormChange({ correspondentId: EMPTY_SELECT_VALUE });
                        setCorrespondentQuery("");
                        close();
                      }}
                      className="rounded-[var(--r-pill)] border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
                    >
                      —
                    </button>
                    {correspondentMatches.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => {
                          onFormChange({ correspondentId: entry.id });
                          setCorrespondentQuery("");
                          close();
                        }}
                        className="rounded-[var(--r-pill)] border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
                      >
                        {entry.name}
                      </button>
                    ))}
                    {canCreateCorrespondent ? (
                      <button
                        type="button"
                        disabled={createCorrespondentPending}
                        onClick={() => {
                          onCreateCorrespondent(correspondentQuery.trim());
                          setCorrespondentQuery("");
                          close();
                        }}
                        className="inline-flex items-center gap-1 rounded-[var(--r-pill)] border border-dashed px-2 py-0.5 text-xs text-[var(--ok-accent)] hover:bg-secondary"
                      >
                        <Plus className="h-3 w-3" />
                        {correspondentQuery.trim()}
                      </button>
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
                  <SelectTrigger className="h-[26px]">
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
              mono
              {...unlockProps("issueDate")}
            >
              {(close) => (
                <Input
                  autoFocus
                  type="date"
                  value={form.issueDate}
                  onChange={(event) => onFormChange({ issueDate: event.target.value })}
                  onKeyDown={(event) => event.key === "Enter" && close()}
                  className="h-[26px]"
                />
              )}
            </FieldRow>

            <FieldRow
              label={t("dashboard.deadline")}
              display={formatRailDate(form.dueDate || null)}
              dirty={dirty.dueDate}
              mono
              {...unlockProps("dueDate")}
            >
              {(close) => (
                <Input
                  autoFocus
                  type="date"
                  value={form.dueDate}
                  onChange={(event) => onFormChange({ dueDate: event.target.value })}
                  onKeyDown={(event) => event.key === "Enter" && close()}
                  className="h-[26px]"
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
              mono
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
                    onKeyDown={(event) => event.key === "Enter" && close()}
                    className="ok-num h-[26px]"
                  />
                  <Input
                    value={form.currency}
                    placeholder="EUR"
                    maxLength={3}
                    onChange={(event) =>
                      onFormChange({ currency: event.target.value.toUpperCase() })
                    }
                    onKeyDown={(event) => event.key === "Enter" && close()}
                    className="ok-num h-[26px] w-16"
                  />
                </div>
              )}
            </FieldRow>

            <FieldRow
              label={t("today.reference")}
              display={form.referenceNumber || "—"}
              dirty={dirty.reference}
              mono
              {...unlockProps("referenceNumber")}
            >
              {(close) => (
                <Input
                  autoFocus
                  value={form.referenceNumber}
                  onChange={(event) =>
                    onFormChange({ referenceNumber: event.target.value })
                  }
                  onKeyDown={(event) => event.key === "Enter" && close()}
                  className="ok-num h-[26px]"
                />
              )}
            </FieldRow>
          </div>

          {/* Tags */}
          <div
            className={cn(
              "mt-1 rounded-[var(--r-sm)] px-1.5 py-1",
              dirty.tags && "bg-[var(--ok-amber-soft)]",
            )}
          >
            <span className="text-xs text-muted-foreground">
              {t("documentDetail.tags")}
            </span>
            {lockedFields.includes("tagIds") && onUnlockFields ? (
              <button
                type="button"
                aria-label={`${t("documentDetail.unlock")} ${t("documentDetail.tags")}`}
                title={`${t("documentDetail.unlock")} ${t("documentDetail.tags")}`}
                onClick={() => onUnlockFields(["tagIds"])}
                className="ml-1.5 rounded-[var(--r-sm)] border border-[var(--ok-amber)]/40 bg-[var(--ok-amber-soft)] px-1.5 text-[10px] font-semibold text-[var(--ok-amber)] hover:brightness-95"
              >
                {t("documentDetail.unlock")}
              </button>
            ) : null}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {selectedTags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-[var(--r-pill)] border bg-card px-2 py-0.5 text-xs"
                >
                  {tag.name}
                  <button
                    type="button"
                    aria-label={`${t("documentDetail.removeTag")} ${tag.name}`}
                    onClick={() =>
                      onFormChange({
                        tagIds: form.tagIds.filter((id) => id !== tag.id),
                      })
                    }
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                </span>
              ))}
              <Input
                value={tagQuery}
                onChange={(event) => setTagQuery(event.target.value)}
                placeholder={t("documentDetail.addTag")}
                className="h-[24px] w-28 flex-1"
              />
            </div>
            {tagFilter ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {suggestions.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => {
                      onFormChange({ tagIds: [...form.tagIds, tag.id] });
                      setTagQuery("");
                    }}
                    className="rounded-[var(--r-pill)] border bg-card px-2 py-0.5 text-xs hover:bg-secondary"
                  >
                    {tag.name}
                  </button>
                ))}
                {!exactTagMatch ? (
                  <button
                    type="button"
                    disabled={createTagPending}
                    onClick={() => {
                      onCreateTag(tagQuery.trim());
                      setTagQuery("");
                    }}
                    className="inline-flex items-center gap-1 rounded-[var(--r-pill)] border border-dashed px-2 py-0.5 text-xs text-[var(--ok-accent)] hover:bg-secondary"
                  >
                    <Plus className="h-3 w-3" />
                    {tagQuery.trim()}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Rarely-used fields collapse so the rail fits 900px. */}
          <button
            type="button"
            onClick={() => setMoreOpen((current) => !current)}
            className="mt-1.5 flex items-center gap-1 px-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {moreOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {t("documentDetail.moreFields")}
          </button>
          {moreOpen ? (
            <div className="mt-0.5 flex flex-col gap-0.5">
              <FieldRow
                label={t("documentDetail.expiryDate")}
                display={formatRailDate(form.expiryDate || null)}
                dirty={dirty.expiryDate}
                mono
                {...unlockProps("expiryDate")}
              >
                {(close) => (
                  <Input
                    autoFocus
                    type="date"
                    value={form.expiryDate}
                    onChange={(event) => onFormChange({ expiryDate: event.target.value })}
                    onKeyDown={(event) => event.key === "Enter" && close()}
                    className="h-[26px]"
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
                    onKeyDown={(event) => event.key === "Enter" && close()}
                    className="h-[26px]"
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
                    onKeyDown={(event) => event.key === "Enter" && close()}
                    className="h-[26px]"
                  />
                )}
              </FieldRow>
            </div>
          ) : null}
        </section>

        {/* Why it needs review */}
        {doc.reviewStatus === "pending" ? (
          <section className="border-b px-3.5 py-3">
            <p className="ok-eyebrow mb-2">{t("documentDetail.whyReview")}</p>
            <div className="rounded-[var(--r-md)] border border-[var(--ok-amber)]/30 bg-[var(--ok-amber-soft)] px-2.5 py-2">
              <p className="text-sm font-semibold text-[var(--ok-amber)]">
                {reviewReasons.map(formatReviewReason).join(" · ") ||
                  t("documentDetail.needsReview")}
                {confidencePct != null ? (
                  <>
                    {" · "}
                    <span className="ok-num">{confidencePct}%</span>
                  </>
                ) : null}
              </p>
              {doc.reviewNote ? (
                <p className="mt-1 text-xs text-[var(--ok-amber)] opacity-85">
                  {doc.reviewNote}
                </p>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* Processing disclosure */}
        <section className="border-b px-3.5 py-3">
          <button
            type="button"
            onClick={() => setProcessingOpen((current) => !current)}
            className="flex w-full items-center gap-1"
          >
            {processingOpen ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
            <span className="ok-eyebrow">{t("documentDetail.processing")}</span>
            <span className="ok-num ml-auto text-xs text-muted-foreground">
              {PARSE_PROVIDER_LABELS[doc.parseProvider ?? ""] ??
                doc.parseProvider ??
                "—"}
              {confidencePct != null ? ` · ${confidencePct}%` : ""}
            </span>
          </button>
          {processingOpen ? (
            <dl className="mt-2 space-y-1">
              {[
                [
                  t("documentDetail.parseProvider"),
                  PARSE_PROVIDER_LABELS[doc.parseProvider ?? ""] ??
                    doc.parseProvider ??
                    "—",
                ],
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
                [
                  t("documentDetail.confidence"),
                  confidencePct != null ? `${confidencePct}%` : "—",
                ],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center gap-2">
                  <dt className="w-[112px] flex-shrink-0 text-xs text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="ok-num min-w-0 flex-1 truncate text-xs">{value}</dd>
                </div>
              ))}
              {doc.lastProcessingError ? (
                <div className="rounded-[var(--r-md)] border border-[var(--ok-red)]/30 bg-[var(--ok-red-soft)] px-2.5 py-1.5 text-xs text-[var(--ok-red)]">
                  {doc.lastProcessingError}
                </div>
              ) : null}
            </dl>
          ) : null}
        </section>

        {/* Danger / maintenance actions */}
        <section className="px-3.5 py-3">
          {actionError ? (
            <p className="mb-2 text-xs text-[var(--ok-red)]" role="alert">
              {actionError}
            </p>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={onReprocess}
              disabled={reprocessPending || processing}
            >
              {reprocessPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              {t("documentDetail.reprocess")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-[var(--ok-red)]"
              onClick={onDelete}
              disabled={deletePending || processing}
            >
              {deletePending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t("documents.bulkDelete")}
            </Button>
          </div>
        </section>
      </div>

      {/* One save bar at the bottom of the rail. */}
      {isDirty ? (
        <div className="flex-shrink-0 border-t bg-card px-3.5 py-2.5">
          {lockNote ? (
            <p className="mb-1.5 text-xs text-[var(--ok-amber)]">{lockNote}</p>
          ) : null}
          {saveError ? (
            <p className="mb-1.5 text-xs text-[var(--ok-red)]">{saveError}</p>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : null}
              {t("documentDetail.save")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
              {t("documentDetail.discard")}
            </Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
