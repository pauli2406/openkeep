import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDocumentProcessingLabel, isDocumentProcessing } from "@/lib/document-processing";

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
  if (!isDocumentProcessing(document)) {
    return null;
  }

  const label = getDocumentProcessingLabel(document) ?? "Processing";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--ok-accent)]/20 bg-[color:var(--ok-accent-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--ok-accent)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {label}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--ok-accent)]/12">
        <div className="h-full w-1/3 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full bg-[color:var(--ok-accent)]" />
      </div>
    </div>
  );
}
