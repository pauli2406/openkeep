import { FileTextIcon } from "lucide-react";
import type { AnswerCitation } from "@openkeep/types";
import { Button } from "@/components/ui/button";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@/components/ui/trace";
import { cn } from "@/lib/utils";

/** One source pill per document instead of one per retrieved chunk. */
export function groupCitationsByDocument(citations: AnswerCitation[]): AnswerCitation[][] {
  const groups = new Map<string, AnswerCitation[]>();
  for (const citation of citations) {
    const group = groups.get(citation.documentId) ?? [];
    group.push(citation);
    groups.set(citation.documentId, group);
  }
  return [...groups.values()];
}

/** The citations under an answer, as a collapsible trace line of outline buttons. */
export function Sources({
  citations,
  label,
  defaultOpen,
  selected = null,
  pageLabel,
  onSelect,
}: {
  citations: AnswerCitation[];
  label: string;
  defaultOpen?: boolean;
  selected?: AnswerCitation | null;
  pageLabel: string;
  onSelect: (citation: AnswerCitation) => void;
}) {
  return (
    <Trace>
      <TraceCollapsible defaultOpen={defaultOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <FileTextIcon />
            </TraceIcon>
            <TraceTitle>{label}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {groupCitationsByDocument(citations).map((group) => {
              const first = group[0]!;
              const pages = [
                ...new Set(
                  group
                    .map((citation) => citation.pageFrom)
                    .filter((page): page is number => page != null),
                ),
              ];
              return (
                <Button
                  key={`${first.documentId}-${first.index ?? 0}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-auto max-w-full justify-start rounded-lg py-1.5 font-normal shadow-none",
                    selected != null && group.includes(selected) && "border-ring bg-brand-soft",
                  )}
                  onClick={() => onSelect(first)}
                >
                  <span className="num flex shrink-0 gap-0.5">
                    {group.map((citation, index) => (
                      <span
                        key={citation.index ?? index}
                        className="flex size-4.5 items-center justify-center rounded-full bg-brand-soft text-[10px] font-semibold text-brand-soft-foreground"
                      >
                        {citation.index ?? index + 1}
                      </span>
                    ))}
                  </span>
                  <span className="truncate">{first.documentTitle}</span>
                  {pages.length > 0 ? (
                    <span className="num shrink-0 text-xs text-muted-foreground">
                      {pageLabel}
                      {pages.join(",")}
                    </span>
                  ) : null}
                </Button>
              );
            })}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
