import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  DocumentHistoryResponse,
  HealthProvidersResponse,
  ManualOverrideField,
  ManualOverrides,
  ParseProvider,
} from "@openkeep/types";
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  Unlock,
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
    amount: boolean;
    currency: boolean;
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
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
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
  boundingBox: { x: number; y: number; width: number; height: number };
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
  if (confidence >= 0.8) return "text-emerald-600";
  if (confidence >= 0.5) return "text-amber-600";
  return "text-red-600";
}

function confidenceBg(confidence: number): string {
  if (confidence >= 0.8) return "bg-emerald-100";
  if (confidence >= 0.5) return "bg-amber-100";
  return "bg-red-100";
}

function formatReviewReason(reason: string): string {
  return reason
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

function formatManualOverrideField(field: ManualOverrideField): string {
  switch (field) {
    case "issueDate":
      return "Issue Date";
    case "dueDate":
      return "Due Date";
    case "amount":
      return "Amount";
    case "currency":
      return "Currency";
    case "referenceNumber":
      return "Reference Number";
    case "correspondentId":
      return "Correspondent";
    case "documentTypeId":
      return "Document Type";
    case "tagIds":
      return "Tags";
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
): string {
  switch (field) {
    case "issueDate":
      return formatDate(doc.issueDate);
    case "dueDate":
      return formatDate(doc.dueDate);
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
    case "correspondentId":
      return doc.correspondent?.name ?? "Removed";
    case "documentTypeId":
      return doc.documentType?.name ?? "Removed";
    case "tagIds":
      return doc.tags.length > 0
        ? doc.tags.map((tag) => tag.name).join(", ")
        : "No tags";
    default:
      return "-";
  }
}

// --- Component ---

function DocumentDetailPage() {
  const { documentId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textPreviewContent, setTextPreviewContent] = useState<string | null>(null);
  const [reprocessDialogOpen, setReprocessDialogOpen] = useState(false);
  const [selectedParseProvider, setSelectedParseProvider] = useState<ParseProvider | "">("");
  const [editForm, setEditForm] = useState({
    title: "",
    issueDate: "",
    dueDate: "",
    amount: "",
    currency: "",
    referenceNumber: "",
  });

  // --- Queries ---

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}", {
        params: { path: { id: documentId } },
      });
      if (error) throw new Error("Failed to load document");
      return data as unknown as Document;
    },
  });

  const textQuery = useQuery({
    queryKey: ["document-text", documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}/text", {
        params: { path: { id: documentId } },
      });
      if (error) throw new Error("Failed to load document text");
      return data as unknown as { documentId: string; blocks: TextBlock[] };
    },
    enabled: documentQuery.isSuccess,
  });

  const historyQuery = useQuery({
    queryKey: ["document-history", documentId],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/documents/{id}/history" as never, {
        params: { path: { id: documentId } },
      } as never);
      if (error) throw new Error("Failed to load document history");
      return data as unknown as DocumentHistoryResponse;
    },
    enabled: documentQuery.isSuccess,
  });

  const previewQuery = useQuery({
    queryKey: ["document-preview", documentId],
    queryFn: async () => {
      const response = await authFetch(`/api/documents/${documentId}/download`);
      if (!response.ok) {
        throw new Error("Failed to load document preview");
      }

      return response.blob();
    },
    enabled: documentQuery.isSuccess,
  });

  const providersQuery = useQuery({
    queryKey: ["health", "providers"],
    queryFn: async () => {
      const { data, error } = await api.GET("/api/health/providers");
      if (error) throw new Error("Failed to fetch providers");
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

    const objectUrl = URL.createObjectURL(previewQuery.data);
    setPreviewUrl(objectUrl);

    // For text files, also read the blob content as a string
    if (
      documentQuery.data &&
      getPreviewCategory(documentQuery.data.mimeType) === "text"
    ) {
      previewQuery.data.text().then((text) => {
        setTextPreviewContent(text);
      });
    } else {
      setTextPreviewContent(null);
    }

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [previewQuery.data, documentQuery.data?.mimeType]);

  // --- Mutations ---

  const updateMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, error } = await api.PATCH("/api/documents/{id}", {
        params: { path: { id: documentId } },
        body: body as any,
      });
      if (error) throw new Error("Failed to update document");
      return data as unknown as Document;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      setIsEditing(false);
    },
  });

  const resolveReviewMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/documents/{id}/review/resolve", {
        params: { path: { id: documentId } },
        body: {},
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to resolve review"));
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
  });

  const requeueMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.POST("/api/documents/{id}/review/requeue", {
        params: { path: { id: documentId } },
        body: { force: true },
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to requeue document"));
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: async (parseProvider?: ParseProvider) => {
      const { data, error } = await api.POST("/api/documents/{id}/reprocess", {
        params: { path: { id: documentId } },
        body: parseProvider ? { parseProvider } : undefined,
      });
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to reprocess document"));
      }
      return data;
    },
    onSuccess: () => {
      setReprocessDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    },
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async (field: ManualOverrideField) => {
      const { data, error } = await api.PATCH("/api/documents/{id}" as never, {
        params: { path: { id: documentId } },
        body: { clearLockedFields: [field] },
      } as never);
      if (error) {
        throw new Error(getApiErrorMessage(error, "Failed to clear manual override"));
      }
      return data as unknown as Document;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["document-history", documentId] });
    },
  });

  // --- Handlers ---

  function startEditing() {
    const doc = documentQuery.data;
    if (!doc) return;
    setEditForm({
      title: doc.title,
      issueDate: doc.issueDate ?? "",
      dueDate: doc.dueDate ?? "",
      amount: doc.amount !== null ? String(doc.amount) : "",
      currency: doc.currency ?? "",
      referenceNumber: doc.referenceNumber ?? "",
    });
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
  }

  function saveEdits() {
    const body: Record<string, unknown> = {};
    const doc = documentQuery.data;
    if (!doc) return;

    if (editForm.title && editForm.title !== doc.title) {
      body.title = editForm.title;
    }
    body.issueDate = editForm.issueDate || null;
    body.dueDate = editForm.dueDate || null;
    body.amount = editForm.amount ? Number(editForm.amount) : null;
    body.currency = editForm.currency || null;
    body.referenceNumber = editForm.referenceNumber || null;

    updateMutation.mutate(body);
  }

  async function handleDownload(variant: "original" | "searchable") {
    const url =
      variant === "searchable"
        ? `/api/documents/${documentId}/download/searchable`
        : `/api/documents/${documentId}/download`;

    const res = await authFetch(url);
    if (!res.ok) return;

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
          Back to Documents
        </Link>
        <div className="mt-8 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
          <p className="mt-2 text-sm text-muted-foreground">
            {documentQuery.error instanceof Error ? documentQuery.error.message : "Document not found"}
          </p>
          <Button variant="outline" className="mt-4" onClick={() => navigate({ to: "/documents" })}>
            Return to Documents
          </Button>
        </div>
      </div>
    );
  }

  const doc = documentQuery.data;
  const manualOverrides = doc.metadata.manual;
  const lockedFields = manualOverrides?.lockedFields ?? [];

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

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb / Back */}
      <div className="flex items-center gap-2">
        <Link
          to="/documents"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Documents
        </Link>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm font-medium truncate max-w-xs">{doc.title}</span>
      </div>

      {/* Document Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="h-6 w-6 shrink-0 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight truncate">{doc.title}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
          {doc.reviewStatus === "pending" && (
            <Badge variant="warning">Pending Review</Badge>
          )}
          {doc.reviewStatus === "resolved" && (
            <Badge variant="success">Review Resolved</Badge>
          )}
        </div>
      </div>

      {/* Two-Column Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Left Column - Content */}
        <div className="lg:col-span-3 space-y-4">
          <Tabs defaultValue="preview">
            <TabsList>
              <TabsTrigger value="preview" className="gap-1.5">
                <Eye className="h-3.5 w-3.5" />
                Preview
              </TabsTrigger>
              <TabsTrigger value="text" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                OCR Text
              </TabsTrigger>
              <TabsTrigger value="details" className="gap-1.5">
                <Hash className="h-3.5 w-3.5" />
                Details
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="h-3.5 w-3.5" />
                History
              </TabsTrigger>
            </TabsList>

            {/* Preview Tab */}
            <TabsContent value="preview">
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div
                    className="w-full rounded-md border overflow-hidden bg-muted"
                    style={{ height: "60vh" }}
                  >
                    {previewQuery.isLoading && (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {previewQuery.isError && (
                      <div className="flex h-full items-center justify-center p-6 text-sm text-destructive">
                        Failed to load document preview.
                      </div>
                    )}
                    {previewUrl &&
                      !previewQuery.isLoading &&
                      !previewQuery.isError && (
                        <>
                          {/* PDF: iframe */}
                          {previewCategory === "pdf" && (
                            <iframe
                              src={previewUrl}
                              className="h-full w-full"
                              title="Document Preview"
                            />
                          )}

                          {/* Image: native img */}
                          {previewCategory === "image" && (
                            <div className="flex h-full items-center justify-center bg-[repeating-conic-gradient(var(--color-muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] p-4">
                              <img
                                src={previewUrl}
                                alt={doc.title}
                                className="max-h-full max-w-full rounded object-contain shadow-lg"
                              />
                            </div>
                          )}

                          {/* Text: inline preformatted */}
                          {previewCategory === "text" && (
                            <div className="h-full overflow-auto p-4">
                              <pre className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words text-foreground">
                                {textPreviewContent ?? "Loading content..."}
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
                                Your browser does not support video playback.
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
                                Your browser does not support audio playback.
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
                                  Preview not available
                                </p>
                                <p className="text-xs text-muted-foreground max-w-xs">
                                  This file type (
                                  {friendlyMimeLabel(doc.mimeType)}) can't be
                                  previewed in the browser. Download the file to
                                  view it.
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 mt-2"
                                onClick={() => handleDownload("original")}
                              >
                                <Download className="h-3.5 w-3.5" />
                                Download File
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
                      Download Original
                    </Button>
                    {doc.searchablePdfAvailable && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => handleDownload("searchable")}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download Searchable PDF
                      </Button>
                    )}
                  </div>
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
                    <p className="text-sm text-destructive">Failed to load document text.</p>
                  )}
                  {textQuery.isSuccess && pageNumbers.length === 0 && (
                    <p className="text-sm text-muted-foreground py-8 text-center">
                      No OCR text available for this document.
                    </p>
                  )}
                  {textQuery.isSuccess && pageNumbers.length > 0 && (
                    <div className="space-y-6">
                      {pageNumbers.map((pageNum) => (
                        <div key={pageNum}>
                          <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                            Page {pageNum}
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

            {/* Details / Raw Metadata Tab */}
            <TabsContent value="details">
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
                  <CardTitle className="text-base">Document History</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {historyQuery.isLoading && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {historyQuery.isError && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                      Failed to load document history.
                    </div>
                  )}
                  {historyQuery.isSuccess && historyQuery.data.items.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No audit events recorded for this document yet.
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
                              "System"}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(event.createdAt)}
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
          </Tabs>
        </div>

        {/* Right Column - Metadata & Actions */}
        <div className="lg:col-span-2 space-y-4">
          {/* Metadata Card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Metadata</CardTitle>
                {!isEditing ? (
                  <Button variant="ghost" size="sm" className="gap-1.5" onClick={startEditing}>
                    <Edit2 className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                ) : (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1"
                      onClick={saveEdits}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={cancelEditing}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              {updateMutation.isError && (
                <p className="text-xs text-destructive mt-1">Failed to save changes.</p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Title */}
              {isEditing && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Title</Label>
                  <Input
                    value={editForm.title}
                    onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  />
                </div>
              )}

              {/* Correspondent */}
              <div className="flex items-start gap-2">
                <Building2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Correspondent</p>
                  <p className="text-sm font-medium">
                    {doc.correspondent?.name ?? "Unknown"}
                  </p>
                </div>
              </div>

              {/* Document Type */}
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Document Type</p>
                  <p className="text-sm font-medium">
                    {doc.documentType?.name ?? "Unclassified"}
                  </p>
                </div>
              </div>

              {/* Issue Date */}
              <div className="flex items-start gap-2">
                <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-muted-foreground">Issue Date</p>
                    {lockedFields.includes("issueDate") && (
                      <>
                        <Lock className="h-3 w-3 text-amber-500" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto px-1 py-0 text-xs text-muted-foreground hover:text-foreground gap-1"
                          onClick={() => clearOverrideMutation.mutate("issueDate")}
                          disabled={clearOverrideMutation.isPending}
                        >
                          <Unlock className="h-3 w-3" />
                          Unlock
                        </Button>
                      </>
                    )}
                  </div>
                  {isEditing ? (
                    <Input
                      type="date"
                      value={editForm.issueDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, issueDate: e.target.value }))}
                      className="mt-1"
                    />
                  ) : (
                    <p className="text-sm font-medium">{formatDate(doc.issueDate)}</p>
                  )}
                </div>
              </div>

              {/* Due Date */}
              <div className="flex items-start gap-2">
                <Clock className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-muted-foreground">Due Date</p>
                    {lockedFields.includes("dueDate") && (
                      <>
                        <Lock className="h-3 w-3 text-amber-500" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto px-1 py-0 text-xs text-muted-foreground hover:text-foreground gap-1"
                          onClick={() => clearOverrideMutation.mutate("dueDate")}
                          disabled={clearOverrideMutation.isPending}
                        >
                          <Unlock className="h-3 w-3" />
                          Unlock
                        </Button>
                      </>
                    )}
                  </div>
                  {isEditing ? (
                    <Input
                      type="date"
                      value={editForm.dueDate}
                      onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                      className="mt-1"
                    />
                  ) : (
                    <p className="text-sm font-medium">{formatDate(doc.dueDate)}</p>
                  )}
                </div>
              </div>

              {/* Amount & Currency */}
              <div className="flex items-start gap-2">
                <DollarSign className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-muted-foreground">Amount</p>
                    {(lockedFields.includes("amount") || lockedFields.includes("currency")) && (
                      <>
                        <Lock className="h-3 w-3 text-amber-500" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto px-1 py-0 text-xs text-muted-foreground hover:text-foreground gap-1"
                          onClick={() => {
                            if (lockedFields.includes("amount")) clearOverrideMutation.mutate("amount");
                            if (lockedFields.includes("currency")) clearOverrideMutation.mutate("currency");
                          }}
                          disabled={clearOverrideMutation.isPending}
                        >
                          <Unlock className="h-3 w-3" />
                          Unlock
                        </Button>
                      </>
                    )}
                  </div>
                  {isEditing ? (
                    <div className="flex gap-2 mt-1">
                      <Input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={editForm.amount}
                        onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))}
                        className="flex-1"
                      />
                      <Input
                        placeholder="EUR"
                        maxLength={3}
                        value={editForm.currency}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))
                        }
                        className="w-20"
                      />
                    </div>
                  ) : (
                    <p className="text-sm font-medium">
                      {doc.amount !== null
                        ? `${doc.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${doc.currency ?? ""}`
                        : "-"}
                    </p>
                  )}
                </div>
              </div>

              {/* Reference Number */}
              <div className="flex items-start gap-2">
                <Hash className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs text-muted-foreground">Reference Number</p>
                    {lockedFields.includes("referenceNumber") && (
                      <>
                        <Lock className="h-3 w-3 text-amber-500" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto px-1 py-0 text-xs text-muted-foreground hover:text-foreground gap-1"
                          onClick={() => clearOverrideMutation.mutate("referenceNumber")}
                          disabled={clearOverrideMutation.isPending}
                        >
                          <Unlock className="h-3 w-3" />
                          Unlock
                        </Button>
                      </>
                    )}
                  </div>
                  {isEditing ? (
                    <Input
                      value={editForm.referenceNumber}
                      onChange={(e) => setEditForm((f) => ({ ...f, referenceNumber: e.target.value }))}
                      className="mt-1"
                    />
                  ) : (
                    <p className="text-sm font-medium">{doc.referenceNumber ?? "-"}</p>
                  )}
                </div>
              </div>

              {/* Tags */}
              <div className="flex items-start gap-2">
                <Tag className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">Tags</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {doc.tags.length > 0 ? (
                      doc.tags.map((tag) => (
                        <Badge key={tag.id} variant="secondary">
                          {tag.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">No tags</span>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted-foreground">Manual Overrides</p>
                    <p className="text-sm font-medium">
                      {lockedFields.length > 0
                        ? `${lockedFields.length} field${lockedFields.length === 1 ? "" : "s"} locked`
                        : "None"}
                    </p>
                  </div>
                  {manualOverrides?.updatedAt && (
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(manualOverrides.updatedAt)}
                    </span>
                  )}
                </div>

                {lockedFields.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Edits to supported fields create sticky manual overrides that survive reprocessing.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {lockedFields.map((field) => (
                      <div
                        key={field}
                        className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {formatManualOverrideField(field)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {renderManualOverrideValue(doc, field)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="shrink-0"
                          onClick={() => clearOverrideMutation.mutate(field)}
                          disabled={clearOverrideMutation.isPending}
                        >
                          Clear
                        </Button>
                      </div>
                    ))}
                    {clearOverrideMutation.isError && (
                      <p className="text-xs text-destructive">
                        {clearOverrideMutation.error instanceof Error
                          ? clearOverrideMutation.error.message
                          : "Failed to clear manual override."}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* Confidence */}
              {doc.confidence !== null && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Confidence</span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${confidenceBg(doc.confidence)} ${confidenceColor(doc.confidence)}`}
                  >
                    {(doc.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              )}

              {/* Processing Status */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Processing Status</span>
                <Badge variant={statusVariant(doc.status)}>{doc.status}</Badge>
              </div>

              {/* Embedding Status */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Embedding Status</span>
                <Badge variant="outline">{doc.embeddingStatus}</Badge>
              </div>

              {/* OCR Provider */}
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <ScanText className="h-3 w-3" />
                  OCR Provider
                </span>
                <span className="text-xs font-medium text-right truncate">
                  {parseProviderLabel(doc.parseProvider)}
                </span>
              </div>

              {/* Embedding Model */}
              {doc.embeddingProvider && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                    <Braces className="h-3 w-3" />
                    Embedding Model
                  </span>
                  <div className="text-right min-w-0">
                    <p className="text-xs font-medium truncate">
                      {embeddingProviderLabel(doc.embeddingProvider)}
                    </p>
                    {doc.embeddingModel && (
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {doc.embeddingModel}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Timestamps */}
              <Separator />
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Created</span>
                  <span>{formatDateTime(doc.createdAt)}</span>
                </div>
                {doc.processedAt && (
                  <div className="flex justify-between">
                    <span>Processed</span>
                    <span>{formatDateTime(doc.processedAt)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Review Section */}
          {doc.reviewStatus === "pending" && (
            <Card className="border-amber-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  Pending Review
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Review Reasons */}
                <div className="flex flex-wrap gap-1.5">
                  {doc.reviewReasons.map((reason) => (
                    <Badge key={reason} variant="warning">
                      {formatReviewReason(reason)}
                    </Badge>
                  ))}
                </div>

                {/* Review Evidence */}
                {doc.metadata.reviewEvidence && (
                  <div className="rounded-md border bg-muted/50 p-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Document Class</span>
                      <span className="font-medium capitalize">
                        {doc.metadata.reviewEvidence.documentClass}
                      </span>
                    </div>
                    {doc.metadata.reviewEvidence.requiredFields.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Required Fields:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {doc.metadata.reviewEvidence.requiredFields.map((f) => (
                            <Badge key={f} variant="outline" className="text-xs">
                              {f}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {doc.metadata.reviewEvidence.missingFields.length > 0 && (
                      <div>
                        <span className="text-muted-foreground">Missing Fields:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {doc.metadata.reviewEvidence.missingFields.map((f) => (
                            <Badge key={f} variant="destructive" className="text-xs">
                              {f}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    {doc.metadata.reviewEvidence.confidence != null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Confidence</span>
                        <span className={`font-medium ${confidenceColor(doc.metadata.reviewEvidence.confidence)}`}>
                          {(doc.metadata.reviewEvidence.confidence * 100).toFixed(0)}%
                          {doc.metadata.reviewEvidence.confidenceThreshold != null && (
                            <span className="text-muted-foreground font-normal">
                              {" "}(threshold: {(doc.metadata.reviewEvidence.confidenceThreshold * 100).toFixed(0)}%)
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Review Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => resolveReviewMutation.mutate()}
                    disabled={resolveReviewMutation.isPending}
                  >
                    {resolveReviewMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="h-3.5 w-3.5" />
                    )}
                    Resolve Review
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => requeueMutation.mutate()}
                    disabled={requeueMutation.isPending}
                  >
                    {requeueMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    Requeue
                  </Button>
                </div>
                {resolveReviewMutation.isError && (
                  <p className="text-xs text-destructive">
                    {resolveReviewMutation.error instanceof Error
                      ? resolveReviewMutation.error.message
                      : "Failed to resolve review."}
                  </p>
                )}
                {requeueMutation.isError && (
                  <p className="text-xs text-destructive">
                    {requeueMutation.error instanceof Error
                      ? requeueMutation.error.message
                      : "Failed to requeue document."}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Actions Card */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {/* Reprocess — opens dialog when multiple providers available */}
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => {
                  const available = providersQuery.data?.parseProviders.filter((p) => p.available) ?? [];
                  if (available.length > 1) {
                    setSelectedParseProvider(
                      providersQuery.data?.activeParseProvider ?? available[0]?.id ?? "",
                    );
                    setReprocessDialogOpen(true);
                  } else {
                    reprocessMutation.mutate(undefined);
                  }
                }}
                disabled={reprocessMutation.isPending || doc.status === "processing"}
              >
                {reprocessMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                Reprocess Document
              </Button>
              {reprocessMutation.isError && (
                <p className="text-xs text-destructive">
                  {reprocessMutation.error instanceof Error
                    ? reprocessMutation.error.message
                    : "Failed to reprocess document."}
                </p>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => handleDownload("original")}
              >
                <Download className="h-4 w-4" />
                Download Original
              </Button>

              {doc.searchablePdfAvailable && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2"
                  onClick={() => handleDownload("searchable")}
                >
                  <Download className="h-4 w-4" />
                  Download Searchable PDF
                </Button>
              )}

              {/* Processing error */}
              {doc.lastProcessingError && (
                <>
                  <Separator />
                  <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-xs font-medium text-destructive mb-1">Last Processing Error</p>
                    <p className="text-xs text-muted-foreground">{doc.lastProcessingError}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Reprocess provider picker dialog */}
          <Dialog open={reprocessDialogOpen} onOpenChange={setReprocessDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reprocess Document</DialogTitle>
                <DialogDescription>
                  Choose the OCR provider to use for reprocessing.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Label htmlFor="parse-provider-select">OCR Provider</Label>
                <Select
                  value={selectedParseProvider}
                  onValueChange={(value) => setSelectedParseProvider(value as ParseProvider)}
                >
                  <SelectTrigger id="parse-provider-select">
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {(providersQuery.data?.parseProviders ?? [])
                      .filter((p) => p.available)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            {parseProviderLabel(p.id)}
                            {p.id === providersQuery.data?.activeParseProvider && (
                              <span className="text-xs text-muted-foreground">(active)</span>
                            )}
                            {p.id === providersQuery.data?.fallbackParseProvider && (
                              <span className="text-xs text-muted-foreground">(fallback)</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {doc.parseProvider && (
                  <p className="text-xs text-muted-foreground">
                    Last processed with: <span className="font-medium">{parseProviderLabel(doc.parseProvider)}</span>
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setReprocessDialogOpen(false)}
                  disabled={reprocessMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => reprocessMutation.mutate(selectedParseProvider || undefined)}
                  disabled={reprocessMutation.isPending || !selectedParseProvider}
                >
                  {reprocessMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Reprocessing...
                    </>
                  ) : (
                    "Reprocess"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
