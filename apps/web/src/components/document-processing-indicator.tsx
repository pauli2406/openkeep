import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { getDocumentProcessingLabel, isDocumentProcessing } from "@/lib/document-processing";
import { useI18n } from "@/lib/i18n";

type ProcessableDocumentLike = {
  status: string;
  latestProcessingJob?: {
    status: string;
  } | null;
};

export function DocumentProcessingIndicator({
  document,
  className,
}: {
  document: ProcessableDocumentLike;
  className?: string;
}) {
  const { t } = useI18n();

  if (!isDocumentProcessing(document)) {
    return null;
  }

  const queued = getDocumentProcessingLabel(document) === "Queued";

  return (
    <Badge variant="info" className={className}>
      <Spinner aria-hidden="true" />
      {queued ? t("documents.queued") : t("documents.processing")}
    </Badge>
  );
}
