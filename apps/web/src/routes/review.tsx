import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Document, ReviewReason } from "@openkeep/types";
import { Check, Inbox, Loader2, RotateCcw } from "lucide-react";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { processingRefetchInterval } from "@/lib/document-processing";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/review")({
  component: ReviewPage,
});

const EMPTY_VALUE = "__none__";

type FieldKey =
  | "correspondentId"
  | "documentTypeId"
  | "issueDate"
  | "dueDate"
  | "amount"
  | "referenceNumber";

type FieldForm = Record<FieldKey, string>;

function formatReviewReason(reason: string): string {
  return reason.replace(/_/g, " ");
}

/**
 * Reasons a confidence score actually speaks to. The others describe a
 * concrete defect — OCR produced nothing, a required field is absent, the
 * format is unsupported, processing or validation failed — and a document
 * can carry one of those while still scoring high overall. Bulk-confirming
 * on confidence alone would mark those resolved without anyone looking.
 */
const CONFIDENCE_ONLY_REASONS = new Set([
  "low_confidence",
  "ocr_low_confidence",
  "classification_ambiguous",
  "correspondent_unresolved",
]);

function isBulkEligible(
  item: { confidence: number | null; reviewReasons?: string[] },
  threshold: number,
): boolean {
  if ((item.confidence ?? 0) * 100 < threshold) return false;
  const reasons = item.reviewReasons ?? [];
  if (reasons.length === 0) return false;
  return reasons.every((reason) => CONFIDENCE_ONLY_REASONS.has(reason));
}

function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function seedForm(item: Document): FieldForm {
  return {
    correspondentId: item.correspondent?.id ?? EMPTY_VALUE,
    documentTypeId: item.documentType?.id ?? EMPTY_VALUE,
    issueDate: item.issueDate ?? "",
    dueDate: item.dueDate ?? "",
    amount: item.amount != null ? String(item.amount) : "",
    referenceNumber: item.referenceNumber ?? "",
  };
}

function daysSince(value: string): number {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 86_400_000));
}

