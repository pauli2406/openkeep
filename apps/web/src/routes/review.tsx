import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Document, ReviewReason } from "@openkeep/types";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  FileSearch,
  FileUp,
  Home,
  ListChecks,
  ListOrdered,
  RotateCcw,
  SearchX,
  SkipForward,
} from "lucide-react";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import { IconTile, Page, PageHeader } from "@/components/layout/page";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { processingRefetchInterval } from "@/lib/document-processing";
import { useI18n } from "@/lib/i18n";
import { createObjectUrlLease } from "@/lib/object-url";
import { refreshArchiveDocumentState } from "@/lib/archive-document-state";
import {
  asFetchSignal,
  useArchiveRequestScope,
} from "@/lib/archive-request-scope";
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

type Preview =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; url: string; isImage: boolean };

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

type ReasonCopy = Record<ReviewReason, { label: string; why: string }>;

const COPY = {
  de: {
    title: "Prüfungswarteschlange",
    subtitle: "Ein Dokument nach dem anderen prüfen und ablegen.",
    docs: (n: number): string => (n === 1 ? "Dokument" : "Dokumente"),
    oldest: (d: number) => `ältestes vor ${d} Tagen`,
    all: "Alle",
    queue: "Warteschlange",
    queueHint: "Wähle das Dokument, das du als Nächstes prüfen möchtest.",
    position: (at: number, of: number) => `${at} von ${of}`,
    previous: "Vorheriges Dokument",
    next: "Nächstes Dokument",
    why: "Warum es deine Prüfung braucht",
    confirmFields: "Felder bestätigen",
    confident: "sicher",
    notFound: "nicht gefunden",
    lowConfidence: "unsicher",
    confirmAndFile: "Bestätigen und ablegen",
    reprocess: "Neu verarbeiten",
    skip: "Überspringen",
    hintNext: "weiter",
    hintEdit: "bearbeiten",
    bulkConfirm: (n: number, p: number) => `${n} über ${p}% bestätigen`,
    bulkThreshold: "Mindestkonfidenz",
    emptyTitle: "Alles erledigt",
    emptyBody:
      "Gerade wartet nichts auf deine Prüfung. Neue Dokumente landen hier, wenn OpenKeep sich nicht sicher ist.",
    filed: (n: number) =>
      n === 1
        ? "Du hast gerade 1 Dokument abgelegt."
        : `Du hast gerade ${n} Dokumente abgelegt.`,
    filterEmptyTitle: "Für diesen Grund ist nichts mehr offen",
    filterEmptyBody: "Die übrigen Dokumente warten noch unter anderen Gründen.",
    showAll: "Alle anzeigen",
    fetchError: "Prüfliste konnte nicht geladen werden.",
    retry: "Erneut versuchen",
    correspondent: "Korrespondent",
    documentType: "Dokumententyp",
    issueDate: "Ausstellungsdatum",
    dueDate: "Fälligkeit",
    amount: "Betrag",
    reference: "Referenznummer",
    confidence: "Konfidenz",
    loadingPreview: "Vorschau wird geladen",
    noPreview: "Keine Vorschau",
    reasons: {
      low_confidence: {
        label: "Niedrige Konfidenz",
        why: "Die Extraktion liegt insgesamt unter der Prüfschwelle.",
      },
      processing_failed: {
        label: "Verarbeitung fehlgeschlagen",
        why: "Die Verarbeitung ist abgebrochen. Verarbeite das Dokument neu oder korrigiere die Felder von Hand.",
      },
      ocr_empty: {
        label: "Kein Text erkannt",
        why: "Die Texterkennung hat keinen lesbaren Text geliefert.",
      },
      ocr_low_confidence: {
        label: "Unsichere Texterkennung",
        why: "Die Texterkennung ist unsicher, deshalb können Werte falsch sein.",
      },
      missing_key_fields: {
        label: "Pflichtfelder fehlen",
        why: "Ein Feld, das dieser Dokumententyp braucht, wurde nicht gefunden.",
      },
      unsupported_format: {
        label: "Format nicht unterstützt",
        why: "Dieses Dateiformat kann nicht automatisch gelesen werden.",
      },
      classification_ambiguous: {
        label: "Klassifizierung unklar",
        why: "Das Dokument passt zu mehr als einem Dokumententyp.",
      },
      correspondent_unresolved: {
        label: "Korrespondent unklar",
        why: "Der Absender passt zu keinem bekannten Korrespondenten.",
      },
      validation_failed: {
        label: "Prüfung fehlgeschlagen",
        why: "Extrahierte Werte haben eine Plausibilitätsprüfung nicht bestanden.",
      },
    } satisfies ReasonCopy,
  },
  en: {
    title: "Review queue",
    subtitle: "Check and file one document at a time.",
    docs: (n: number): string => (n === 1 ? "document" : "documents"),
    oldest: (d: number) => `oldest ${d} days`,
    all: "All",
    queue: "Queue",
    queueHint: "Pick the document you want to review next.",
    position: (at: number, of: number) => `${at} of ${of}`,
    previous: "Previous document",
    next: "Next document",
    why: "Why it needs you",
    confirmFields: "Confirm fields",
    confident: "confident",
    notFound: "not found",
    lowConfidence: "low confidence",
    confirmAndFile: "Confirm and file",
    reprocess: "Reprocess",
    skip: "Skip",
    hintNext: "next",
    hintEdit: "edit",
    bulkConfirm: (n: number, p: number) => `Confirm ${n} above ${p}%`,
    bulkThreshold: "Minimum confidence",
    emptyTitle: "All caught up",
    emptyBody:
      "Nothing is waiting for you. New documents land here when OpenKeep isn't sure about them.",
    filed: (n: number) =>
      n === 1 ? "You just filed 1 document." : `You just filed ${n} documents.`,
    filterEmptyTitle: "Nothing left for this reason",
    filterEmptyBody: "The remaining documents are waiting under other reasons.",
    showAll: "Show all",
    fetchError: "Failed to load the review queue.",
    retry: "Retry",
    correspondent: "Correspondent",
    documentType: "Document type",
    issueDate: "Issue date",
    dueDate: "Due date",
    amount: "Amount",
    reference: "Reference number",
    confidence: "confidence",
    loadingPreview: "Loading preview",
    noPreview: "No preview",
    reasons: {
      low_confidence: {
        label: "Low confidence",
        why: "The extraction as a whole scored below the review threshold.",
      },
      processing_failed: {
        label: "Processing failed",
        why: "Processing stopped early. Reprocess the document or fix the fields by hand.",
      },
      ocr_empty: {
        label: "No text found",
        why: "Text recognition returned nothing readable.",
      },
      ocr_low_confidence: {
        label: "Low OCR confidence",
        why: "Text recognition was unsure, so values may be wrong.",
      },
      missing_key_fields: {
        label: "Missing key fields",
        why: "A field this document type needs was not found.",
      },
      unsupported_format: {
        label: "Unsupported format",
        why: "This file format can't be read automatically.",
      },
      classification_ambiguous: {
        label: "Classification ambiguous",
        why: "It could fit more than one document type.",
      },
      correspondent_unresolved: {
        label: "Correspondent unresolved",
        why: "The sender doesn't match a known correspondent.",
      },
      validation_failed: {
        label: "Validation failed",
        why: "Extracted values failed a plausibility check.",
      },
    } satisfies ReasonCopy,
  },
};

