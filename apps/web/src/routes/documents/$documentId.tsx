import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link, useLocation, useNavigate } from "@tanstack/react-router";
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
import { DocumentProcessingIndicator } from "@/components/document-processing-indicator";
import { DocumentQaSection } from "@/components/document-detail/qa-section";
import { DocumentSummarySection } from "@/components/document-detail/summary-section";
import { DetailHeader } from "@/components/document-detail/detail-header";
import { FieldsRail } from "@/components/document-detail/fields-rail";
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
import { createObjectUrlLease } from "@/lib/object-url";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/lib/i18n";
import { useOfflineReadOnly } from "@/lib/host-shell";
import { useHostFileSaver } from "@/lib/host-shell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  BrainCircuit,
  Download,
  FileText,
  Eye,
  Edit2,
  Save,
  X,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Calendar,
  Building2,
  Tag,
  Hash,
  DollarSign,
  Clock,
  Image,
  FileQuestion,
  ScanText,
  Braces,
  History,
  Lock,
  Quote,
  Send,
  Trash2,
  Unlock,
  Plus,
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

function statusVariant(
  status: Document["status"],
): "default" | "secondary" | "destructive" | "success" | "warning" {
  switch (status) {
    case "ready":
      return "success";
    case "processing":
    case "pending":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

function reviewStatusVariant(
  status: Document["reviewStatus"],
): "default" | "secondary" | "destructive" | "success" | "warning" {
  switch (status) {
    case "pending":
      return "warning";
    case "resolved":
      return "success";
    default:
      return "secondary";
  }
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-[var(--ok-green)]";
  if (confidence >= 0.5) return "text-[var(--ok-amber)]";
  return "text-[var(--ok-red)]";
}

function confidenceBg(confidence: number): string {
  if (confidence >= 0.8) return "bg-[var(--ok-green-soft)]";
  if (confidence >= 0.5) return "bg-[var(--ok-amber-soft)]";
  return "bg-[var(--ok-red-soft)]";
}

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

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  try {
    return format(new Date(dateStr), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
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

// --- Provider config types & helpers ---

const PARSE_PROVIDER_LABELS: Record<string, string> = {
  "local-ocr": "Local OCR",
  "google-document-ai-enterprise-ocr": "Google Doc AI Enterprise",
  "google-document-ai-gemini-layout-parser": "Google Doc AI Gemini",
  "amazon-textract": "Amazon Textract",
  "azure-ai-document-intelligence": "Azure Document Intelligence",
  "mistral-ocr": "Mistral OCR",
};

const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  "google-gemini": "Google Gemini",
  voyage: "Voyage AI",
  mistral: "Mistral",
};

function parseProviderLabel(id: string | null | undefined): string {
  if (!id) return "—";
  return PARSE_PROVIDER_LABELS[id] ?? id;
}

function embeddingProviderLabel(id: string | null | undefined): string {
  if (!id) return "—";
  return EMBEDDING_PROVIDER_LABELS[id] ?? id;
}

function renderManualOverrideValue(
  doc: Document,
  field: ManualOverrideField,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (field) {
    case "issueDate":
      return formatDate(doc.issueDate);
    case "dueDate":
      return formatDate(doc.dueDate);
    case "expiryDate":
      return formatDate(doc.expiryDate);
    case "amount":
      return doc.amount !== null
        ? `${doc.amount.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} ${doc.currency ?? ""}`.trim()
        : "-";
    case "currency":
      return doc.currency ?? "-";
    case "referenceNumber":
      return doc.referenceNumber ?? "-";
    case "holderName":
      return doc.holderName ?? "-";
    case "issuingAuthority":
      return doc.issuingAuthority ?? "-";
    case "correspondentId":
      return doc.correspondent?.name ?? t("documentDetail.removed");
    case "documentTypeId":
      return doc.documentType?.name ?? t("documentDetail.removed");
    case "tagIds":
      return doc.tags.length > 0
        ? doc.tags.map((tag) => tag.name).join(", ")
        : t("documentDetail.noTags");
    default:
      return "-";
  }
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
    backToDocuments: t("documentDetail.backToDocuments"),
    notFound: t("documentDetail.notFound"),
    returnToDocuments: t("documentDetail.returnToDocuments"),
    documents: t("documentDetail.documents"),
    pendingReview: t("documentDetail.pendingReview"),
    reviewResolved: t("documentDetail.reviewResolved"),
    preview: t("documentDetail.preview"),
    ocrText: t("documentDetail.ocrText"),
    intelligence: t("documentDetail.intelligence"),
    details: t("documentDetail.details"),
    history: t("documentDetail.history"),
    previewUnavailable: t("documentDetail.previewUnavailable"),
    downloadFile: t("documentDetail.downloadFile"),
    downloadOriginal: t("documentDetail.downloadOriginal"),
    downloadSearchable: t("documentDetail.downloadSearchable"),
    downloadFailed: t("documentDetail.downloadFailed"),
    loadPreviewFailed: t("documentDetail.loadPreviewFailed"),
    loadDocumentTextFailed: t("documentDetail.loadDocumentTextFailed"),
    noOcr: t("documentDetail.noOcr"),
    page: (n: number) => `${t("documentDetail.pageWord")} ${n}`,
  };

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

  // --- Loading / Error states ---

  if (documentQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (documentQuery.isError || !documentQuery.data) {
    return (
      <div className="p-6">
        <Link to="/documents" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          {copy.backToDocuments}
        </Link>
        <div className="mt-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">
            {documentQuery.error instanceof Error ? documentQuery.error.message : copy.notFound}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate({ to: "/documents" })}>
            {copy.returnToDocuments}
          </Button>
        </div>
      </div>
    );
  }

  const doc = documentQuery.data;
  const manualOverrides = doc.metadata.manual;
  const lockedFields = manualOverrides?.lockedFields ?? [];
  // The rail edits in place — there is no edit mode to gate this on, so the
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
  const extractionFields = intelligence?.extraction?.fields ?? {};
  const normalizedFields = intelligence?.validation?.normalizedFields ?? {};
  const fieldConfidence = intelligence?.extraction?.fieldConfidence ?? {};
  const fieldProvenance = intelligence?.extraction?.fieldProvenance ?? {};
  const visibleIntelligenceFields = Object.entries({
    ...extractionFields,
    ...normalizedFields,
  }).filter(([, value]) => {
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  });

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
  const reviewActionError =
    errorText(resolveReviewMutation.error) ?? errorText(requeueMutation.error);
  const railActionError =
    errorText(createTagMutation.error) ??
    errorText(createCorrespondentMutation.error) ??
    errorText(clearOverrideMutation.error) ??
    errorText(reprocessMutation.error);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <DetailHeader
        doc={doc}
        onDownload={handleDownload}
        onResolveReview={() => resolveReviewMutation.mutate()}
        onRequeueReview={() => requeueMutation.mutate()}
        reviewPending={
          resolveReviewMutation.isPending || requeueMutation.isPending
        }
      />
      {reviewActionError ? (
        <div
          className="border-b border-[var(--ok-red)]/30 bg-[var(--ok-red-soft)] px-4 py-2 text-xs text-[var(--ok-red)]"
          role="alert"
        >
          {reviewActionError}
        </div>
      ) : null}
      <DocumentProcessingIndicator document={doc} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Left column: preview and the content tabs */}
        <div className="flex min-h-0 flex-col overflow-auto">
          <Tabs defaultValue="preview">
            <div className="flex flex-shrink-0 items-center gap-2 border-b bg-[var(--ok-bar)] px-3 py-1.5">
              <TabsList className="bg-transparent p-0">
                <TabsTrigger value="preview">{copy.preview}</TabsTrigger>
                <TabsTrigger value="text">{copy.ocrText}</TabsTrigger>
                <TabsTrigger value="intelligence">{copy.intelligence}</TabsTrigger>
                <TabsTrigger value="qa">{t("documentDetail.qa")}</TabsTrigger>
                <TabsTrigger value="details">{copy.details}</TabsTrigger>
                <TabsTrigger value="history">{copy.history}</TabsTrigger>
              </TabsList>
              <div className="ok-num ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <button
                  type="button"
                  aria-label={t("documentDetail.zoomOut")}
                  onClick={() => setPreviewZoom((z) => Math.max(50, z - 25))}
                  className="px-1 hover:text-foreground"
                >
                  −
                </button>
                <span>{previewZoom}%</span>
                <button
                  type="button"
                  aria-label={t("documentDetail.zoomIn")}
                  onClick={() => setPreviewZoom((z) => Math.min(300, z + 25))}
                  className="px-1 hover:text-foreground"
                >
                  +
                </button>
                {pageCount > 1 ? (
                  <>
                    <button
                      type="button"
                      aria-label={t("documentDetail.page")}
                      onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                      className="px-1 hover:text-foreground"
                    >
                      ‹
                    </button>
                    <span>
                      {previewPage} / {pageCount}
                    </span>
                    <button
                      type="button"
                      aria-label={t("documentDetail.page")}
                      onClick={() => setPreviewPage((p) => Math.min(pageCount, p + 1))}
                      className="px-1 hover:text-foreground"
                    >
                      ›
                    </button>
                  </>
                ) : null}
              </div>
            </div>

            <TabsContent value="preview">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div
                    className="w-full overflow-hidden rounded-[var(--r-md)] border border-[var(--ok-paper-border)] bg-[var(--ok-sunken)]"
                    style={{ height: "calc(100vh - 230px)" }}
                  >
                    {previewQuery.isLoading && (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {previewQuery.isError && (
                      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
                        {copy.loadPreviewFailed}
                      </div>
                    )}
                    {previewUrl &&
                      !previewQuery.isLoading &&
                      !previewQuery.isError && (
                        <>
                          {/* PDF: iframe */}
                          {previewCategory === "pdf" && (
                            <iframe
                              key={`${previewPage}-${previewZoom}`}
                              src={`${previewUrl}#page=${previewPage}&zoom=${previewZoom}`}
                              className="h-full w-full bg-[var(--ok-paper)]"
                              title={t("documentDetail.documentPreviewTitle")}
                            />
                          )}

                          {/* Image: native img */}
                          {previewCategory === "image" && (
                            <div className="flex h-full items-center justify-center bg-[var(--ok-paper)] p-4">
                              <img
                                src={previewUrl}
                                alt={doc.title}
                                style={{ transform: `scale(${previewZoom / 100})` }}
                                className="max-h-full max-w-full rounded object-contain shadow-lg transition-transform"
                              />
                            </div>
                          )}

                          {/* Text: inline preformatted */}
                          {previewCategory === "text" && (
                            <div className="h-full overflow-auto bg-[var(--ok-paper)] p-4">
                              <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-[var(--ok-paper-ink)]">
                                {textPreviewContent ?? t("documentDetail.loadingContent")}
                              </pre>
                            </div>
                          )}

                          {/* Video: native video player */}
                          {previewCategory === "video" && (
                            <div className="flex h-full items-center justify-center bg-black p-4">
                              <video
                                src={previewUrl}
                                controls
                                className="max-h-full max-w-full rounded"
                              >
                                {t("documentDetail.browserNoVideo")}
                              </video>
                            </div>
                          )}

                          {/* Audio: native audio player */}
                          {previewCategory === "audio" && (
                            <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
                              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
                                <FileText className="h-10 w-10 text-primary" />
                              </div>
                              <audio
                                src={previewUrl}
                                controls
                                className="w-full max-w-md"
                              >
                                {t("documentDetail.browserNoAudio")}
                              </audio>
                            </div>
                          )}

                          {/* Unsupported: friendly fallback */}
                          {previewCategory === "unsupported" && (
                            <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted-foreground/10">
                                <FileQuestion className="h-8 w-8 text-muted-foreground" />
                              </div>
                              <div className="space-y-1.5">
                                <p className="text-sm font-medium text-foreground">
                                 {copy.previewUnavailable}
                                </p>
                                <p className="text-xs text-muted-foreground max-w-xs">
                                  {t("documentDetail.unsupportedPreviewPrefix")} (
                                  {friendlyMimeLabel(doc.mimeType)}) {t("documentDetail.unsupportedPreviewSuffix")}
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 mt-2"
                                onClick={() => handleDownload("original")}
                              >
                                <Download className="h-3.5 w-3.5" />
                                 {copy.downloadFile}
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => handleDownload("original")}
                    >
                      <Download className="h-3.5 w-3.5" />
                       {copy.downloadOriginal}
                    </Button>
                    {doc.searchablePdfAvailable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => handleDownload("searchable")}
                      >
                        <Download className="h-3.5 w-3.5" />
                         {copy.downloadSearchable}
                      </Button>
                    )}
                  </div>
                  {downloadError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {downloadError}
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>

            {/* OCR Text Tab */}
            <TabsContent value="text">
              <Card>
                <CardContent className="p-4">
                  {textQuery.isLoading && (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {textQuery.isError && (
                     <p className="text-sm text-destructive">{copy.loadDocumentTextFailed}</p>
                  )}
                  {textQuery.isSuccess && pageNumbers.length === 0 && (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                       {copy.noOcr}
                    </p>
                  )}
                  {textQuery.isSuccess && pageNumbers.length > 0 && (
                    <div className="space-y-6">
                      {pageNumbers.map((pageNum) => (
                        <div key={pageNum}>
                          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                             {copy.page(pageNum)}
                          </h3>
                          <div className="rounded-md border bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap font-mono">
                            {textBlocksByPage[pageNum]
                              .map((b) => b.text)
                              .join("\n")}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="intelligence">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("documentDetail.documentIntelligence")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!intelligence ? (
                    <p className="text-sm text-muted-foreground">
                      {t("documentDetail.noAgentIntelligence")}
                    </p>
                  ) : (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-md border p-3 space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium">{t("documentDetail.routing")}</p>
                            {intelligence.routing?.confidence != null && (
                              <span className={`text-xs font-medium ${confidenceColor(intelligence.routing.confidence)}`}>
                                <span className="ok-num">{(intelligence.routing.confidence * 100).toFixed(0)}%</span>
                              </span>
                            )}
                          </div>
                          <div className="text-sm space-y-1">
                            <p>
                              <span className="text-muted-foreground">{t("documentDetail.type")}</span>{" "}
                              {intelligence.routing?.documentType ?? "-"}
                            </p>
                            {intelligence.routing?.subtype && (
                              <p>
                                <span className="text-muted-foreground">{t("documentDetail.subtype")}</span>{" "}
                                {intelligence.routing.subtype}
                              </p>
                            )}
                            {intelligence.routing?.provider && (
                              <p>
                                <span className="text-muted-foreground">{t("documentDetail.model")}</span>{" "}
                                {intelligence.routing.provider}
                                {intelligence.routing.model ? ` / ${intelligence.routing.model}` : ""}
                              </p>
                            )}
                          </div>
                          {intelligence.routing?.reasoningHints?.length ? (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {intelligence.routing.reasoningHints.map((hint) => (
                                <Badge key={hint} variant="outline" className="text-xs">
                                  {hint}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>

                        <DocumentSummarySection
                          documentId={doc.id}
                          initialSummary={intelligence.summary?.value ?? doc.metadata.summary}
                          initialProvider={intelligence.summary?.provider}
                          initialModel={intelligence.summary?.model}
                        />
                      </div>

                      <div className="rounded-md border p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{t("documentDetail.typeSpecificFields")}</p>
                          {intelligence.extraction?.provider && (
                            <span className="text-xs text-muted-foreground">
                              {intelligence.extraction.provider}
                              {intelligence.extraction.model ? ` / ${intelligence.extraction.model}` : ""}
                            </span>
                          )}
                        </div>
                        {visibleIntelligenceFields.length === 0 ? (
                          <p className="text-sm text-muted-foreground">{t("documentDetail.noExtractedFields")}</p>
                        ) : (
                          <div className="space-y-2">
                            {visibleIntelligenceFields.map(([field, value]) => {
                              const provenance = fieldProvenance[field];
                              const confidence = fieldConfidence[field];
                              return (
                                <div key={field} className="rounded-md border bg-muted/30 p-3 space-y-2">
                                  <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div>
                                      <p className="text-sm font-medium">{formatAgentFieldLabel(field)}</p>
                                      <p className="text-sm text-muted-foreground">
                                        {formatAgentFieldValue(value)}
                                      </p>
                                    </div>
                                    {confidence != null && (
                                      <Badge variant="outline" className="text-xs">
                                        <span className="ok-num">{(confidence * 100).toFixed(0)}%</span>
                                      </Badge>
                                    )}
                                  </div>
                                  {provenance && (
                                    <div className="rounded-md border bg-background px-3 py-2 text-xs space-y-1">
                                      <p>
                                        <span className="text-muted-foreground">{t("documentDetail.source")}</span>{" "}
                                        {provenance.source ?? "-"}
                                        {provenance.provider ? ` / ${provenance.provider}` : ""}
                                      </p>
                                      {(provenance.page != null || provenance.lineIndex != null) && (
                                        <p>
                                          <span className="text-muted-foreground">{t("documentDetail.location")}</span>{" "}
                                          {provenance.page != null ? `${t("documentDetail.pageWord")} ${provenance.page}` : ""}
                                          {provenance.lineIndex != null ? `, ${t("documentDetail.lineWord")} ${provenance.lineIndex}` : ""}
                                        </p>
                                      )}
                                      {provenance.snippet && (
                                        <p className="font-mono text-[11px] text-muted-foreground whitespace-pre-wrap">
                                          {provenance.snippet}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-md border p-3 space-y-2">
                          <p className="text-sm font-medium">{t("documentDetail.taggingCorrespondent")}</p>
                          <div className="flex flex-wrap gap-1">
                            {(intelligence.tagging?.tags ?? []).map((tagValue) => (
                              <Badge key={tagValue} variant="secondary" className="text-xs">
                                {tagValue}
                              </Badge>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground space-y-1">
                            <p>
                              {t("documentDetail.correspondent")}: {intelligence.correspondentResolution?.resolvedName ?? "-"}
                            </p>
                            <p>
                              {t("documentDetail.strategy")}: {intelligence.correspondentResolution?.strategy ?? "-"}
                            </p>
                          </div>
                        </div>

                        <div className="rounded-md border p-3 space-y-2">
                          <p className="text-sm font-medium">{t("documentDetail.validation")}</p>
                          {(intelligence.validation?.warnings?.length ?? 0) > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">{t("documentDetail.warnings")}</p>
                              <div className="flex flex-wrap gap-1">
                                {intelligence.validation?.warnings?.map((warning) => (
                                  <Badge key={warning} variant="warning" className="text-xs">
                                    {formatReviewReason(warning)}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {(intelligence.validation?.errors?.length ?? 0) > 0 && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-1">{t("documentDetail.errors")}</p>
                              <div className="flex flex-wrap gap-1">
                                {intelligence.validation?.errors?.map((error) => (
                                  <Badge key={error} variant="destructive" className="text-xs">
                                    {formatReviewReason(error)}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {Object.entries(intelligence.validation?.duplicateSignals ?? {}).length > 0 && (
                            <div className="rounded-md border bg-muted/30 p-2 text-xs font-mono whitespace-pre-wrap">
                              {JSON.stringify(intelligence.validation?.duplicateSignals ?? {}, null, 2)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-md border p-3 space-y-2">
                          <p className="text-sm font-medium">{t("documentDetail.pipeline")}</p>
                        <div className="grid gap-2 md:grid-cols-2 text-xs text-muted-foreground">
                          <p>{t("documentDetail.framework")}: {intelligence.pipeline?.framework ?? "-"}</p>
                          <p>{t("documentDetail.status")}: {intelligence.pipeline?.status ?? "-"}</p>
                          <p>{t("documentDetail.runId")}: {intelligence.pipeline?.runId ?? "-"}</p>
                          <p>
                            {t("documentDetail.providerOrder")}: {(intelligence.pipeline?.providerOrder ?? []).join(" -> ") || "-"}
                          </p>
                        </div>
                        {Object.entries(intelligence.pipeline?.durationsMs ?? {}).length > 0 && (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {Object.entries(intelligence.pipeline?.durationsMs ?? {}).map(([key, value]) => (
                              <Badge key={key} variant="outline" className="text-xs">
                                {formatAgentFieldLabel(key)}: {formatDuration(value)}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Details / Raw Metadata Tab */}
            <TabsContent value="details">
              {(() => {
                const emailProvenance = (doc.metadata as Record<string, unknown> | undefined)
                  ?.email as
                  | { from?: string; subject?: string | null; receivedAt?: string | null }
                  | undefined;
                if (!emailProvenance) return null;
                return (
                  <Card className="mb-4">
                    <CardContent className="p-4 text-sm">
                      <p className="font-medium">{t("documentDetail.arrivedByEmail")}</p>
                      <p className="mt-1 text-muted-foreground">
                        {emailProvenance.from ?? "?"}
                        {emailProvenance.receivedAt
                          ? ` · ${format(new Date(emailProvenance.receivedAt), "MMM d, yyyy HH:mm")}`
                          : ""}
                        {emailProvenance.subject ? ` · ${emailProvenance.subject}` : ""}
                      </p>
                    </CardContent>
                  </Card>
                );
              })()}
              <Card>
                <CardContent className="p-4">
                  <pre className="overflow-auto rounded-md border bg-muted/50 p-4 text-xs font-mono leading-relaxed max-h-[60vh]">
                    {JSON.stringify(doc, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("documentDetail.documentHistory")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {historyQuery.isLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {historyQuery.isError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      {copy.loadHistory}
                    </div>
                  )}
                  {historyQuery.isSuccess && historyQuery.data.items.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {t("documentDetail.noAuditEvents")}
                    </p>
                  )}
                  {historyQuery.data?.items.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">
                            {formatHistoryEventType(event.eventType)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {event.actorDisplayName ||
                              event.actorEmail ||
                              t("documentDetail.system")}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          <span className="ok-num">{formatDateTime(event.createdAt)}</span>
                        </p>
                      </div>
                      {Object.keys(event.payload ?? {}).length > 0 && (
                        <pre className="mt-3 overflow-auto rounded-md border bg-muted/50 p-3 text-xs font-mono leading-relaxed">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>


            <TabsContent value="qa">
              {offlineReadOnly ? (
                <p className="p-4 text-sm text-muted-foreground" role="status">
                  {t("offline.askDisabled")}
                </p>
              ) : (
                <DocumentQaSection documentId={doc.id} />
              )}
            </TabsContent>
          </Tabs>
        </div>

        {/* Right rail: fields, review, processing. One fieldset gates every
            mutating control in it while the archive is an offline copy. */}
        <fieldset disabled={offlineReadOnly} className="contents">
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
          onUnlockFields={(fields) => clearOverrideMutation.mutate(fields as ManualOverrideField[])}
          onSave={saveEdits}
          onReset={seedForm}
          saving={updateMutation.isPending}
          saveError={updateMutation.isError ? t("documentDetail.failedToSaveChanges") : null}
          actionError={railActionError}
          lockNote={lockNote}
          onReprocess={() => {
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
          }}
          reprocessPending={reprocessMutation.isPending}
          onDelete={() => setDeleteDialogOpen(true)}
          deletePending={deleteDocumentMutation.isPending}
          processing={doc.status === "processing"}
        />
        </fieldset>
      </div>

          {/* Reprocess provider picker dialog */}
          <Dialog open={reprocessDialogOpen} onOpenChange={setReprocessDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("documentDetail.reprocessDialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("documentDetail.reprocessDialogDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                {reprocessMutation.isError ? (
                  <p className="text-sm text-[var(--ok-red)]" role="alert">
                    {errorText(reprocessMutation.error) ??
                      t("documentDetail.failedToReprocessDocument")}
                  </p>
                ) : null}
                <Label htmlFor="parse-provider-select">{t("documentDetail.ocrProvider")}</Label>
                <Select
                  value={selectedParseProvider}
                  onValueChange={(value) => setSelectedParseProvider(value as ParseProvider)}
                >
                  <SelectTrigger id="parse-provider-select">
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
                    {t("documentDetail.lastProcessedWith")} <span className="font-medium">{parseProviderLabel(doc.parseProvider)}</span>
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
                      <Loader2 className="h-4 w-4 animate-spin" />
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
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("documentDetail.deleteDialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("documentDetail.deleteDialogDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
                <span className="font-medium">{doc.title}</span>
              </div>
              {deleteDocumentMutation.isError ? (
                <p className="text-sm text-[var(--ok-red)]" role="alert">
                  {errorText(deleteDocumentMutation.error) ??
                    t("documentDetail.failedToDeleteDocument")}
                </p>
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
                      <Loader2 className="h-4 w-4 animate-spin" />
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
// AI Section component — Q&A with SSE streaming
// ---------------------------------------------------------------------------
