import type { ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AnswerCitation } from "@openkeep/types";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { linkifyCitations } from "@/hooks/use-answer-stream";
import { cn } from "@/lib/utils";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

/**
 * A rendered answer. `[1]` markers become inline citations (the Inline Citation
 * pattern): a small button in the sentence whose hover card shows the passage,
 * and which opens that passage when clicked.
 */
export function AnswerMarkdown({
  text,
  citations,
  onCitationSelect,
  className,
}: {
  text: string;
  citations: AnswerCitation[];
  onCitationSelect?: (citation: AnswerCitation) => void;
  className?: string;
}) {
  return (
    <div className={cn("typeset min-w-0", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (!href?.startsWith("/documents/")) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            }

            const documentId = href.replace("/documents/", "").split(/[?#]/)[0];
            // The marker is exact ("[2, p.4]"); the document alone is not, since
            // one document can be cited at several passages.
            const label = textOf(children).replace(/^\[|\]$/g, "");
            const index = Number.parseInt(label, 10);
            const citation =
              citations.find((entry) => entry.index === index) ??
              citations.find((entry) => entry.documentId === documentId);

            if (!citation) {
              return <a href={href}>{children}</a>;
            }

            return (
              <HoverCard openDelay={120} closeDelay={100}>
                <HoverCardTrigger asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    className="num mx-0.5 h-5 translate-y-[-1px] rounded-md bg-brand-soft px-1.5 text-[11px] font-semibold text-brand-soft-foreground hover:bg-accent"
                    aria-label={`${label} · ${citation.documentTitle}`}
                    onClick={() => onCitationSelect?.(citation)}
                  >
                    {Number.isNaN(index) ? label : index}
                  </Button>
                </HoverCardTrigger>
                <HoverCardContent className="flex w-72 flex-col gap-1.5 text-sm">
                  <div className="font-medium">{citation.documentTitle}</div>
                  {citation.quote ? (
                    <p className="line-clamp-4 text-muted-foreground">{citation.quote}</p>
                  ) : null}
                </HoverCardContent>
              </HoverCard>
            );
          },
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto">
              <table {...props}>{children}</table>
            </div>
          ),
        }}
      >
        {linkifyCitations(text, citations, [])}
      </Markdown>
    </div>
  );
}