function ReviewPage() {
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<ReviewReason | "all">("all");
  const [form, setForm] = useState<FieldForm | null>(null);
  const [bulkThreshold, setBulkThreshold] = useState(80);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const centreRef = useRef<HTMLDivElement>(null);

  const copy =
    language === "de"
      ? {
          title: "Prüfungswarteschlange",
          docs: (n: number) => (n === 1 ? "Dokument" : "Dokumente"),
          oldest: (d: number) => `ältestes vor ${d} Tagen`,
          all: "Alle",
          confirmFields: "Felder bestätigen",
          confident: "sicher",
          notFound: "nicht gefunden",
          lowConfidence: "unsicher",
          confirmAndFile: "Bestätigen und ablegen",
          reprocess: "Neu verarbeiten",
          skip: "Überspringen",
          hints: "↵ bestätigen · j/k weiter · e bearbeiten · s überspringen",
          bulkConfirm: (n: number, p: number) => `${n} über ${p}% bestätigen`,
          empty: "Alles erledigt — nichts wartet auf Prüfung.",
          fetchError: "Prüfliste konnte nicht geladen werden.",
          retry: "Erneut versuchen",
          correspondent: "Korrespondent",
          documentType: "Dokumententyp",
          issueDate: "Ausstellungsdatum",
          dueDate: "Fälligkeit",
          amount: "Betrag",
          reference: "Referenznummer",
          confidence: "Konfidenz",
          noPreview: "Keine Vorschau",
        }
      : {
          title: "Review queue",
          docs: (n: number) => (n === 1 ? "document" : "documents"),
          oldest: (d: number) => `oldest ${d} days`,
          all: "All",
          confirmFields: "Confirm fields",
          confident: "confident",
          notFound: "not found",
          lowConfidence: "low confidence",
          confirmAndFile: "Confirm and file",
          reprocess: "Reprocess",
          skip: "Skip",
          hints: "↵ confirm · j/k next · e edit · s skip",
          bulkConfirm: (n: number, p: number) => `Confirm ${n} above ${p}%`,
          empty: "All caught up — nothing waiting for review.",
          fetchError: "Failed to load the review queue.",
          retry: "Retry",
          correspondent: "Correspondent",
          documentType: "Document type",
          issueDate: "Issue date",
          dueDate: "Due date",
          amount: "Amount",
          reference: "Reference number",
          confidence: "confidence",
          noPreview: "No preview",
        };

  // --- Data (query keys unchanged) ---

  const reviewQuery = useQuery({
    queryKey: ["documents", "review", "all"],
    // The screen walks the whole queue with j/k and has no pagination
    // control, so anything past the first page would be unreachable. Follow
    // `total` and collect every page instead.
    queryFn: async () => {
      const pageSize = 100;
      const first = await api.GET("/api/documents/review", {
        params: { query: { page: 1, pageSize } },
      });
      if (!first.response.ok || first.error || !first.data) {
        throw new Error(copy.fetchError);
      }
      const collected = [...first.data.items];
      const pages = Math.ceil((first.data.total ?? collected.length) / pageSize);
      for (let page = 2; page <= pages; page += 1) {
        const next = await api.GET("/api/documents/review", {
          params: { query: { page, pageSize } },
        });
        if (!next.response.ok || next.error || !next.data) break;
        collected.push(...next.data.items);
      }
      return { ...first.data, items: collected };
    },
    refetchInterval: (query) =>
      processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const correspondentsQuery = useQuery({
    queryKey: ["taxonomies", "correspondents"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/taxonomies/correspondents", {});
      if (error) throw new Error(copy.fetchError);
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const documentTypesQuery = useQuery({
    queryKey: ["taxonomies", "document-types"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/taxonomies/document-types", {});
      if (error) throw new Error(copy.fetchError);
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const items = useMemo(
    () => (reviewQuery.data?.items ?? []) as unknown as Document[],
    [reviewQuery.data],
  );

  const reasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const reason of item.reviewReasons ?? []) {
        counts.set(reason, (counts.get(reason) ?? 0) + 1);
      }
    }
    return counts;
  }, [items]);

  const queue = useMemo(
    () =>
      reasonFilter === "all"
        ? items
        : items.filter((item) => item.reviewReasons?.includes(reasonFilter)),
    [items, reasonFilter],
  );

  const selected = queue.find((item) => item.id === selectedId) ?? queue[0] ?? null;

  // Keep a valid selection and a seeded form as the queue changes.
  useEffect(() => {
    if (!selected) {
      setForm(null);
      return;
    }
    if (selected.id !== selectedId) setSelectedId(selected.id);
    setForm(seedForm(selected));
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Small preview of the selected document.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setPreviewUrl(null);
    if (!selected) return;
    (async () => {
      const response = await authFetch(`/api/documents/${selected.id}/download`);
      if (!response.ok || cancelled) return;
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setPreviewUrl(objectUrl);
    })().catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Mutations (endpoints unchanged) ---

  const resolveMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await api.POST("/api/documents/{id}/review/resolve", {
        params: { path: { id: documentId } },
        body: {},
      });
      if (error) throw new Error(getApiErrorMessage(error, copy.fetchError));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "review"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "insights"] });
    },
  });

  const requeueMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await api.POST("/api/documents/{id}/review/requeue", {
        params: { path: { id: documentId } },
        body: { force: true },
      });
      if (error) throw new Error(getApiErrorMessage(error, copy.fetchError));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents", "review"] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      documentId: string;
      body: Record<string, unknown>;
    }) => {
      const { error } = await api.PATCH("/api/documents/{id}", {
        params: { path: { id: input.documentId } },
        body: input.body as never,
      });
      if (error) throw new Error(getApiErrorMessage(error, copy.fetchError));
    },
  });

  const advance = useCallback(
    (fromId: string) => {
      const index = queue.findIndex((item) => item.id === fromId);
      const next = queue[index + 1] ?? queue[index - 1] ?? null;
      setSelectedId(next?.id ?? null);
    },
    [queue],
  );

  const confirmSelected = useCallback(async () => {
    if (!selected || !form) return;
    const body: Record<string, unknown> = {};
    const nextCorrespondent =
      form.correspondentId === EMPTY_VALUE ? null : form.correspondentId;
    if ((selected.correspondent?.id ?? null) !== nextCorrespondent) {
      body.correspondentId = nextCorrespondent;
    }
    const nextType = form.documentTypeId === EMPTY_VALUE ? null : form.documentTypeId;
    if ((selected.documentType?.id ?? null) !== nextType) {
      body.documentTypeId = nextType;
    }
    if ((selected.issueDate ?? "") !== form.issueDate) {
      body.issueDate = form.issueDate || null;
    }
    if ((selected.dueDate ?? "") !== form.dueDate) {
      body.dueDate = form.dueDate || null;
    }
    const nextAmount = form.amount === "" ? null : Number(form.amount);
    if ((selected.amount ?? null) !== nextAmount) body.amount = nextAmount;
    if ((selected.referenceNumber ?? "") !== form.referenceNumber) {
      body.referenceNumber = form.referenceNumber || null;
    }

    if (Object.keys(body).length > 0) {
      await updateMutation.mutateAsync({ documentId: selected.id, body });
    }
    await resolveMutation.mutateAsync(selected.id);
    advance(selected.id);
  }, [selected, form, updateMutation, resolveMutation, advance]);

  const bulkConfirm = useCallback(async () => {
    const eligible = queue.filter((item) => isBulkEligible(item, bulkThreshold));
    if (eligible.length === 0) return;
    setBulkRunning(true);
    try {
      for (const item of eligible) {
        await resolveMutation.mutateAsync(item.id);
      }
    } finally {
      setBulkRunning(false);
    }
  }, [queue, bulkThreshold, resolveMutation]);

  // --- The keyboard loop the ticket is about ---

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      // Never fight an open dropdown.
      if (target?.closest("[role='listbox']")) return;
      if (queue.length === 0 || !selected) return;

      if (event.key === "Enter") {
        // Enter is the confirm shortcut, but it is also how you activate a
        // focused button, link or select. Filing the document instead would
        // be a destructive surprise, so only claim Enter when nothing
        // interactive has focus.
        if (target?.closest("button, a, [role='button'], [role='combobox'], summary")) {
          return;
        }
        event.preventDefault();
        void confirmSelected();
        return;
      }
      if (typing) return;

      const index = queue.findIndex((item) => item.id === selected.id);
      if (event.key === "j") {
        event.preventDefault();
        setSelectedId(queue[Math.min(index + 1, queue.length - 1)]?.id ?? null);
      } else if (event.key === "k") {
        event.preventDefault();
        setSelectedId(queue[Math.max(index - 1, 0)]?.id ?? null);
      } else if (event.key === "s") {
        event.preventDefault();
        advance(selected.id);
      } else if (event.key === "e") {
        event.preventDefault();
        const amber = centreRef.current?.querySelector<HTMLInputElement>(
          "input[data-attention='true']",
        );
        (amber ?? centreRef.current?.querySelector("input"))?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [queue, selected, confirmSelected, advance]);

  // --- Rendering ---

  if (reviewQuery.isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (reviewQuery.isError) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--ok-red)]">{copy.fetchError}</p>
        <Button variant="outline" onClick={() => reviewQuery.refetch()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const oldestDays = items.length
    ? Math.max(...items.map((item) => daysSince(item.createdAt)))
    : 0;
  const bulkEligible = queue.filter((item) =>
    isBulkEligible(item, bulkThreshold),
  ).length;

  const fieldConfidence: Record<string, number> =
    (
      selected?.metadata as {
        intelligence?: { extraction?: { fieldConfidence?: Record<string, number> } };
      }
    )?.intelligence?.extraction?.fieldConfidence ?? {};

  /** Amber when the value is missing or its extraction confidence is low. */
  function attention(key: FieldKey, value: string): "missing" | "low" | null {
    if (!value || value === EMPTY_VALUE) return "missing";
    const confidence = fieldConfidence[key.replace(/Id$/, "")];
    if (confidence != null && confidence < 0.7) return "low";
    return null;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header strip */}
      <div className="flex min-h-11 flex-shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5">
        <span className="text-sm font-semibold">{copy.title}</span>
        <span className="text-xs text-muted-foreground">
          <span className="ok-num">{items.length}</span> {copy.docs(items.length)}
          {oldestDays > 0 ? <> · {copy.oldest(oldestDays)}</> : null}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {bulkEligible > 0 ? (
            <>
              <Select
                value={String(bulkThreshold)}
                onValueChange={(value) => setBulkThreshold(Number(value))}
              >
                <SelectTrigger className="h-[26px] w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[60, 70, 80, 90].map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      ≥ {value}%
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void bulkConfirm()}
                disabled={bulkRunning}
              >
                {bulkRunning ? <Loader2 className="animate-spin" /> : <Check />}
                {copy.bulkConfirm(bulkEligible, bulkThreshold)}
              </Button>
            </>
          ) : null}
          <Chip active={reasonFilter === "all"} onClick={() => setReasonFilter("all")}>
            {copy.all} · <span className="ok-num">{items.length}</span>
          </Chip>
          {[...reasonCounts.entries()].map(([reason, count]) => (
            <Chip
              key={reason}
              active={reasonFilter === reason}
              onClick={() =>
                setReasonFilter(
                  reasonFilter === reason ? "all" : (reason as ReviewReason),
                )
              }
            >
              {formatReviewReason(reason)} · <span className="ok-num">{count}</span>
            </Chip>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <Inbox className="h-6 w-6" />
          <p className="text-sm">{copy.empty}</p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]">
          {/* Queue */}
          <div className="min-h-0 overflow-auto border-r">
            {queue.map((item) => {
              const active = item.id === selected?.id;
              const pct = Math.round((item.confidence ?? 0) * 100);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "block w-full border-b border-[var(--ok-border-soft)] px-3 py-2.5 text-left",
                    active && "bg-accent shadow-[inset_2px_0_0_var(--ok-accent)]",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-1.5 w-1.5 flex-shrink-0 rounded-full",
                        pct < 50 ? "bg-[var(--ok-red)]" : "bg-[var(--ok-amber)]",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {item.title}
                    </span>
                    <span
                      className={cn(
                        "ok-num flex-shrink-0 text-xs",
                        pct < 50 ? "text-[var(--ok-red)]" : "text-muted-foreground",
                      )}
                    >
                      {pct}%
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate pl-3.5 text-xs text-muted-foreground">
                    {(item.reviewReasons ?? []).map(formatReviewReason).join(", ")}
                    {" · "}
                    <span className="ok-num">{formatShortDate(item.createdAt)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Centre: the fields to confirm */}
          {selected && form ? (
            <div ref={centreRef} className="min-h-0 overflow-auto p-5">
              <h1 className="ok-page-title">
                {selected.correspondent?.name
                  ? `${selected.correspondent.name} — `
                  : ""}
                {selected.title}
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {[
                  selected.documentType?.name,
                  formatShortDate(selected.issueDate),
                  (selected.reviewReasons ?? []).map(formatReviewReason).join(", "),
                  selected.confidence != null
                    ? `${copy.confidence} ${Math.round(selected.confidence * 100)}%`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>

              <div className="mt-4 rounded-[var(--r-lg)] border bg-card">
                <div className="border-b bg-[var(--ok-bar)] px-3.5 py-2">
                  <span className="ok-eyebrow">{copy.confirmFields}</span>
                </div>
                <div className="flex flex-col gap-2.5 px-3.5 py-3">
                  {(
                    [
                      ["correspondentId", copy.correspondent],
                      ["documentTypeId", copy.documentType],
                      ["issueDate", copy.issueDate],
                      ["dueDate", copy.dueDate],
                      ["amount", copy.amount],
                      ["referenceNumber", copy.reference],
                    ] as Array<[FieldKey, string]>
                  ).map(([key, label]) => {
                    const state = attention(key, form[key]);
                    const annotation =
                      state === "missing"
                        ? copy.notFound
                        : state === "low"
                          ? copy.lowConfidence
                          : copy.confident;
                    const amberInput =
                      state !== null
                        ? "border-[var(--ok-amber)]/40 bg-[var(--ok-amber-soft)]"
                        : undefined;

                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-32 flex-shrink-0 text-sm text-muted-foreground">
                          {label}
                        </span>
                        {key === "correspondentId" || key === "documentTypeId" ? (
                          <Select
                            value={form[key]}
                            onValueChange={(value) =>
                              setForm((current) =>
                                current ? { ...current, [key]: value } : current,
                              )
                            }
                          >
                            <SelectTrigger className={cn("flex-1", amberInput)}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_VALUE}>—</SelectItem>
                              {(key === "correspondentId"
                                ? (correspondentsQuery.data ?? [])
                                : (documentTypesQuery.data ?? [])
                              ).map((entry) => (
                                <SelectItem key={entry.id} value={entry.id}>
                                  {entry.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Input
                            type={
                              key === "issueDate" || key === "dueDate"
                                ? "date"
                                : key === "amount"
                                  ? "number"
                                  : "text"
                            }
                            inputMode={key === "amount" ? "decimal" : undefined}
                            data-attention={state !== null || undefined}
                            value={form[key]}
                            onChange={(event) =>
                              setForm((current) =>
                                current
                                  ? { ...current, [key]: event.target.value }
                                  : current,
                              )
                            }
                            className={cn("ok-num flex-1", amberInput)}
                          />
                        )}
                        <span
                          className={cn(
                            "w-28 flex-shrink-0 text-xs",
                            state === null
                              ? "text-muted-foreground"
                              : "font-semibold text-[var(--ok-amber)]",
                          )}
                        >
                          {annotation}
                        </span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 border-t px-3.5 py-2.5">
                  <Button
                    onClick={() => void confirmSelected()}
                    disabled={resolveMutation.isPending || updateMutation.isPending}
                  >
                    {resolveMutation.isPending || updateMutation.isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Check />
                    )}
                    {copy.confirmAndFile}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => requeueMutation.mutate(selected.id)}
                    disabled={requeueMutation.isPending}
                  >
                    <RotateCcw />
                    {copy.reprocess}
                  </Button>
                  <Button variant="outline" onClick={() => advance(selected.id)}>
                    {copy.skip}
                  </Button>
                  <span className="ok-num ml-auto hidden text-[10.5px] text-muted-foreground lg:inline">
                    {copy.hints}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/documents/$documentId",
                    params: { documentId: selected.id },
                  })
                }
                className="mt-3 text-xs font-semibold text-[var(--ok-accent)] hover:underline"
              >
                {t("today.openDocument")} →
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center text-sm text-muted-foreground">
              {copy.empty}
            </div>
          )}

          {/* Right: the document itself */}
          <div className="hidden min-h-0 flex-col border-l bg-[var(--ok-sunken)] p-4 xl:flex">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                title={selected?.title ?? ""}
                className="h-full w-full rounded-[var(--r-sm)] border border-[var(--ok-paper-border)] bg-[var(--ok-paper)]"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {copy.noPreview}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
