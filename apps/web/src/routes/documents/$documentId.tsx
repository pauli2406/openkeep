import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Correspondent as TaxonomyCorrespondent,
  DocumentHistoryResponse,
  DocumentType as TaxonomyDocumentType,
  HealthProvidersResponse,
  ManualOverrideField,
  ManualOverrides,
  ParseProvider,
  Tag as TaxonomyTag,
} from "@openkeep/types";
import { DetailHeader } from "@/components/document-detail/detail-header";
import {
  ConfidenceMeter,
  FieldsRail,
  parseProviderLabel,
} from "@/components/document-detail/fields-rail";
import { DocumentQaSection } from "@/components/document-detail/qa-section";
import { DocumentSummarySection } from "@/components/document-detail/summary-section";
import { IconTile } from "@/components/layout/page";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import {
  evictDeletedArchiveDocument,
  refreshArchiveDocumentState,
  refreshArchiveTaxonomyState,
} from "@/lib/archive-document-state";
import {
  asFetchSignal,
  useArchiveRequestScope,
} from "@/lib/archive-request-scope";
import { processingRefetchInterval } from "@/lib/document-processing";
import { useHostFileSaver, useOfflineReadOnly } from "@/lib/host-shell";
import { useI18n } from "@/lib/i18n";
import { createObjectUrlLease } from "@/lib/object-url";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Download,
  FileQuestion,
  FileSearch,
  FileText,
  History,
  Loader2,
  Mail,
  ScanText,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/documents/$documentId")({
  component: DocumentDetailPage,
});

// --- Types inferred from backend response shapes ---

interface Correspondent {
  id: string;
  name: string;
  slug: string;
}

interface DocumentType {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  requiredFields: string[];
}

interface TagItem {
  id: string;
  name: string;
  slug: string;
}

interface ReviewEvidence {
  documentClass: "invoice" | "generic";
  requiredFields: string[];
  missingFields: string[];
  extracted: {
    correspondent: boolean;
    issueDate: boolean;
    dueDate: boolean;
    amount: boolean;
    currency: boolean;
    referenceNumber: boolean;
    expiryDate: boolean;
    holderName: boolean;
    issuingAuthority: boolean;
  };
  activeReasons: string[];
  confidence?: number | null;
  confidenceThreshold?: number;
  ocrTextLength?: number;
  ocrEmptyThreshold?: number;
}

interface DocumentMetadata {
  detectedKeywords?: string[];
  reviewReasons?: string[];
  chunkCount?: number;
  pageCount?: number;
  reviewEvidence?: ReviewEvidence;
  manual?: ManualOverrides;
  summary?: string;
  intelligence?: {
    routing?: {
      documentType?: string | null;
      subtype?: string | null;
      confidence?: number | null;
      reasoningHints?: string[];
      agentVersion?: string;
      provider?: string;
      model?: string;
    };
    title?: {
      value?: string | null;
      confidence?: number | null;
      provider?: string;
      model?: string;
    };
    summary?: {
      value?: string | null;
      confidence?: number | null;
      provider?: string;
      model?: string;
    };
    extraction?: {
      documentType?: string | null;
      fields?: Record<string, unknown>;
      fieldConfidence?: Record<string, number>;
      fieldProvenance?: Record<
        string,
        {
          source?: string;
          provider?: string;
          page?: number | null;
          lineIndex?: number | null;
          snippet?: string | null;
        }
      >;
      provider?: string;
      model?: string;
    };
    tagging?: {
      tags?: string[];
      confidence?: number | null;
      provider?: string;
      model?: string;
    };
    correspondentResolution?: {
      resolvedName?: string | null;
      confidence?: number | null;
      strategy?: string;
      provider?: string;
      model?: string;
    };
    validation?: {
      normalizedFields?: Record<string, unknown>;
      warnings?: string[];
      errors?: string[];
      duplicateSignals?: Record<string, unknown>;
    };
    pipeline?: {
      framework?: string;
      runId?: string;
      status?: string;
      providerOrder?: string[];
      durationsMs?: Record<string, number>;
      agentVersions?: Record<string, string>;
    };
  };
  [key: string]: unknown;
}

