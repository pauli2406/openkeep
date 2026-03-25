import { Buffer } from "buffer";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import { PDFDocument } from "pdf-lib";

globalThis.Buffer = globalThis.Buffer ?? Buffer;

export type DocumentStatus = "pending" | "processing" | "ready" | "failed";
export type ReviewStatus = "not_required" | "pending" | "resolved";

export type ArchiveDocument = {
  id: string;
  title: string;
  mimeType: string;
  status: DocumentStatus;
  createdAt: string;
  issueDate: string | null;
  dueDate: string | null;
  amount: number | null;
  currency: string | null;
  referenceNumber: string | null;
  correspondent: { id: string; name: string; slug: string } | null;
  documentType: { id: string; name: string; slug: string } | null;
  tags: Array<{ id: string; name: string; slug: string }>;
  reviewStatus: ReviewStatus;
  reviewReasons: string[];
  searchablePdfAvailable: boolean;
  metadata: {
    pageCount?: number;
    summary?: string;
  };
  snippets?: string[];
};

export type SearchDocumentsResponse = {
  items: ArchiveDocument[];
  total: number;
  page: number;
  pageSize: number;
};

export type ReviewQueueResponse = SearchDocumentsResponse;

export type DashboardInsights = {
  stats: {
    totalDocuments: number;
    pendingReview: number;
    documentTypesCount: number;
    correspondentsCount: number;
  };
  recentDocuments: ArchiveDocument[];
  topCorrespondents: Array<{
    id: string;
    name: string;
    slug: string;
    documentCount: number;
    totalAmount: number | null;
    currency: string | null;
    latestDocDate?: string | null;
    documentTypes?: Array<{ name: string; count: number }>;
  }>;
  upcomingDeadlines: Array<{
    documentId: string;
    title: string;
    referenceNumber?: string | null;
    dueDate: string;
    amount: number | null;
    currency: string | null;
    correspondentName: string | null;
    documentTypeName?: string | null;
    taskLabel: string;
    daysUntilDue: number;
    isOverdue: boolean;
  }>;
  overdueItems: Array<{
    documentId: string;
    title: string;
    referenceNumber?: string | null;
    dueDate: string;
    amount: number | null;
    currency: string | null;
    daysUntilDue: number;
    isOverdue: boolean;
    correspondentName: string | null;
    documentTypeName?: string | null;
    taskLabel: string;
  }>;
  monthlyActivity?: Array<{ month: string; count: number }>;
};

export type DocumentTextResponse = {
  documentId: string;
  blocks: Array<{
    documentId: string;
    page: number;
    lineIndex: number;
    text: string;
  }>;
};

export type DocumentHistoryResponse = {
  documentId: string;
  items: Array<{
    id: string;
    eventType: string;
    createdAt: string;
    actorDisplayName?: string | null;
    actorEmail?: string | null;
  }>;
};

export type SemanticSearchResponse = {
  items: Array<{
    document: ArchiveDocument;
    score: number;
    matchedChunks: Array<{
      chunkIndex: number;
      text: string;
      pageFrom: number | null;
      pageTo: number | null;
    }>;
  }>;
  total: number;
};

export type AnswerQueryResponse = {
  status: "answered" | "insufficient_evidence";
  answer: string | null;
  citations: Array<{
    documentId: string;
    documentTitle: string;
    chunkIndex: number;
    quote: string;
    pageFrom: number | null;
    pageTo: number | null;
  }>;
  results: Array<{
    document: ArchiveDocument;
    score: number;
  }>;
};

export type FacetsResponse = {
  correspondents: Array<{ id: string; name: string; slug: string; count: number }>;
  documentTypes: Array<{ id: string; name: string; slug: string; count: number }>;
  tags: Array<{ id: string; name: string; slug: string; count: number }>;
  statuses: Array<{ status: string; count: number }>;
  years: Array<{ year: number; count: number }>;
};

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  try {
    return new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatCurrency(amount: number | null | undefined, currency = "EUR") {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return "-";
  }

  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export function titleForDocument(document: ArchiveDocument) {
  return document.title?.trim() || document.referenceNumber?.trim() || "Untitled document";
}

export function toneForStatus(status: string): "default" | "success" | "warning" | "danger" {
  if (status === "ready" || status === "resolved") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "pending" || status === "processing") {
    return "warning";
  }
  return "default";
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMonthLabel(month: string) {
  const parts = month.split("-");
  const monthIndex = Number.parseInt(parts[1] ?? "0", 10) - 1;
  return MONTH_LABELS[monthIndex] ?? month;
}

export function formatMonthYear(month: string) {
  const parts = month.split("-");
  return parts[0] ?? month;
}

export function formatTaskDateLabel(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export async function createPdfFromImages(imageUris: string[]) {
  const pdf = await PDFDocument.create();

  for (const imageUri of imageUris) {
    const normalized = await ImageManipulator.manipulateAsync(
      imageUri,
      [],
      {
        compress: 0.92,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );

    const base64 = await FileSystem.readAsStringAsync(normalized.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    const jpg = await pdf.embedJpg(bytes);
    const page = pdf.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, {
      x: 0,
      y: 0,
      width: jpg.width,
      height: jpg.height,
    });
  }

  const pdfBytes = await pdf.save();
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}openkeep-scan-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(uri, Buffer.from(pdfBytes).toString("base64"), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

export async function responseToMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return `Request failed with ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    if (typeof parsed.message === "string") {
      return parsed.message;
    }
    if (Array.isArray(parsed.message)) {
      return parsed.message.join(", ");
    }
  } catch {
    return text;
  }

  return text;
}

export async function saveDownloadToFile(response: Response, filename: string) {
  const arrayBuffer = await response.arrayBuffer();
  const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(uri, Buffer.from(arrayBuffer).toString("base64"), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}
