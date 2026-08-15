import type { ExplorerFacets } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type GroupsViewProps = {
  /** Counts narrow with the sidebar since #73; the dominant type comes from
   *  the same filtered set since #74. */
  facets: ExplorerFacets | undefined;
  selectedCorrespondentIds: string[];
  onSelectCorrespondent: (correspondentId: string) => void;
  /** Which dimension the blocks group by; persisted in the URL (#272). */
  groupBy: "correspondents" | "categories";
  onGroupByChange: (groupBy: "correspondents" | "categories") => void;
  onSelectCategory: (categoryId: string) => void;
  onSelectUncategorized: () => void;
};

/**
 * Blocks sized by document count — the old galaxy view, made readable.
 * Two grouping levels: correspondents (the original), or life-domain
 * categories with their top correspondents inside. Clicking a block
 * filters the list to that group.
 */
export function GroupsView({
  facets,
  selectedCorrespondentIds,
  onSelectCorrespondent,
  groupBy,
  onGroupByChange,
  onSelectCategory,
  onSelectUncategorized,
}: GroupsViewProps) {
  const { t } = useI18n();

  const switcher = (
    <div className="mb-3 flex items-center gap-3">
      <p className="text-sm">
        <span className="font-semibold text-foreground">{t("groups.groupedBy")}</span>
      </p>
      <div className="flex gap-1 rounded-[var(--r-md)] border p-0.5">
        {(
          [
            { value: "correspondents", label: t("groups.byCorrespondents") },
            { value: "categories", label: t("groups.byCategories") },
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onGroupByChange(option.value)}
            className={cn(
              "rounded-[var(--r-sm)] px-2.5 py-1 text-sm transition-colors",
              groupBy === option.value
                ? "bg-accent font-semibold text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      <span className="text-sm text-muted-foreground">
        {groupBy === "categories" ? t("groups.categoriesCaption") : t("groups.caption")}
      </span>
    </div>
  );

  if (groupBy === "categories") {
    const categories = [...(facets?.categories ?? [])].sort((a, b) => b.count - a.count);
    const uncategorized = facets?.uncategorizedCount ?? 0;

    if (categories.length === 0 && uncategorized === 0) {
      return (
        <div className="p-4">
          {switcher}
          <div className="flex min-h-44 items-center justify-center border-t text-sm text-muted-foreground">
            {t("groups.empty")}
          </div>
        </div>
      );
    }

    const max = Math.max(categories[0]?.count ?? 1, uncategorized, 1);
    return (
      <div className="p-4">
        {switcher}
        <div className="grid grid-cols-6 gap-2.5">
          {categories.map((category) => {
            const isLarge = category.count >= max * 0.5;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => onSelectCategory(category.id)}
                className={cn(
                  "flex flex-col justify-between rounded-[var(--r-lg)] border bg-secondary p-3 text-left transition-colors hover:border-[var(--ok-accent)]/40",
                  isLarge ? "col-span-2 h-28" : "col-span-1 h-24",
                )}
              >
                <span className="truncate text-sm text-foreground">{category.name}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="ok-num text-xl font-semibold text-foreground">
                    {category.count}
                  </span>
                  {category.topCorrespondents.length > 0 ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {category.topCorrespondents.join(", ")}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
          {uncategorized > 0 ? (
            <button
              type="button"
              onClick={onSelectUncategorized}
              className="col-span-1 flex h-24 flex-col justify-between rounded-[var(--r-lg)] border border-dashed bg-secondary/50 p-3 text-left transition-colors hover:border-[var(--ok-accent)]/40"
            >
              <span className="truncate text-sm text-muted-foreground">
                {t("filters.uncategorized")}
              </span>
              <span className="ok-num text-xl font-semibold text-muted-foreground">
                {uncategorized}
              </span>
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const groups = [...(facets?.correspondents ?? [])].sort((a, b) => b.count - a.count);

  if (groups.length === 0) {
    return (
      <div className="p-4">
        {switcher}
        <div className="flex min-h-44 items-center justify-center border-t text-sm text-muted-foreground">
          {t("groups.empty")}
        </div>
      </div>
    );
  }

  const max = groups[0]?.count ?? 1;

  return (
    <div className="p-4">
      {switcher}
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
              <span className="flex items-baseline gap-1.5">
                <span className="ok-num text-xl font-semibold text-foreground">
                  {group.count}
                </span>
                {group.dominantTypeName ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {group.dominantTypeName}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
