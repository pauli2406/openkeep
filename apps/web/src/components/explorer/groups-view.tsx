import { LayoutGrid } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExplorerFacets } from "@/lib/explorer";
import { colorForValue } from "@/lib/explorer";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "./shared";

type GroupsViewProps = {
  /** Counts narrow with the sidebar since #73; the dominant type comes from
   *  the same filtered set since #74. */
  facets: ExplorerFacets | undefined;
  loading?: boolean;
  selectedCorrespondentIds: string[];
  onSelectCorrespondent: (correspondentId: string) => void;
  /** Which dimension the blocks group by; persisted in the URL (#272). */
  groupBy: "correspondents" | "categories";
  onGroupByChange: (groupBy: "correspondents" | "categories") => void;
  onSelectCategory: (categoryId: string) => void;
  onSelectUncategorized: () => void;
};

const GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-3";

/** One group: its name, its count, and how it weighs against the largest group. */
function GroupCard({
  name,
  count,
  max,
  detail,
  selected = false,
  muted = false,
  onClick,
}: {
  name: string;
  count: number;
  max: number;
  detail?: string | null;
  selected?: boolean;
  muted?: boolean;
  onClick: () => void;
}) {
  const color = muted ? "var(--muted-foreground)" : colorForValue(name);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "group flex min-w-0 flex-col gap-3 rounded-xl bg-card p-4 text-left shadow-card ring-1 ring-foreground/10 transition-all outline-none hover:-translate-y-0.5 hover:shadow-raised hover:ring-primary/40 focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "bg-brand-soft ring-2 ring-primary",
        muted && "border border-dashed bg-transparent shadow-none ring-0",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
          style={{
            color,
            backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)`,
          }}
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 truncate text-sm font-medium group-hover:text-brand">{name}</span>
      </span>{" "}
      <span className="num text-3xl font-semibold tracking-tight">{count}</span>{" "}
      <span aria-hidden="true" className="block h-1 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max((count / max) * 100, 3)}%`, backgroundColor: color }}
        />
      </span>
      {detail ? (
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      ) : null}
    </button>
  );
}

/**
 * Cards weighted by document count — the old galaxy view, made readable.
 * Two grouping levels: correspondents (the original), or life-domain
 * categories with their top correspondents inside. Clicking a card
 * filters the list to that group.
 */
export function GroupsView({
  facets,
  loading = false,
  selectedCorrespondentIds,
  onSelectCorrespondent,
  groupBy,
  onGroupByChange,
  onSelectCategory,
  onSelectUncategorized,
}: GroupsViewProps) {
  const { t } = useI18n();

  const categories = [...(facets?.categories ?? [])].sort((a, b) => b.count - a.count);
  const uncategorized = facets?.uncategorizedCount ?? 0;
  const groups = [...(facets?.correspondents ?? [])].sort((a, b) => b.count - a.count);
  const isEmpty =
    groupBy === "categories" ? categories.length === 0 && uncategorized === 0 : groups.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl
          label={t("groups.groupBy")}
          value={groupBy}
          onChange={onGroupByChange}
          options={[
            { value: "correspondents", label: t("groups.byCorrespondents") },
            { value: "categories", label: t("groups.byCategories") },
          ]}
        />
        <p className="min-w-48 flex-1 text-xs text-muted-foreground">
          {groupBy === "categories" ? t("groups.categoriesHint") : t("groups.correspondentsHint")}
        </p>
      </div>

      {loading ? (
        <div className={GRID_CLASS}>
          {[0, 1, 2, 3, 4, 5].map((card) => (
            <Skeleton key={card} className="h-36 rounded-xl" />
          ))}
        </div>
      ) : isEmpty ? (
        <Card className="py-0 shadow-card">
          <Empty className="py-20">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutGrid />
              </EmptyMedia>
              <EmptyDescription>{t("groups.empty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Card>
      ) : groupBy === "categories" ? (
        <div className={GRID_CLASS}>
          {categories.map((category) => (
            <GroupCard
              key={category.id}
              name={category.name}
              count={category.count}
              max={Math.max(categories[0]?.count ?? 1, uncategorized, 1)}
              detail={category.topCorrespondents.join(", ")}
              onClick={() => onSelectCategory(category.id)}
            />
          ))}
          {uncategorized > 0 ? (
            <GroupCard
              muted
              name={t("filters.uncategorized")}
              count={uncategorized}
              max={Math.max(categories[0]?.count ?? 1, uncategorized, 1)}
              onClick={onSelectUncategorized}
            />
          ) : null}
        </div>
      ) : (
        <div className={GRID_CLASS}>
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              name={group.name}
              count={group.count}
              max={groups[0]?.count ?? 1}
              detail={group.dominantTypeName}
              selected={selectedCorrespondentIds.includes(group.id)}
              onClick={() => onSelectCorrespondent(group.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
