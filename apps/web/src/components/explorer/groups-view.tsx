import type { ExplorerFacets } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type GroupsViewProps = {
  /**
   * Archive-wide: `/api/documents/facets` accepts no query, so these counts
   * do not narrow with the sidebar. The caption says so.
   */
  facets: ExplorerFacets | undefined;
  selectedCorrespondentIds: string[];
  onSelectCorrespondent: (correspondentId: string) => void;
  hasFilters?: boolean;
};

/**
 * Correspondent blocks sized by document count — the old galaxy view, made
 * readable. Clicking a block filters the list to that correspondent.
 */
export function GroupsView({
  facets,
  selectedCorrespondentIds,
  onSelectCorrespondent,
  hasFilters = false,
}: GroupsViewProps) {
  const { t } = useI18n();

  const groups = [...(facets?.correspondents ?? [])].sort((a, b) => b.count - a.count);

  if (groups.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center border-t text-sm text-muted-foreground">
        {t("groups.empty")}
      </div>
    );
  }

  const max = groups[0]?.count ?? 1;

  return (
    <div className="p-4">
      <p className="mb-3 text-sm">
        <span className="font-semibold text-foreground">{t("groups.groupedBy")}</span>{" "}
        <span className="text-muted-foreground">
          {hasFilters ? t("groups.captionUnfiltered") : t("groups.caption")}
        </span>
      </p>

      <div className="grid grid-cols-6 gap-2.5">
        {groups.map((group) => {
          const isLarge = group.count >= max * 0.5;
          const isSelected = selectedCorrespondentIds.includes(group.id);
          return (
            <button
              key={group.id}
              type="button"
              onClick={() => onSelectCorrespondent(group.id)}
              className={cn(
                "flex flex-col justify-between rounded-[var(--r-lg)] border bg-secondary p-3 text-left transition-colors hover:border-[var(--ok-accent)]/40",
                // Block size is document count.
                isLarge ? "col-span-2 h-28" : "col-span-1 h-24",
                isSelected && "border-[var(--ok-accent)] bg-accent",
              )}
            >
              <span className="truncate text-sm text-foreground">{group.name}</span>
              <span className="ok-num text-xl font-semibold text-foreground">
                {group.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