type ReviewCopy = (typeof COPY)["en"];

function reasonCopy(copy: ReviewCopy, reason: string) {
  return (
    copy.reasons[reason as ReviewReason] ?? {
      label: formatReviewReason(reason),
      why: null,
    }
  );
}

/** Below 50% the score itself is the warning. */
function confidenceVariant(pct: number): "danger" | "warning" | "success" {
  if (pct < 50) return "danger";
  return pct < 80 ? "warning" : "success";
}

/** The queue as rows; used by the side column and by the Sheet below 2xl. */
function QueueList({
  queue,
  selectedId,
  copy,
  onSelect,
}: {
  queue: Document[];
  selectedId: string | null;
  copy: ReviewCopy;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-0.5 p-1.5">
      {queue.map((item) => {
        const active = item.id === selectedId;
        const pct = Math.round((item.confidence ?? 0) * 100);
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
              active && "bg-brand-soft hover:bg-brand-soft",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
              <Badge variant={confidenceVariant(pct)} className="num shrink-0">
                {pct}%
              </Badge>
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {(item.reviewReasons ?? [])
                .map((reason) => reasonCopy(copy, reason).label)
                .join(", ")}
              {" · "}
              <span className="num">{formatShortDate(item.createdAt)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The scan itself. Paper stays white; the stage around it takes the theme. */
function DocumentStage({
  preview,
  title,
  copy,
}: {
  preview: Preview;
  title: string;
  copy: ReviewCopy;
}) {
  return (
    <Card className="h-[60svh] min-h-0 gap-0 bg-stage py-0 shadow-card lg:h-auto">
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-3 md:p-5">
        {preview.status === "ready" && preview.isImage ? (
          <img
            src={preview.url}
            alt={title}
            className="max-w-full rounded-md border border-paper-border bg-paper shadow-raised"
          />
        ) : preview.status === "ready" ? (
          <iframe
            src={preview.url}
            title={title}
            className="h-full w-full rounded-md border border-paper-border bg-paper shadow-raised"
          />
        ) : preview.status === "failed" ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileSearch />
              </EmptyMedia>
              <EmptyDescription>{copy.noPreview}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div
            role="status"
            aria-label={copy.loadingPreview}
            className="aspect-[1/1.414] w-full max-w-xl rounded-md border border-paper-border bg-paper p-8 shadow-raised"
          >
            <Skeleton className="h-5 w-1/2 bg-paper-border" />
            <Skeleton className="mt-6 h-3 w-full bg-paper-border" />
            <Skeleton className="mt-3 h-3 w-5/6 bg-paper-border" />
            <Skeleton className="mt-3 h-3 w-2/3 bg-paper-border" />
          </div>
        )}
      </div>
    </Card>
  );
}

function ReviewSkeleton() {
  return (
    <Page width="wide" className="min-h-full lg:h-full">
      <div className="flex items-center gap-3.5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <Skeleton className="h-14 w-full rounded-xl" />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Skeleton className="h-96 rounded-xl lg:h-auto" />
        <Skeleton className="h-96 rounded-xl lg:h-auto" />
      </div>
    </Page>
  );
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
  const requestSignal = useArchiveRequestScope();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<ReviewReason | "all">("all");
  const [form, setForm] = useState<FieldForm | null>(null);
  const [bulkThreshold, setBulkThreshold] = useState(80);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [queueOpen, setQueueOpen] = useState(false);
  // Confirmed documents leave the queue, so "3 of 12" has to remember them.
  const [filedCount, setFiledCount] = useState(0);
  const centreRef = useRef<HTMLDivElement>(null);

  const copy = language === "de" ? COPY.de : COPY.en;

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

  // Preview of the selected document.
  useEffect(() => {
    const objectUrl = createObjectUrlLease();
    const controller = new AbortController();
    setPreview({ status: "loading" });
    if (!selected) return;
    (async () => {
      const response = await authFetch(`/api/documents/${selected.id}/download`, {
        signal: asFetchSignal(controller.signal, requestSignal()),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setPreview({ status: "failed" });
        return;
      }
      const blob = await response.blob();
      const nextUrl = objectUrl.replace(blob);
      if (nextUrl) {
        setPreview({
          status: "ready",
          url: nextUrl,
          isImage: blob.type.startsWith("image/"),
        });
      }
    })().catch(() => {
      if (!controller.signal.aborted) setPreview({ status: "failed" });
    });
    return () => {
      controller.abort();
      objectUrl.dispose();
    };
  }, [selected?.id, requestSignal]);

  // --- Mutations (endpoints unchanged) ---

  const resolveMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await api.POST("/api/documents/{id}/review/resolve", {
        params: { path: { id: documentId } },
        body: {},
        signal: asFetchSignal(requestSignal()),
      });
      if (error) throw new Error(getApiErrorMessage(error, copy.fetchError));
    },
    onSuccess: (_data, documentId) =>
      refreshArchiveDocumentState(queryClient, documentId),
  });

  const requeueMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const { error } = await api.POST("/api/documents/{id}/review/requeue", {
        params: { path: { id: documentId } },
        body: { force: true },
        signal: asFetchSignal(requestSignal()),
      });
      if (error) throw new Error(getApiErrorMessage(error, copy.fetchError));
    },
    onSuccess: (_data, documentId) =>
      refreshArchiveDocumentState(queryClient, documentId),
  });

  const updateMutation = useMutation({
    mutationFn: async (input: {
      documentId: string;
      body: Record<string, unknown>;
    }) => {
      const { error } = await api.PATCH("/api/documents/{id}", {
        params: { path: { id: input.documentId } },
        body: input.body as never,
        signal: asFetchSignal(requestSignal()),
      });
      if (error) throw new Error(getApiErrorMessage(error, copy.fetchError));
    },
    onSuccess: (_data, input) =>
      refreshArchiveDocumentState(queryClient, input.documentId),
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
    setFiledCount((count) => count + 1);
    advance(selected.id);
  }, [selected, form, updateMutation, resolveMutation, advance]);

  const bulkConfirm = useCallback(async () => {
    const eligible = queue.filter((item) => isBulkEligible(item, bulkThreshold));
    if (eligible.length === 0) return;
    setBulkRunning(true);
    try {
      for (const item of eligible) {
        await resolveMutation.mutateAsync(item.id);
        setFiledCount((count) => count + 1);
      }
    } finally {
      setBulkRunning(false);
    }
  }, [queue, bulkThreshold, resolveMutation]);

  const actionError =
    updateMutation.error ?? resolveMutation.error ?? requeueMutation.error;

  // --- The keyboard loop the ticket is about ---

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      // Never fight an open dropdown, the queue Sheet or the omnibar.
      if (target?.closest("[role='listbox'], [role='dialog']")) return;
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
    return <ReviewSkeleton />;
  }

  if (reviewQuery.isError) {
    return (
      <Page width="narrow">
        <Alert variant="destructive" className="min-h-12 content-center">
          <AlertTriangle />
          <AlertTitle>{copy.fetchError}</AlertTitle>
          <AlertAction>
            <Button
              variant="outline"
              size="sm"
              className="text-foreground"
              onClick={() => reviewQuery.refetch()}
            >
              {copy.retry}
            </Button>
          </AlertAction>
        </Alert>
      </Page>
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

  const header = (
    <PageHeader
      icon={<ListChecks />}
      title={copy.title}
      description={
        items.length > 0 ? (
          <>
            <span className="num">{items.length}</span> {copy.docs(items.length)}
            {oldestDays > 0 ? <> · {copy.oldest(oldestDays)}</> : null}
          </>
        ) : (
          copy.subtitle
        )
      }
      actions={
        bulkEligible > 0 ? (
          <>
            <Select
              value={String(bulkThreshold)}
              onValueChange={(value) => setBulkThreshold(Number(value))}
            >
              <SelectTrigger aria-label={copy.bulkThreshold} className="num w-24">
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
              onClick={() => void bulkConfirm()}
              disabled={bulkRunning}
            >
              {bulkRunning ? <Spinner /> : <Check />}
              {copy.bulkConfirm(bulkEligible, bulkThreshold)}
            </Button>
          </>
        ) : null
      }
    />
  );

  // Nothing to review: this is the good outcome, so let it feel like one.
  if (items.length === 0) {
    return (
      <Page className="min-h-full">
        {header}
        <Empty className="flex-none rounded-2xl bg-gradient-wash px-6 py-16 md:py-24">
          <EmptyHeader className="max-w-md">
            <EmptyMedia>
              <IconTile size="lg" tone="solid">
                <CircleCheckBig />
              </IconTile>
            </EmptyMedia>
            <EmptyTitle className="text-gradient text-2xl font-semibold">
              {copy.emptyTitle}
            </EmptyTitle>
            <EmptyDescription>
              {filedCount > 0 ? <>{copy.filed(filedCount)} </> : null}
              {copy.emptyBody}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button variant="outline" asChild>
              <Link to="/">
                <Home />
                {t("root.nav.today")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/upload">
                <FileUp />
                {t("import.title")}
              </Link>
            </Button>
          </EmptyContent>
        </Empty>
      </Page>
    );
  }

  const selectedIndex = selected
    ? queue.findIndex((item) => item.id === selected.id)
    : -1;
  const total = queue.length + filedCount;
  const position = filedCount + selectedIndex + 1;
  const positionLabel = copy.position(position, total);

  function changeFilter(next: ReviewReason | "all") {
    setReasonFilter(next);
    // A different queue: progress through the old one means nothing here.
    setFiledCount(0);
  }

  return (
    <Page width="wide" className="min-h-full gap-5 lg:h-full">
      {header}

      {/* Where you are in the queue, and which part of it you are walking. */}
      <Card className="shrink-0 flex-row flex-wrap items-center gap-x-6 gap-y-3 p-3 shadow-card">
        {selected ? (
          <div className="flex min-w-0 flex-[1_1_20rem] items-center gap-3">
            <span className="num shrink-0 text-sm font-medium whitespace-nowrap">
              {positionLabel}
            </span>
            <Progress
              value={total > 0 ? (position / total) * 100 : 0}
              aria-label={positionLabel}
              className="h-1.5 min-w-16 flex-1"
            />
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={copy.previous}
                disabled={selectedIndex <= 0}
                onClick={() => setSelectedId(queue[selectedIndex - 1]?.id ?? null)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={copy.next}
                disabled={selectedIndex >= queue.length - 1}
                onClick={() => setSelectedId(queue[selectedIndex + 1]?.id ?? null)}
              >
                <ChevronRight />
              </Button>
            </div>
            <Sheet open={queueOpen} onOpenChange={setQueueOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0 2xl:hidden">
                  <ListOrdered />
                  {copy.queue}
                </Button>
              </SheetTrigger>
              <SheetContent className="w-[88%] gap-0 p-0 data-[side=right]:sm:max-w-sm">
                <SheetHeader className="border-b p-4">
                  <SheetTitle>{copy.queue}</SheetTitle>
                  <SheetDescription>{copy.queueHint}</SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-auto">
                  <QueueList
                    queue={queue}
                    selectedId={selected.id}
                    copy={copy}
                    onSelect={(id) => {
                      setSelectedId(id);
                      setQueueOpen(false);
                    }}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        ) : null}

        {/* Scrolls sideways on a phone, so many reasons can't push the document away. */}
        <div className="-m-1 flex max-w-full items-center gap-1.5 overflow-x-auto p-1 [scrollbar-width:none] md:flex-wrap">
          <Chip
            active={reasonFilter === "all"}
            className="shrink-0"
            onClick={() => changeFilter("all")}
          >
            {copy.all} · <span className="num">{items.length}</span>
          </Chip>
          {[...reasonCounts.entries()].map(([reason, count]) => (
            <Chip
              key={reason}
              active={reasonFilter === reason}
              className="shrink-0"
              onClick={() =>
                changeFilter(reasonFilter === reason ? "all" : (reason as ReviewReason))
              }
            >
              {reasonCopy(copy, reason).label} · <span className="num">{count}</span>
            </Chip>
          ))}
        </div>
      </Card>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_420px] 2xl:grid-cols-[300px_minmax(0,1fr)_440px]">
        {/* Queue: always here on very wide screens, a Sheet below that. */}
        <Card className="hidden min-h-0 gap-0 py-0 shadow-card 2xl:flex">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="font-medium">{copy.queue}</h2>
            <span className="num text-xs text-muted-foreground">{queue.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <QueueList
              queue={queue}
              selectedId={selected?.id ?? null}
              copy={copy}
              onSelect={setSelectedId}
            />
          </div>
        </Card>

        {selected && form ? (
          <>
            <DocumentStage preview={preview} title={selected.title} copy={copy} />

            {/* The fields to confirm */}
            <Card className="min-h-0 gap-0 py-0 shadow-card">
              <div className="flex shrink-0 items-start gap-2 border-b p-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold tracking-tight text-pretty">
                    {selected.correspondent?.name
                      ? `${selected.correspondent.name} — `
                      : ""}
                    {selected.title}
                  </h2>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {selected.documentType?.name ? (
                      <span>{selected.documentType.name}</span>
                    ) : null}
                    {selected.issueDate ? (
                      <span className="num">{formatShortDate(selected.issueDate)}</span>
                    ) : null}
                    {selected.confidence != null ? (
                      <Badge
                        variant={confidenceVariant(Math.round(selected.confidence * 100))}
                        className="num"
                      >
                        {copy.confidence} {Math.round(selected.confidence * 100)}%
                      </Badge>
                    ) : null}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("today.openDocument")}
                  title={t("today.openDocument")}
                  className="text-muted-foreground"
                  onClick={() =>
                    navigate({
                      to: "/documents/$documentId",
                      params: { documentId: selected.id },
                    })
                  }
                >
                  <ArrowUpRight />
                </Button>
              </div>

              <div ref={centreRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
                {(selected.reviewReasons ?? []).length > 0 ? (
                  <Alert
                    role="note"
                    aria-label={copy.why}
                    className="border-warning/30 bg-warning-soft px-3 py-2.5"
                  >
                    <AlertTriangle className="text-warning" />
                    <AlertDescription className="col-start-2 text-foreground/80">
                      <ul className="flex flex-col gap-1.5">
                        {(selected.reviewReasons ?? []).map((reason) => {
                          const entry = reasonCopy(copy, reason);
                          return (
                            <li key={reason} className="text-pretty">
                              <span
                                className={cn(
                                  "font-medium",
                                  CONFIDENCE_ONLY_REASONS.has(reason)
                                    ? "text-warning"
                                    : "text-danger",
                                )}
                              >
                                {entry.label}.
                              </span>{" "}
                              {entry.why}
                            </li>
                          );
                        })}
                      </ul>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <div>
                  <h3 className="mb-3 text-xs font-medium text-muted-foreground">
                    {copy.confirmFields}
                  </h3>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-3.5 min-[420px]:grid-cols-2">
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
                        state !== null ? "border-warning/50 bg-warning-soft" : undefined;
                      const fieldId = `review-${key}`;
                      const annotationId = `${fieldId}-note`;

                      return (
                        <Field key={key} className="min-w-0 gap-1.5">
                          <FieldLabel htmlFor={fieldId} className="gap-1 text-xs font-medium">
                            {label}
                            {state === null ? (
                              <Check aria-hidden="true" className="size-3 text-success" />
                            ) : null}
                          </FieldLabel>
                          {key === "correspondentId" || key === "documentTypeId" ? (
                            <Select
                              value={form[key]}
                              onValueChange={(value) =>
                                setForm((current) =>
                                  current ? { ...current, [key]: value } : current,
                                )
                              }
                            >
                              <SelectTrigger
                                id={fieldId}
                                aria-describedby={annotationId}
                                className={cn("w-full", amberInput)}
                              >
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
                              id={fieldId}
                              aria-describedby={annotationId}
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
                              className={cn("num", amberInput)}
                            />
                          )}
                          {/* A confirmed value only needs its tick; say why when it doesn't. */}
                          <span
                            id={annotationId}
                            className={cn(
                              state === null ? "sr-only" : "text-xs font-medium text-warning",
                            )}
                          >
                            {annotation}
                          </span>
                        </Field>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2 border-t p-4">
                {actionError ? (
                  <Alert variant="destructive">
                    <AlertTriangle />
                    <AlertDescription>
                      {actionError instanceof Error ? actionError.message : copy.fetchError}
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Button
                  size="lg"
                  className="w-full"
                  onClick={() => void confirmSelected().catch(() => {})}
                  disabled={resolveMutation.isPending || updateMutation.isPending}
                >
                  {resolveMutation.isPending || updateMutation.isPending ? <Spinner /> : <Check />}
                  {copy.confirmAndFile}
                  <Kbd
                    aria-hidden="true"
                    className="ml-1 hidden bg-white/20 text-primary-foreground md:inline-flex"
                  >
                    ↵
                  </Kbd>
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => advance(selected.id)}>
                    <SkipForward />
                    {copy.skip}
                    <Kbd aria-hidden="true" className="ml-1 hidden md:inline-flex">
                      s
                    </Kbd>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => requeueMutation.mutate(selected.id)}
                    disabled={requeueMutation.isPending}
                  >
                    <RotateCcw />
                    {copy.reprocess}
                  </Button>
                </div>
                <p className="mt-1 hidden items-center justify-center gap-1.5 text-xs text-muted-foreground md:flex">
                  <Kbd>j</Kbd>
                  <Kbd>k</Kbd>
                  {copy.hintNext}
                  <span aria-hidden="true" className="mx-1">
                    ·
                  </span>
                  <Kbd>e</Kbd>
                  {copy.hintEdit}
                </p>
              </div>
            </Card>
          </>
        ) : (
          <Card className="shadow-card lg:col-span-2">
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchX />
                </EmptyMedia>
                <EmptyTitle>{copy.filterEmptyTitle}</EmptyTitle>
                <EmptyDescription>{copy.filterEmptyBody}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => changeFilter("all")}>
                  {copy.showAll}
                </Button>
              </EmptyContent>
            </Empty>
          </Card>
        )}
      </div>
    </Page>
  );
}