interface ProcessingJobSummary {
  id: string;
  status: string;
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Document {
  id: string;
  title: string;
  source: string;
  mimeType: string;
  checksum: string;
  storageKey: string;
  status: "pending" | "processing" | "ready" | "failed";
  language: string | null;
  issueDate: string | null;
  dueDate: string | null;
  expiryDate: string | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  holderName: string | null;
  issuingAuthority: string | null;
  correspondent: Correspondent | null;
  documentType: DocumentType | null;
  tags: TagItem[];
  confidence: number | null;
  reviewStatus: "not_required" | "pending" | "resolved";
  reviewReasons: string[];
  reviewedAt: string | null;
  reviewNote: string | null;
  searchablePdfAvailable: boolean;
  parseProvider: string | null;
  chunkCount: number;
  embeddingStatus: string;
  embeddingProvider: string | null;
  embeddingModel: string | null;
  embeddingsStale: boolean;
  lastProcessingError: string | null;
  latestProcessingJob: ProcessingJobSummary | null;
  latestEmbeddingJob?: ProcessingJobSummary | null;
  metadata: DocumentMetadata;
  createdAt: string;
  processedAt: string | null;
}

interface TextBlock {
  documentId: string;
  page: number;
  lineIndex: number;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  text: string;
}

interface AuditEvent {
  id: string;
  actorUserId: string | null;
  actorDisplayName?: string | null;
  actorEmail?: string | null;
  documentId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

// --- Helpers ---

function formatReviewReason(reason: string): string {
  return reason
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatAgentFieldLabel(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatAgentFieldValue(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    return format(new Date(dateStr), "MMM d, yyyy HH:mm");
  } catch {
    return dateStr;
  }
}

function formatManualOverrideField(
  field: ManualOverrideField,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (field) {
    case "issueDate":
      return t("documentDetail.issueDate");
    case "dueDate":
      return t("documentDetail.dueDate");
    case "expiryDate":
      return t("documentDetail.expiryDate");
    case "amount":
      return t("documentDetail.amount");
    case "currency":
      return t("documentDetail.currency");
    case "referenceNumber":
      return t("documentDetail.referenceNumber");
    case "holderName":
      return t("documentDetail.holderName");
    case "issuingAuthority":
      return t("documentDetail.issuingAuthority");
    case "correspondentId":
      return t("documentDetail.correspondent");
    case "documentTypeId":
      return t("documentDetail.documentType");
    case "tagIds":
      return t("documentDetail.tags");
    default:
      return field;
  }
}

function formatHistoryEventType(eventType: string): string {
  return eventType
    .split(".")
    .flatMap((segment) => segment.split("_"))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type PreviewCategory = "pdf" | "image" | "text" | "video" | "audio" | "unsupported";

function getPreviewCategory(mimeType: string): PreviewCategory {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-yaml" ||
    mimeType === "application/x-sh"
  )
    return "text";
  return "unsupported";
}

function friendlyMimeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": "PDF Document",
    "image/jpeg": "JPEG Image",
    "image/png": "PNG Image",
    "image/gif": "GIF Image",
    "image/webp": "WebP Image",
    "image/svg+xml": "SVG Image",
    "image/tiff": "TIFF Image",
    "text/plain": "Plain Text",
    "text/csv": "CSV Spreadsheet",
    "text/html": "HTML Document",
    "application/json": "JSON File",
    "application/xml": "XML File",
    "application/zip": "ZIP Archive",
    "application/msword": "Word Document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "Word Document",
    "application/vnd.ms-excel": "Excel Spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      "Excel Spreadsheet",
    "video/mp4": "MP4 Video",
    "audio/mpeg": "MP3 Audio",
  };
  return map[mimeType] ?? mimeType;
}

function sameTagIds(left: string[], right: string[]): boolean {
  return [...left].sort().join(",") === [...right].sort().join(",");
}

const EMPTY_SELECT_VALUE = "__none__";

// --- Component ---

function DocumentDetailPage() {
  const { documentId } = Route.useParams();
  const location = useLocation();
  const citedPageMatch = /^page-(\d+)$/.exec(location.hash);
  const citedPage = citedPageMatch ? Number(citedPageMatch[1]) : undefined;
  const { t } = useI18n();
  const offlineReadOnly = useOfflineReadOnly();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const requestSignal = useArchiveRequestScope();
  const hostFileSaver = useHostFileSaver();
  const copy = {
    loadDoc: t("documentDetail.loadDoc"),
    loadText: t("documentDetail.loadText"),
    loadHistory: t("documentDetail.loadHistory"),
    notFound: t("documentDetail.notFound"),
    returnToDocuments: t("documentDetail.returnToDocuments"),
    downloadFailed: t("documentDetail.downloadFailed"),
  };

  const viewerRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [textPreviewContent, setTextPreviewContent] = useState<string | null>(null);
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [previewPage, setPreviewPage] = useState(citedPage ?? 1);
  const [selectedParseProvider, setSelectedParseProvider] = useState<ParseProvider | "">("");
  const [editForm, setEditForm] = useState({
    title: "",
    issueDate: "",
    dueDate: "",
    expiryDate: "",
    amount: "",
    currency: "",
    referenceNumber: "",
    holderName: "",
    issuingAuthority: "",
    correspondentId: EMPTY_SELECT_VALUE,
    documentTypeId: EMPTY_SELECT_VALUE,
    tagIds: [] as string[],
  });

  // --- Queries ---

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/documents/{id}", {
        params: { path: { id: documentId } },
        signal: asFetchSignal(signal),
      });
      if (error) throw new Error(copy.loadDoc);
      return data as unknown as Document;
    },
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data),
  });

  const textQuery = useQuery({
    queryKey: ["document-text", documentId],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/documents/{id}/text", {
        params: { path: { id: documentId } },
        signal: asFetchSignal(signal),
      });
      if (error) throw new Error(copy.loadText);
      return data as unknown as { documentId: string; blocks: TextBlock[] };
    },
    enabled: documentQuery.isSuccess,
    refetchInterval: () => processingRefetchInterval(documentQuery.data, (data) => data),
  });

  const historyQuery = useQuery({
    queryKey: ["document-history", documentId],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/documents/{id}/history", {
        params: { path: { id: documentId } },
        signal: asFetchSignal(signal),
      });
      if (error) throw new Error(copy.loadHistory);
      return data as unknown as DocumentHistoryResponse;
    },
    enabled: documentQuery.isSuccess,
    refetchInterval: () => processingRefetchInterval(documentQuery.data, (data) => data),
  });

  const tagsQuery = useQuery({
    queryKey: ["taxonomies", "tags"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/taxonomies/tags", {
        signal: asFetchSignal(signal),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToLoadTags")));
      }
      return (data ?? []) as TaxonomyTag[];
    },
  });

  const correspondentsQuery = useQuery({
    queryKey: ["taxonomies", "correspondents"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/taxonomies/correspondents", {
        signal: asFetchSignal(signal),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToLoadCorrespondents")));
      }
      return (data ?? []) as TaxonomyCorrespondent[];
    },
  });

  const documentTypesQuery = useQuery({
    queryKey: ["taxonomies", "document-types"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/taxonomies/document-types", {
        signal: asFetchSignal(signal),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToLoadDocumentTypes")));
      }
      return (data ?? []) as TaxonomyDocumentType[];
    },
  });

  const previewQuery = useQuery({
    queryKey: ["document-preview", documentId],
    queryFn: async ({ signal }) => {
      const response = await authFetch(`/api/documents/${documentId}/download`, {
        signal: asFetchSignal(signal),
      });
      if (!response.ok) {
        throw new Error(t("documentDetail.failedToLoadDocumentPreview"));
      }

      return response.blob();
    },
    enabled: documentQuery.isSuccess,
  });

  const providersQuery = useQuery({
    queryKey: ["health", "providers"],
    queryFn: async ({ signal }) => {
      const { data, error } = await api.GET("/api/health/providers", {
        signal: asFetchSignal(signal),
      });
      if (error) throw new Error(t("documentDetail.failedToFetchProviders"));
      return data as HealthProvidersResponse;
    },
    staleTime: 60_000,
  });

  const previewCategory = useMemo(
    () =>
      documentQuery.data
        ? getPreviewCategory(documentQuery.data.mimeType)
        : "unsupported",
    [documentQuery.data?.mimeType],
  );

  useEffect(() => {
    if (!previewQuery.data) {
      setPreviewUrl(null);
      setTextPreviewContent(null);
      return;
    }

    const objectUrl = createObjectUrlLease();
    let active = true;
    const nextUrl = objectUrl.replace(previewQuery.data);
    if (!nextUrl) return;
    setPreviewUrl(nextUrl);

    // For text files, also read the blob content as a string
    if (
      documentQuery.data &&
      getPreviewCategory(documentQuery.data.mimeType) === "text"
    ) {
      previewQuery.data
        .text()
        .then((text) => {
          if (active) setTextPreviewContent(text);
        })
        .catch(() => {
          if (active) setTextPreviewContent(null);
        });
    } else {
      setTextPreviewContent(null);
    }

    return () => {
      active = false;
      objectUrl.dispose();
    };
  }, [previewQuery.data, documentQuery.data?.mimeType]);

  useEffect(() => {
    if (citedPage) setPreviewPage(citedPage);
  }, [documentId, citedPage]);

  // --- Mutations ---

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, error } = await api.PATCH("/api/documents/{id}", {
        params: { path: { id: documentId } },
        body: body as any,
        signal: asFetchSignal(requestSignal()),
      });
      if (error) throw new Error(t("documentDetail.failedToUpdateDocument"));
      return data as unknown as Document;
    },
    onSuccess: () => refreshArchiveTaxonomyState(queryClient, documentId),
  });

  const createTagMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/api/taxonomies/tags", {
        body: { name },
        signal: asFetchSignal(requestSignal()),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToCreateTag")));
      }
      return data as unknown as TaxonomyTag;
    },
    onSuccess: async (tag) => {
      await queryClient.invalidateQueries({ queryKey: ["taxonomies", "tags"] });
      setEditForm((current) => ({
        ...current,
        tagIds: current.tagIds.includes(tag.id) ? current.tagIds : [...current.tagIds, tag.id],
      }));
    },
  });

  const createCorrespondentMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await api.POST("/api/taxonomies/correspondents", {
        body: { name },
        signal: asFetchSignal(requestSignal()),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToCreateCorrespondent")));
      }
      return data as unknown as TaxonomyCorrespondent;
    },
    onSuccess: async (correspondent) => {
      queryClient.setQueryData(
        ["taxonomies", "correspondents"],
        (current: TaxonomyCorrespondent[] | undefined) => {
          const next = [...(current ?? []).filter((item) => item.id !== correspondent.id), correspondent];
          return next.sort((left, right) => left.name.localeCompare(right.name));
        },
      );
      await queryClient.invalidateQueries({ queryKey: ["taxonomies", "correspondents"] });
      setEditForm((current) => ({
        ...current,
        correspondentId: correspondent.id,
      }));
    },
  });

  const resolveReviewMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/documents/{id}/review/resolve", {
        params: { path: { id: documentId } },
        body: {},
        signal: asFetchSignal(requestSignal()),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToResolveReview")));
      }
      return data;
    },
    onSuccess: () => refreshArchiveDocumentState(queryClient, documentId),
  });

  const requeueMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/documents/{id}/review/requeue", {
        params: { path: { id: documentId } },
        body: { force: true },
        signal: asFetchSignal(requestSignal()),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToRequeue")));
      }
      return data;
    },
    onSuccess: () => refreshArchiveDocumentState(queryClient, documentId),
  });

  const reprocessMutation = useMutation({
    mutationFn: async (parseProvider?: ParseProvider) => {
      const { data, error } = await api.POST("/api/documents/{id}/reprocess", {
        params: { path: { id: documentId } },
        body: parseProvider ? { parseProvider } : {},
        signal: asFetchSignal(requestSignal()),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToReprocessDocument")));
      }
      return data;
    },
    onSuccess: async () => {
      setReprocessDialogOpen(false);
      await refreshArchiveDocumentState(queryClient, documentId);
    },
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async (fields: ManualOverrideField[]) => {
      if (fields.length === 0) return null;
      const { data, error } = await api.PATCH("/api/documents/{id}", {
        params: { path: { id: documentId } },
        body: { clearLockedFields: fields },
        signal: asFetchSignal(requestSignal()),
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, t("documentDetail.failedToClearOverride")));
      }
      return data as unknown as Document;
    },
    onSuccess: () => refreshArchiveDocumentState(queryClient, documentId),
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`/api/documents/${documentId}`, {
        method: "DELETE",
        signal: asFetchSignal(requestSignal()),
      });
      if (!response.ok) {
        let message = t("documentDetail.failedToDeleteDocument");
        try {
          const body = (await response.json()) as { message?: unknown };
          message = getApiErrorMessage(body, message);
        } catch {
          // Keep the fallback message when the error body is absent or invalid.
        }
        throw new Error(message);
      }
    },
    onSuccess: async () => {
      setDeleteDialogOpen(false);
      await evictDeletedArchiveDocument(queryClient, documentId);
      navigate({ to: "/documents" });
    },
  });

  // --- Handlers ---

  /** The editable fields of the server copy, in the form's own shape. */
  const serverForm = useMemo(() => {
    const doc = documentQuery.data;
    if (!doc) return null;
    return {
      title: doc.title,
      issueDate: doc.issueDate ?? "",
      dueDate: doc.dueDate ?? "",
      expiryDate: doc.expiryDate ?? "",
      amount: doc.amount !== null ? String(doc.amount) : "",
      currency: doc.currency ?? "",
      referenceNumber: doc.referenceNumber ?? "",
      holderName: doc.holderName ?? "",
      issuingAuthority: doc.issuingAuthority ?? "",
      correspondentId: doc.correspondent?.id ?? EMPTY_SELECT_VALUE,
      documentTypeId: doc.documentType?.id ?? EMPTY_SELECT_VALUE,
      tagIds: doc.tags.map((tag) => tag.id),
    };
  }, [documentQuery.data]);

  // What the form was last seeded from. Kept so a poll can tell an edit the
  // user made apart from a value the server changed underneath them.
  const seededFrom = useRef<typeof serverForm>(null);

  const seedForm = useCallback(() => {
    if (!serverForm) return;
    seededFrom.current = serverForm;
    setEditForm(serverForm);
  }, [serverForm]);

  // The rail edits in place, and a pending or processing document is polled
  // every few seconds, so a plain re-seed would wipe unsaved edits mid-type.
  // Adopt server values only for fields the user has not touched.
  useEffect(() => {
    if (!serverForm) return;
    const previous = seededFrom.current;
    if (!previous) {
      seededFrom.current = serverForm;
      setEditForm(serverForm);
      setPreviewPage(citedPage ?? 1);
      return;
    }
    setEditForm((current) => {
      const next = { ...current };
      for (const key of Object.keys(serverForm) as Array<keyof typeof serverForm>) {
        if (key === "tagIds") {
          const serverChanged = !sameTagIds(previous.tagIds, serverForm.tagIds);
          const userEdited = !sameTagIds(previous.tagIds, current.tagIds);
          if (serverChanged && !userEdited) next.tagIds = serverForm.tagIds;
          continue;
        }
        const serverChanged = previous[key] !== serverForm[key];
        const userEdited = previous[key] !== current[key];
        if (serverChanged && !userEdited) {
          (next[key] as string) = serverForm[key] as string;
        }
      }
      return next;
    });
    seededFrom.current = serverForm;
  }, [serverForm, citedPage]);

  // A different document is a fresh start, dirty or not.
  useEffect(() => {
    seededFrom.current = null;
    setPreviewPage(citedPage ?? 1);
  }, [documentId, citedPage]);

  function saveEdits() {
    const body: Record<string, unknown> = {};
    const doc = documentQuery.data;
    if (!doc) return;

    if (editForm.title.trim() && editForm.title !== doc.title) {
      body.title = editForm.title;
    }

    if ((doc.issueDate ?? "") !== editForm.issueDate) {
      body.issueDate = editForm.issueDate || null;
    }
    if ((doc.dueDate ?? "") !== editForm.dueDate) {
      body.dueDate = editForm.dueDate || null;
    }
    if ((doc.expiryDate ?? "") !== editForm.expiryDate) {
      body.expiryDate = editForm.expiryDate || null;
    }

    const nextAmount = editForm.amount.trim() ? Number(editForm.amount) : null;
    if (doc.amount !== nextAmount) {
      body.amount = nextAmount;
    }

    const nextCurrency = editForm.currency.trim() || null;
    if ((doc.currency ?? null) !== nextCurrency) {
      body.currency = nextCurrency;
    }

    const nextReferenceNumber = editForm.referenceNumber.trim() || null;
    if ((doc.referenceNumber ?? null) !== nextReferenceNumber) {
      body.referenceNumber = nextReferenceNumber;
    }

    const nextHolderName = editForm.holderName.trim() || null;
    if ((doc.holderName ?? null) !== nextHolderName) {
      body.holderName = nextHolderName;
    }

    const nextIssuingAuthority = editForm.issuingAuthority.trim() || null;
    if ((doc.issuingAuthority ?? null) !== nextIssuingAuthority) {
      body.issuingAuthority = nextIssuingAuthority;
    }

    const nextCorrespondentId =
      editForm.correspondentId === EMPTY_SELECT_VALUE ? null : editForm.correspondentId;
    if ((doc.correspondent?.id ?? null) !== nextCorrespondentId) {
      body.correspondentId = nextCorrespondentId;
    }

    const nextDocumentTypeId =
      editForm.documentTypeId === EMPTY_SELECT_VALUE ? null : editForm.documentTypeId;
    if ((doc.documentType?.id ?? null) !== nextDocumentTypeId) {
      body.documentTypeId = nextDocumentTypeId;
    }

    if (!sameTagIds(doc.tags.map((tag) => tag.id), editForm.tagIds)) {
      body.tagIds = editForm.tagIds;
    }

    if (Object.keys(body).length === 0) return;

    updateMutation.mutate(body);
  }

  async function handleDownload(variant: "original" | "searchable") {
    setDownloadError(null);
    if (hostFileSaver) {
      try {
        const result = await hostFileSaver({
          kind:
            variant === "searchable"
              ? "document-searchable"
              : "document-original",
          documentId,
        });
        if (result.status === "failed") {
          setDownloadError(result.message);
        }
      } catch {
        setDownloadError(copy.downloadFailed);
      }
      return;
    }

    const url =
      variant === "searchable"
        ? `/api/documents/${documentId}/download/searchable`
        : `/api/documents/${documentId}/download`;

    try {
      const res = await authFetch(url);
      if (!res.ok) throw new Error("download-failed");

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      let filename = `document.${variant === "searchable" ? "pdf" : "bin"}`;
      if (disposition) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match) filename = match[1];
      }

      const a = window.document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      setDownloadError(copy.downloadFailed);
    }
  }

  function handleReprocess() {
    const available =
      providersQuery.data?.parseProviders.filter((entry) => entry.available) ?? [];
    if (available.length > 1) {
      setSelectedParseProvider(
        providersQuery.data?.activeParseProvider ?? available[0]?.id ?? "",
      );
      setReprocessDialogOpen(true);
    } else {
      reprocessMutation.mutate(undefined);
    }
  }

  // The menu item that opened a dialog is gone by the time it closes, so focus
  // would otherwise fall back to the page body.
  function returnFocusToMenu(event: Event) {
    event.preventDefault();
    menuTriggerRef.current?.focus();
  }

  /** Shows a cited page, scrolling up to the viewer when the panes are stacked. */
  function openPage(page: number) {
    setPreviewPage(page);
    viewerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // --- Loading / Error states ---

  if (documentQuery.isLoading) {
    return <DetailSkeleton />;
  }

  if (documentQuery.isError || !documentQuery.data) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon" className="bg-danger-soft text-danger">
              <AlertTriangle />
            </EmptyMedia>
            <EmptyTitle>
              {documentQuery.error instanceof Error ? documentQuery.error.message : copy.notFound}
            </EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => navigate({ to: "/documents" })}>
              {copy.returnToDocuments}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  const doc = documentQuery.data;
  const manualOverrides = doc.metadata.manual;
  const lockedFields = manualOverrides?.lockedFields ?? [];
  // The rail edits in place, so there is no edit mode to gate this on: the
  // pending locks follow the form/document diff directly.
  const pendingLockedFields: ManualOverrideField[] = [];
  if ((doc.issueDate ?? "") !== editForm.issueDate) {
    pendingLockedFields.push("issueDate");
  }
  if ((doc.dueDate ?? "") !== editForm.dueDate) {
    pendingLockedFields.push("dueDate");
  }
  if ((doc.expiryDate ?? "") !== editForm.expiryDate) {
    pendingLockedFields.push("expiryDate");
  }

  const nextAmount = editForm.amount.trim() ? Number(editForm.amount) : null;
  if (doc.amount !== nextAmount) {
    pendingLockedFields.push("amount");
  }

  const nextCurrency = editForm.currency.trim() || null;
  if ((doc.currency ?? null) !== nextCurrency) {
    pendingLockedFields.push("currency");
  }

  const nextReferenceNumber = editForm.referenceNumber.trim() || null;
  if ((doc.referenceNumber ?? null) !== nextReferenceNumber) {
    pendingLockedFields.push("referenceNumber");
  }

  const nextHolderName = editForm.holderName.trim() || null;
  if ((doc.holderName ?? null) !== nextHolderName) {
    pendingLockedFields.push("holderName");
  }

  const nextIssuingAuthority = editForm.issuingAuthority.trim() || null;
  if ((doc.issuingAuthority ?? null) !== nextIssuingAuthority) {
    pendingLockedFields.push("issuingAuthority");
  }

  const nextCorrespondentIdForLock =
    editForm.correspondentId === EMPTY_SELECT_VALUE ? null : editForm.correspondentId;
  if ((doc.correspondent?.id ?? null) !== nextCorrespondentIdForLock) {
    pendingLockedFields.push("correspondentId");
  }

  const nextDocumentTypeIdForLock =
    editForm.documentTypeId === EMPTY_SELECT_VALUE ? null : editForm.documentTypeId;
  if ((doc.documentType?.id ?? null) !== nextDocumentTypeIdForLock) {
    pendingLockedFields.push("documentTypeId");
  }

  if (!sameTagIds(doc.tags.map((tag) => tag.id), editForm.tagIds)) {
    pendingLockedFields.push("tagIds");
  }
  const pendingNewLocks = pendingLockedFields.filter((field) => !lockedFields.includes(field));
  const intelligence = doc.metadata.intelligence;

  // Per-field certainty, keyed the way the rail keys its rows.
  const fieldConfidence: Record<string, number | null | undefined> = {
    ...intelligence?.extraction?.fieldConfidence,
    title: intelligence?.title?.confidence,
    correspondentId: intelligence?.correspondentResolution?.confidence,
    documentTypeId: intelligence?.routing?.confidence,
    tagIds: intelligence?.tagging?.confidence,
  };

  // Group text blocks by page
  const textBlocksByPage: Record<number, TextBlock[]> = {};
  if (textQuery.data?.blocks) {
    for (const block of textQuery.data.blocks) {
      if (!textBlocksByPage[block.page]) {
        textBlocksByPage[block.page] = [];
      }
      textBlocksByPage[block.page].push(block);
    }
  }
  const pageNumbers = Object.keys(textBlocksByPage)
    .map(Number)
    .sort((a, b) => a - b);
  const pageCount = doc.metadata.pageCount ?? pageNumbers.length ?? 1;

  const lockNote =
    pendingNewLocks.length > 0
      ? `${t("documentDetail.savingWillLock")} ${pendingNewLocks
          .map((field) => formatManualOverrideField(field, t))
          .join(", ")}.`
      : lockedFields.length > 0
        ? t("documentDetail.lockedFieldsSticky")
        : null;

  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : null;
  // The actions live in the header, so their failures surface right below it,
  // whichever tab is open. A failed reprocess shows inside its dialog instead
  // when that is what started it.
  const headerActionError =
    errorText(resolveReviewMutation.error) ??
    errorText(requeueMutation.error) ??
    (reprocessDialogOpen ? null : errorText(reprocessMutation.error));
  const railActionError =
    errorText(createTagMutation.error) ??
    errorText(createCorrespondentMutation.error) ??
    errorText(clearOverrideMutation.error);

  const emailProvenance = (doc.metadata as Record<string, unknown> | undefined)?.email as
    | { from?: string; subject?: string | null; receivedAt?: string | null }
    | undefined;

  const inspectorTabs = [
    { value: "fields", label: t("documentDetail.fields") },
    { value: "intelligence", label: t("documentDetail.intelligence") },
    { value: "qa", label: t("documentDetail.qa") },
    { value: "text", label: t("documentDetail.ocrText") },
    { value: "history", label: t("documentDetail.history") },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DetailHeader
        doc={doc}
        onDownload={handleDownload}
        onResolveReview={() => resolveReviewMutation.mutate()}
        onRequeueReview={() => requeueMutation.mutate()}
        reviewPending={resolveReviewMutation.isPending || requeueMutation.isPending}
        onReprocess={handleReprocess}
        reprocessPending={reprocessMutation.isPending}
        onDelete={() => setDeleteDialogOpen(true)}
        deletePending={deleteDocumentMutation.isPending}
        processing={doc.status === "processing"}
        readOnly={offlineReadOnly}
        menuTriggerRef={menuTriggerRef}
      />
      {headerActionError ? (
        <div className="shrink-0 border-b bg-card px-3 py-2 md:px-4">
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{headerActionError}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      {/* The panes scroll on their own from lg up; below that they stack and
          the column scrolls as one. */}
      <div className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_clamp(350px,40%,480px)] lg:overflow-hidden">
        <div ref={viewerRef} className="h-[62svh] min-h-80 min-w-0 lg:h-full lg:min-h-0">
          <DocumentViewer
            doc={doc}
            category={previewCategory}
            previewUrl={previewUrl}
            previewLoading={previewQuery.isLoading}
            previewFailed={previewQuery.isError}
            onRetryPreview={() => void previewQuery.refetch()}
            textContent={textPreviewContent}
            zoom={previewZoom}
            onZoomChange={setPreviewZoom}
            page={previewPage}
            onPageChange={setPreviewPage}
            pageCount={pageCount}
            onDownload={handleDownload}
            downloadError={downloadError}
          />
        </div>

        <aside className="flex min-h-0 min-w-0 flex-col border-t bg-card lg:h-full lg:border-t-0 lg:border-l">
          <Tabs defaultValue="fields" className="min-h-0 flex-1 gap-0">
            <div className="sticky top-0 z-20 shrink-0 overflow-x-auto border-b bg-card px-2">
              <TabsList variant="line" className="h-11 w-full justify-start gap-0.5">
                {inspectorTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="flex-none px-2 after:bg-brand data-active:text-brand"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <TabsContent value="fields" className="min-h-0 lg:overflow-hidden">
              <FieldsRail
                doc={doc}
                form={editForm}
                onFormChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                correspondents={correspondentsQuery.data ?? []}
                documentTypes={documentTypesQuery.data ?? []}
                tags={tagsQuery.data ?? []}
                onCreateTag={(name) => createTagMutation.mutate(name)}
                createTagPending={createTagMutation.isPending}
                onCreateCorrespondent={(name) => createCorrespondentMutation.mutate(name)}
                createCorrespondentPending={createCorrespondentMutation.isPending}
                lockedFields={lockedFields}
                onUnlockFields={(fields) =>
                  clearOverrideMutation.mutate(fields as ManualOverrideField[])
                }
                onSave={saveEdits}
                onReset={seedForm}
                saving={updateMutation.isPending}
                saveError={updateMutation.isError ? t("documentDetail.failedToSaveChanges") : null}
                actionError={railActionError}
                lockNote={lockNote}
                fieldConfidence={fieldConfidence}
                readOnly={offlineReadOnly}
              >
                {emailProvenance ? (
                  <section className="mx-2 flex items-start gap-3 rounded-xl border p-3.5 text-sm">
                    <IconTile size="sm">
                      <Mail />
                    </IconTile>
                    <div className="min-w-0">
                      <p className="font-medium">{t("documentDetail.arrivedByEmail")}</p>
                      <p className="mt-0.5 text-xs wrap-anywhere text-muted-foreground">
                        {emailProvenance.from ?? "?"}
                        {emailProvenance.receivedAt
                          ? ` · ${format(new Date(emailProvenance.receivedAt), "MMM d, yyyy HH:mm")}`
                          : ""}
                        {emailProvenance.subject ? ` · ${emailProvenance.subject}` : ""}
                      </p>
                    </div>
                  </section>
                ) : null}
                <RawJson
                  label={t("documentDetail.rawMetadata")}
                  value={doc}
                  className="mx-2"
                  contentClassName="max-h-96"
                />
              </FieldsRail>
            </TabsContent>

            <TabsContent value="intelligence" className="min-h-0 lg:overflow-y-auto">
              <IntelligencePanel doc={doc} />
            </TabsContent>

            <TabsContent value="qa" className="h-[75svh] flex-none lg:h-auto lg:min-h-0 lg:flex-1">
              {offlineReadOnly ? (
                <div className="flex h-full items-center justify-center p-6">
                  <p className="text-center text-sm text-muted-foreground" role="status">
                    {t("offline.askDisabled")}
                  </p>
                </div>
              ) : (
                <DocumentQaSection
                  documentId={doc.id}
                  documentTitle={doc.title}
                  onOpenPage={openPage}
                />
              )}
            </TabsContent>

            <TabsContent value="text" className="min-h-0 bg-stage lg:overflow-y-auto">
              <OcrTextPanel
                loading={textQuery.isLoading}
                failed={textQuery.isError}
                onRetry={() => void textQuery.refetch()}
                pageNumbers={pageNumbers}
                blocksByPage={textBlocksByPage}
              />
            </TabsContent>

            <TabsContent value="history" className="min-h-0 lg:overflow-y-auto">
              <HistoryPanel
                loading={historyQuery.isLoading}
                failed={historyQuery.isError}
                failedLabel={copy.loadHistory}
                onRetry={() => void historyQuery.refetch()}
                items={historyQuery.data?.items}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {/* Reprocess provider picker dialog */}
      <Dialog open={reprocessDialogOpen} onOpenChange={setReprocessDialogOpen}>
        <DialogContent onCloseAutoFocus={returnFocusToMenu}>
          <DialogHeader>
            <DialogTitle>{t("documentDetail.reprocessDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("documentDetail.reprocessDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2.5">
            {reprocessMutation.isError ? (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>
                  {errorText(reprocessMutation.error) ??
                    t("documentDetail.failedToReprocessDocument")}
                </AlertDescription>
              </Alert>
            ) : null}
            <Label htmlFor="parse-provider-select">{t("documentDetail.ocrProvider")}</Label>
            <Select
              value={selectedParseProvider}
              onValueChange={(value) => setSelectedParseProvider(value as ParseProvider)}
            >
              <SelectTrigger id="parse-provider-select" className="w-full">
                <SelectValue placeholder={t("documentDetail.selectProvider")} />
              </SelectTrigger>
              <SelectContent>
                {(providersQuery.data?.parseProviders ?? [])
                  .filter((p) => p.available)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        {parseProviderLabel(p.id)}
                        {p.id === providersQuery.data?.activeParseProvider && (
                          <span className="text-xs text-muted-foreground">({t("documentDetail.active")})</span>
                        )}
                        {p.id === providersQuery.data?.fallbackParseProvider && (
                          <span className="text-xs text-muted-foreground">({t("documentDetail.fallback")})</span>
                        )}
                      </span>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {doc.parseProvider && (
              <p className="text-xs text-muted-foreground">
                {t("documentDetail.lastProcessedWith")}{" "}
                <span className="font-medium">{parseProviderLabel(doc.parseProvider)}</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReprocessDialogOpen(false)}
              disabled={reprocessMutation.isPending}
            >
              {t("documentDetail.cancel")}
            </Button>
            <Button
              onClick={() => reprocessMutation.mutate(selectedParseProvider || undefined)}
              disabled={reprocessMutation.isPending || !selectedParseProvider}
            >
              {reprocessMutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  {t("documentDetail.reprocessing")}
                </>
              ) : (
                t("documentDetail.reprocess")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent onCloseAutoFocus={returnFocusToMenu}>
          <DialogHeader>
            <DialogTitle>{t("documentDetail.deleteDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("documentDetail.deleteDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {doc.title}
          </div>
          {deleteDocumentMutation.isError ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>
                {errorText(deleteDocumentMutation.error) ??
                  t("documentDetail.failedToDeleteDocument")}
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleteDocumentMutation.isPending}
            >
              {t("documentDetail.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteDocumentMutation.mutate()}
              disabled={deleteDocumentMutation.isPending}
            >
              {deleteDocumentMutation.isPending ? (
                <>
                  <Loader2 className="animate-spin" />
                  {t("documentDetail.deleting")}
                </>
              ) : (
                t("documentDetail.deletePermanently")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function DetailSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <div className="flex shrink-0 items-center gap-3 border-b bg-card px-4 py-3.5">
        <Skeleton className="size-8 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="h-3 w-36 max-w-full" />
        </div>
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden lg:grid lg:grid-cols-[minmax(0,1fr)_clamp(350px,40%,480px)]">
        <div className="flex h-[62svh] bg-stage p-5 lg:h-full">
          <div className="mx-auto h-full w-full max-w-3xl rounded-md border border-paper-border bg-paper p-8 shadow-raised">
            <div className="flex flex-col gap-3">
              {[40, 92, 88, 94, 76].map((width) => (
                <Skeleton key={width} className="h-3 rounded-full" style={{ width: `${width}%` }} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-l bg-card p-4">
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <Skeleton key={row} className="h-7 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left pane: the document on its stage
// ---------------------------------------------------------------------------

function ToolbarIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function DocumentViewer({
  doc,
  category,
  previewUrl,
  previewLoading,
  previewFailed,
  onRetryPreview,
  textContent,
  zoom,
  onZoomChange,
  page,
  onPageChange,
  pageCount,
  onDownload,
  downloadError,
}: {
  doc: Document;
  category: PreviewCategory;
  previewUrl: string | null;
  previewLoading: boolean;
  previewFailed: boolean;
  onRetryPreview: () => void;
  textContent: string | null;
  zoom: number;
  onZoomChange: (update: (zoom: number) => number) => void;
  page: number;
  onPageChange: (update: (page: number) => number) => void;
  pageCount: number;
  onDownload: (variant: "original" | "searchable") => void;
  downloadError: string | null;
}) {
  const { t } = useI18n();
  const zoomable = category === "pdf" || category === "image";

  return (
    <section className="flex h-full min-h-0 flex-col bg-stage">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b bg-card px-2">
        {category === "pdf" && pageCount > 1 ? (
          <>
            <ToolbarIconButton
              label={t("documentDetail.previousPage")}
              onClick={() => onPageChange((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft />
            </ToolbarIconButton>
            <span className="num min-w-12 text-center text-xs text-muted-foreground">
              {page} / {pageCount}
            </span>
            <ToolbarIconButton
              label={t("documentDetail.nextPage")}
              onClick={() => onPageChange((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
            >
              <ChevronRight />
            </ToolbarIconButton>
            {zoomable ? <Separator orientation="vertical" className="mx-1 my-3" /> : null}
          </>
        ) : null}
        {zoomable ? (
          <>
            <ToolbarIconButton
              label={t("documentDetail.zoomOut")}
              onClick={() => onZoomChange((z) => Math.max(50, z - 25))}
              disabled={zoom <= 50}
            >
              <ZoomOut />
            </ToolbarIconButton>
            <span className="num min-w-10 text-center text-xs text-muted-foreground">{zoom}%</span>
            <ToolbarIconButton
              label={t("documentDetail.zoomIn")}
              onClick={() => onZoomChange((z) => Math.min(300, z + 25))}
              disabled={zoom >= 300}
            >
              <ZoomIn />
            </ToolbarIconButton>
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            aria-label={t("documentDetail.downloadOriginal")}
            onClick={() => onDownload("original")}
          >
            <Download />
            <span className="hidden sm:inline">{t("documentDetail.original")}</span>
          </Button>
          {doc.searchablePdfAvailable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              aria-label={t("documentDetail.downloadSearchable")}
              onClick={() => onDownload("searchable")}
            >
              <FileSearch />
              <span className="hidden xl:inline">{t("documentDetail.searchablePdf")}</span>
            </Button>
          ) : null}
        </div>
      </div>

      {downloadError ? (
        <div className="shrink-0 px-3 pt-3">
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertDescription>{downloadError}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-auto p-3 md:p-5">
        {previewFailed ? (
          <div className="m-auto w-full max-w-md">
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>{t("documentDetail.loadPreviewFailed")}</AlertDescription>
              <AlertAction>
                <Button type="button" variant="outline" size="xs" onClick={onRetryPreview}>
                  {t("documentDetail.retry")}
                </Button>
              </AlertAction>
            </Alert>
          </div>
        ) : previewLoading || !previewUrl ? (
          <div className="mx-auto h-full w-full max-w-3xl rounded-md border border-paper-border bg-paper p-8 shadow-raised">
            <div className="flex flex-col gap-3">
              {[40, 92, 88, 94, 76].map((width) => (
                <Skeleton
                  key={width}
                  className="h-3 rounded-full bg-paper-border"
                  style={{ width: `${width}%` }}
                />
              ))}
            </div>
          </div>
        ) : (
          <>
            {category === "pdf" && (
              <div className="mx-auto h-full w-full max-w-4xl overflow-hidden rounded-md border border-paper-border bg-paper shadow-raised">
                <iframe
                  key={`${page}-${zoom}`}
                  src={`${previewUrl}#page=${page}&zoom=${zoom}`}
                  className="h-full w-full"
                  title={t("documentDetail.documentPreviewTitle")}
                />
              </div>
            )}

            {category === "image" && (
              <img
                src={previewUrl}
                alt={doc.title}
                style={{ height: `${zoom}%`, maxWidth: zoom <= 100 ? "100%" : "none" }}
                className="m-auto rounded-md border border-paper-border bg-paper object-contain shadow-raised"
              />
            )}

            {category === "text" && (
              <div className="mx-auto h-full w-full max-w-4xl overflow-auto rounded-md border border-paper-border bg-paper p-6 shadow-raised">
                <pre className="font-mono text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-paper-foreground">
                  {textContent ?? t("documentDetail.loadingContent")}
                </pre>
              </div>
            )}

            {category === "video" && (
              <video
                src={previewUrl}
                controls
                className="m-auto max-h-full max-w-full rounded-md shadow-raised"
              >
                {t("documentDetail.browserNoVideo")}
              </video>
            )}

            {category === "audio" && (
              <div className="m-auto flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border bg-card p-8 shadow-card">
                <IconTile size="lg">
                  <FileText />
                </IconTile>
                <audio src={previewUrl} controls className="w-full">
                  {t("documentDetail.browserNoAudio")}
                </audio>
              </div>
            )}

            {category === "unsupported" && (
              <Empty className="m-auto">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FileQuestion />
                  </EmptyMedia>
                  <EmptyTitle>{t("documentDetail.previewUnavailable")}</EmptyTitle>
                  <EmptyDescription>
                    {t("documentDetail.unsupportedPreviewPrefix")} (
                    {friendlyMimeLabel(doc.mimeType)}){" "}
                    {t("documentDetail.unsupportedPreviewSuffix")}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" size="sm" onClick={() => onDownload("original")}>
                    <Download />
                    {t("documentDetail.downloadFile")}
                  </Button>
                </EmptyContent>
              </Empty>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Inspector panels
// ---------------------------------------------------------------------------

/** A collapsed block of JSON: real data, but rarely what you came for. */
function RawJson({
  label,
  value,
  className,
  contentClassName,
}: {
  label: string;
  value: unknown;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Collapsible className={className}>
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="group/raw -ml-1 text-muted-foreground"
        >
          <ChevronRight className="transition-transform group-data-[state=open]/raw:rotate-90" />
          {label}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre
          className={cn(
            "mt-1.5 overflow-auto rounded-lg border bg-muted/50 p-3 font-mono text-xs leading-relaxed",
            contentClassName,
          )}
        >
          {JSON.stringify(value, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function InspectorCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border p-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function MetaRows({ rows }: { rows: Array<[label: string, value: React.ReactNode]> }) {
  return (
    <dl className="flex flex-col gap-1.5 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 flex-1 wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function IntelligencePanel({ doc }: { doc: Document }) {
  const { t } = useI18n();
  const intelligence = doc.metadata.intelligence;

  if (!intelligence) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BrainCircuit />
          </EmptyMedia>
          <EmptyDescription>{t("documentDetail.noAgentIntelligence")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const fieldConfidence = intelligence.extraction?.fieldConfidence ?? {};
  const fieldProvenance = intelligence.extraction?.fieldProvenance ?? {};
  const visibleFields = Object.entries({
    ...intelligence.extraction?.fields,
    ...intelligence.validation?.normalizedFields,
  }).filter(([, value]) => {
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });
  const warnings = intelligence.validation?.warnings ?? [];
  const errors = intelligence.validation?.errors ?? [];
  const duplicateSignals = Object.entries(intelligence.validation?.duplicateSignals ?? {});
  const durations = Object.entries(intelligence.pipeline?.durationsMs ?? {});
  const taggedValues = intelligence.tagging?.tags ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-medium">{t("documentDetail.documentIntelligence")}</h2>

      <DocumentSummarySection
        documentId={doc.id}
        initialSummary={intelligence.summary?.value ?? doc.metadata.summary}
        initialProvider={intelligence.summary?.provider}
        initialModel={intelligence.summary?.model}
      />

      <InspectorCard
        title={t("documentDetail.routing")}
        aside={
          intelligence.routing?.confidence != null ? (
            <ConfidenceMeter value={intelligence.routing.confidence} showValue />
          ) : null
        }
      >
        <MetaRows
          rows={[
            [t("documentDetail.type"), intelligence.routing?.documentType ?? "-"],
            ...(intelligence.routing?.subtype
              ? ([[t("documentDetail.subtype"), intelligence.routing.subtype]] as Array<
                  [string, React.ReactNode]
                >)
              : []),
            ...(intelligence.routing?.provider
              ? ([
                  [
                    t("documentDetail.model"),
                    `${intelligence.routing.provider}${
                      intelligence.routing.model ? ` / ${intelligence.routing.model}` : ""
                    }`,
                  ],
                ] as Array<[string, React.ReactNode]>)
              : []),
          ]}
        />
        {intelligence.routing?.reasoningHints?.length ? (
          <div className="flex flex-wrap gap-1">
            {intelligence.routing.reasoningHints.map((hint) => (
              <Badge key={hint} variant="outline">
                {hint}
              </Badge>
            ))}
          </div>
        ) : null}
      </InspectorCard>

      <InspectorCard
        title={t("documentDetail.typeSpecificFields")}
        aside={
          intelligence.extraction?.provider ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {intelligence.extraction.provider}
              {intelligence.extraction.model ? ` / ${intelligence.extraction.model}` : ""}
            </span>
          ) : null
        }
      >
        {visibleFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("documentDetail.noExtractedFields")}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {visibleFields.map(([field, value]) => {
              const provenance = fieldProvenance[field];
              const confidence = fieldConfidence[field];
              return (
                <li key={field} className="flex flex-col gap-1 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">
                        {formatAgentFieldLabel(field)}
                      </p>
                      <p className="text-sm wrap-anywhere">{formatAgentFieldValue(value)}</p>
                    </div>
                    {confidence != null ? <ConfidenceMeter value={confidence} showValue /> : null}
                  </div>
                  {provenance ? (
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <p>
                        <span className="font-medium">{t("documentDetail.source")}</span>{" "}
                        {provenance.source ?? "-"}
                        {provenance.provider ? ` / ${provenance.provider}` : ""}
                      </p>
                      {provenance.page != null || provenance.lineIndex != null ? (
                        <p>
                          <span className="font-medium">{t("documentDetail.location")}</span>{" "}
                          {provenance.page != null
                            ? `${t("documentDetail.pageWord")} ${provenance.page}`
                            : ""}
                          {provenance.lineIndex != null
                            ? `, ${t("documentDetail.lineWord")} ${provenance.lineIndex}`
                            : ""}
                        </p>
                      ) : null}
                      {provenance.snippet ? (
                        <p className="w-fit max-w-full rounded-md bg-highlight px-1.5 py-0.5 wrap-anywhere whitespace-pre-wrap text-highlight-foreground">
                          {provenance.snippet}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </InspectorCard>

      <InspectorCard title={t("documentDetail.taggingCorrespondent")}>
        {taggedValues.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {taggedValues.map((tagValue) => (
              <Badge key={tagValue} variant="secondary">
                {tagValue}
              </Badge>
            ))}
          </div>
        ) : null}
        <MetaRows
          rows={[
            [
              t("documentDetail.correspondent"),
              intelligence.correspondentResolution?.resolvedName ?? "-",
            ],
            [t("documentDetail.strategy"), intelligence.correspondentResolution?.strategy ?? "-"],
          ]}
        />
      </InspectorCard>

      <InspectorCard title={t("documentDetail.validation")}>
        {warnings.length === 0 && errors.length === 0 && duplicateSignals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("documentDetail.noValidationIssues")}</p>
        ) : null}
        {warnings.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("documentDetail.warnings")}
            </p>
            <div className="flex flex-wrap gap-1">
              {warnings.map((warning) => (
                <Badge key={warning} variant="warning">
                  {formatReviewReason(warning)}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {errors.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">
              {t("documentDetail.errors")}
            </p>
            <div className="flex flex-wrap gap-1">
              {errors.map((error) => (
                <Badge key={error} variant="danger">
                  {formatReviewReason(error)}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
        {duplicateSignals.length > 0 ? (
          <pre className="overflow-auto rounded-lg border bg-muted/50 p-2.5 font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(intelligence.validation?.duplicateSignals ?? {}, null, 2)}
          </pre>
        ) : null}
      </InspectorCard>

      <InspectorCard title={t("documentDetail.pipeline")}>
        <MetaRows
          rows={[
            [t("documentDetail.framework"), intelligence.pipeline?.framework ?? "-"],
            [t("documentDetail.status"), intelligence.pipeline?.status ?? "-"],
            [
              t("documentDetail.runId"),
              intelligence.pipeline?.runId ? (
                <span className="font-mono">{intelligence.pipeline.runId}</span>
              ) : (
                "-"
              ),
            ],
            [
              t("documentDetail.providerOrder"),
              (intelligence.pipeline?.providerOrder ?? []).join(" → ") || "-",
            ],
          ]}
        />
        {durations.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {durations.map(([key, value]) => (
              <Badge key={key} variant="outline" className="num">
                {formatAgentFieldLabel(key)}: {formatDuration(value)}
              </Badge>
            ))}
          </div>
        ) : null}
      </InspectorCard>
    </div>
  );
}

function OcrTextPanel({
  loading,
  failed,
  onRetry,
  pageNumbers,
  blocksByPage,
}: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  pageNumbers: number[];
  blocksByPage: Record<number, TextBlock[]>;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[92, 88, 94, 60, 80].map((width) => (
          <Skeleton key={width} className="h-3 rounded-full" style={{ width: `${width}%` }} />
        ))}
      </div>
    );
  }
  if (failed) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{t("documentDetail.loadDocumentTextFailed")}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              {t("documentDetail.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }
  if (pageNumbers.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ScanText />
          </EmptyMedia>
          <EmptyDescription>{t("documentDetail.noOcr")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {pageNumbers.map((pageNumber) => (
        <section key={pageNumber} className="flex flex-col gap-1.5">
          <h3 className="num text-xs font-medium text-muted-foreground">
            {t("documentDetail.pageWord")} {pageNumber}
          </h3>
          <div className="rounded-md border border-paper-border bg-paper p-4 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap text-paper-foreground shadow-card">
            {blocksByPage[pageNumber].map((block) => block.text).join("\n")}
          </div>
        </section>
      ))}
    </div>
  );
}

function HistoryPanel({
  loading,
  failed,
  failedLabel,
  onRetry,
  items,
}: {
  loading: boolean;
  failed: boolean;
  failedLabel: string;
  onRetry: () => void;
  items: DocumentHistoryResponse["items"] | undefined;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  if (failed) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertDescription>{failedLabel}</AlertDescription>
          <AlertAction>
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              {t("documentDetail.retry")}
            </Button>
          </AlertAction>
        </Alert>
      </div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <History />
          </EmptyMedia>
          <EmptyDescription>{t("documentDetail.noAuditEvents")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-medium">{t("documentDetail.documentHistory")}</h2>
      <ol className="relative flex flex-col gap-4 before:absolute before:inset-y-1.5 before:left-[5px] before:w-px before:bg-border">
        {items.map((event) => (
          <li key={event.id} className="relative pl-5">
            <span
              aria-hidden="true"
              className="absolute top-1.5 left-0 size-[11px] rounded-full border-2 border-card bg-brand"
            />
            <p className="text-sm font-medium">{formatHistoryEventType(event.eventType)}</p>
            <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
              <span>
                {event.actorDisplayName || event.actorEmail || t("documentDetail.system")}
              </span>
              <span aria-hidden="true">·</span>
              <span className="num">{formatDateTime(event.createdAt)}</span>
            </p>
            {Object.keys(event.payload ?? {}).length > 0 ? (
              <RawJson label={t("documentDetail.details")} value={event.payload} className="mt-1" />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
