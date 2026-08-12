import { Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Download, FileText, Loader2, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

/** Structural: the route has its own richer Document shape. */
type HeaderDocument = {
  title: string;
  status: string;
  reviewStatus: string;
  searchablePdfAvailable: boolean;
};

type DetailHeaderProps = {
  doc: HeaderDocument;
  onDownload: (variant: "original" | "searchable") => void;
  onResolveReview: () => void;
  onRequeueReview: () => void;
  reviewPending: boolean;
};

/**
 * The breadcrumb bar across the top of the detail screen:
 * back link · title · status badge · Original / Searchable PDF / Confirm.
 */
export function DetailHeader({
  doc,
  onDownload,
  onResolveReview,
  onRequeueReview,
  reviewPending,
}: DetailHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="flex h-12 flex-shrink-0 items-center gap-2.5 border-b px-4">
      <Link
        to="/documents"
        className="inline-flex flex-shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-[13px] w-[13px]" />
        {t("documentDetail.documents")}
      </Link>
      <span className="text-sm text-[var(--ok-faint)]">/</span>
      {/* The breadcrumb doubles as the page heading — it is the only thing
          naming this document to a screen reader. */}
      <h1 className="min-w-0 truncate text-sm font-semibold">{doc.title}</h1>

      {doc.status === "failed" ? (
        <Badge variant="bad">{doc.status}</Badge>
      ) : null}
      {doc.reviewStatus === "pending" ? (
        <Badge variant="warn">{t("documentDetail.needsReview")}</Badge>
      ) : null}

      <div className="ml-auto flex flex-shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={() => onDownload("original")}>
          <Download />
          {t("documentDetail.original")}
        </Button>
        {doc.searchablePdfAvailable ? (
          <Button variant="outline" size="sm" onClick={() => onDownload("searchable")}>
            <FileText />
            {t("documentDetail.searchablePdf")}
          </Button>
        ) : null}
        {doc.reviewStatus === "pending" ? (
          <Button size="sm" onClick={onResolveReview} disabled={reviewPending}>
            {reviewPending ? <Loader2 className="animate-spin" /> : <Check />}
            {t("documentDetail.resolveReview")}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onRequeueReview}
            disabled={reviewPending}
          >
            {reviewPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {t("documentDetail.requeue")}
          </Button>
        )}
      </div>
    </div>
  );
}
