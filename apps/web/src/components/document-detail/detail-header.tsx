import type { Ref } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Download,
  FileText,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  ScanText,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { getDocumentProcessingLabel, isDocumentProcessing } from "@/lib/document-processing";
import { useI18n } from "@/lib/i18n";

/** Structural: the route has its own richer Document shape. */
type StatusDocument = {
  status: string;
  latestProcessingJob?: { status: string } | null;
};

type HeaderDocument = StatusDocument & {
  title: string;
  reviewStatus: string;
  searchablePdfAvailable: boolean;
  correspondent: { name: string } | null;
  documentType: { name: string } | null;
};

type DetailHeaderProps = {
  doc: HeaderDocument;
  onDownload: (variant: "original" | "searchable") => void;
  onResolveReview: () => void;
  onRequeueReview: () => void;
  reviewPending: boolean;
  onReprocess: () => void;
  reprocessPending: boolean;
  onDelete: () => void;
  deletePending: boolean;
  /** a reprocess or delete would race the worker */
  processing: boolean;
  /** the archive is an offline copy, so nothing here may mutate it */
  readOnly: boolean;
  /** where focus goes back to when a dialog this menu opened closes */
  menuTriggerRef?: Ref<HTMLButtonElement>;
};

/** Where the document stands in the pipeline, in one pill. */
export function DocumentStatusBadge({ doc }: { doc: StatusDocument }) {
  const { t } = useI18n();

  if (isDocumentProcessing(doc)) {
    return (
      <Badge variant="info">
        <Spinner />
        {getDocumentProcessingLabel(doc) === "Queued"
          ? t("documentDetail.statusQueued")
          : t("documentDetail.processing")}
      </Badge>
    );
  }
  if (doc.status === "failed") {
    return <Badge variant="danger">{t("documentDetail.statusFailed")}</Badge>;
  }
  return <Badge variant="success">{t("documentDetail.statusReady")}</Badge>;
}

/**
 * The bar across the top of the workspace: what this document is, where it
 * stands, the one thing to do next, and everything else behind a menu.
 */
export function DetailHeader({
  doc,
  onDownload,
  onResolveReview,
  onRequeueReview,
  reviewPending,
  onReprocess,
  reprocessPending,
  onDelete,
  deletePending,
  processing,
  readOnly,
  menuTriggerRef,
}: DetailHeaderProps) {
  const { t } = useI18n();
  const reviewOpen = doc.reviewStatus === "pending";
  const subtitle = [doc.correspondent?.name, doc.documentType?.name].filter(Boolean).join(" · ");

  return (
    <header className="relative flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-3 py-2.5 md:px-4">
      <div className="flex min-w-0 flex-1 basis-64 items-center gap-2">
        <Button
          asChild
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
        >
          <Link to="/documents" aria-label={t("documentDetail.backToDocuments")}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0">
          {/* The only thing naming this document to a screen reader. */}
          <h1 className="truncate text-lg font-semibold tracking-tight" title={doc.title}>
            {doc.title}
          </h1>
          {subtitle ? (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <DocumentStatusBadge doc={doc} />
        {reviewOpen ? <Badge variant="warning">{t("documentDetail.needsReview")}</Badge> : null}

        {reviewOpen ? (
          <Button size="sm" onClick={onResolveReview} disabled={reviewPending || readOnly}>
            {reviewPending ? <Loader2 className="animate-spin" /> : <Check />}
            {t("documentDetail.resolveReview")}
          </Button>
        ) : (
          <Button size="sm" onClick={() => onDownload("original")}>
            <Download />
            {t("documentDetail.download")}
          </Button>
        )}

        {/* Non-modal: a modal menu that opens a dialog as it closes can leave
            the page unclickable once the dialog is gone. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild ref={menuTriggerRef}>
            <Button variant="outline" size="icon-sm" aria-label={t("documentDetail.moreActions")}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onSelect={() => onDownload("original")}>
              <Download />
              {t("documentDetail.original")}
            </DropdownMenuItem>
            {doc.searchablePdfAvailable ? (
              <DropdownMenuItem onSelect={() => onDownload("searchable")}>
                <FileText />
                {t("documentDetail.searchablePdf")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {!reviewOpen ? (
              <DropdownMenuItem
                onSelect={onRequeueReview}
                disabled={reviewPending || readOnly}
              >
                {reviewPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
                {t("documentDetail.requeue")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              onSelect={onReprocess}
              disabled={reprocessPending || processing || readOnly}
            >
              {reprocessPending ? <Loader2 className="animate-spin" /> : <ScanText />}
              {t("documentDetail.reprocess")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={onDelete}
              disabled={deletePending || processing || readOnly}
            >
              {deletePending ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t("documents.bulkDelete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isDocumentProcessing(doc) ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-px h-0.5 animate-pulse bg-gradient-action"
        />
      ) : null}
    </header>
  );
}
