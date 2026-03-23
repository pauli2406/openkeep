import type { ReactNode } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ExplorerFacets, ExplorerSearch } from "@/lib/explorer";

type FilterSidebarProps = {
  facets?: ExplorerFacets;
  search: ExplorerSearch;
  onSearchChange: (updates: Partial<ExplorerSearch>) => void;
  className?: string;
  compact?: boolean;
};

function toggleArrayValue(values: string[] | undefined, value: string) {
  if (!values || values.length === 0) {
    return [value];
  }
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 border-t border-[color:var(--explorer-border)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.24em] text-[color:var(--explorer-muted)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function FacetCheckbox({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-transparent px-3 py-2 transition hover:border-[color:var(--explorer-border)] hover:bg-black/3">
      <span className="flex items-center gap-3 text-sm text-[color:var(--explorer-ink)]">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="h-4 w-4 rounded border-[color:var(--explorer-border-strong)] accent-[color:var(--explorer-rust)]"
        />
        {label}
      </span>
      <span className="text-xs text-[color:var(--explorer-muted)]">{count}</span>
    </label>
  );
}

export function FilterSidebar({
  facets,
  search,
  onSearchChange,
  className,
  compact = false,
}: FilterSidebarProps) {
  const activeCount = [
    search.query,
    search.year,
    search.correspondentIds?.length,
    search.documentTypeIds?.length,
    search.statuses?.length,
    search.tags?.length,
    search.amountMin,
    search.amountMax,
  ].filter(Boolean).length;

  return (
    <aside
      className={cn(
        "rounded-[2rem] border border-[color:var(--explorer-border)] bg-[color:var(--explorer-panel)] p-5 shadow-[0_24px_80px_rgba(39,33,22,0.08)]",
        className,
      )}
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-[color:var(--explorer-muted)]">
            <Filter className="h-3.5 w-3.5" />
            Explorer Filters
          </p>
          <p className="mt-1 text-sm text-[color:var(--explorer-muted)]">
            {activeCount} active
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full text-[color:var(--explorer-muted)]"
          onClick={() =>
            onSearchChange({
              query: undefined,
              year: undefined,
              correspondentIds: undefined,
              documentTypeIds: undefined,
              statuses: undefined,
              tags: undefined,
              amountMin: undefined,
              amountMax: undefined,
              page: undefined,
            })
          }
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      </div>

      <div className="space-y-5">
        <FilterSection title="Years">
          <div className="grid grid-cols-2 gap-2">
            {facets?.years.slice(0, compact ? 6 : 12).map((year) => (
              <button
                key={year.year}
                type="button"
                onClick={() =>
                  onSearchChange({
                    year: search.year === year.year ? undefined : year.year,
                    page: undefined,
                  })
                }
                className={cn(
                  "rounded-2xl border px-3 py-2 text-left text-sm transition",
                  search.year === year.year
                    ? "border-[color:var(--explorer-rust)] bg-[color:var(--explorer-rust-soft)] text-[color:var(--explorer-rust)]"
                    : "border-[color:var(--explorer-border)] text-[color:var(--explorer-ink)] hover:border-[color:var(--explorer-rust)]/40",
                )}
              >
                <span className="block font-medium">{year.year}</span>
                <span className="text-xs text-[color:var(--explorer-muted)]">
                  {year.count} docs
                </span>
              </button>
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Status">
          <div className="space-y-1.5">
            {facets?.statuses.map((item) => (
              <FacetCheckbox
                key={item.status}
                label={item.status}
                count={item.count}
                checked={search.statuses?.includes(item.status) ?? false}
                onChange={() =>
                  onSearchChange({
                    statuses: toggleArrayValue(search.statuses, item.status),
                    page: undefined,
                  })
                }
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Correspondents">
          <div className="space-y-1.5">
            {facets?.correspondents.slice(0, compact ? 8 : 14).map((item) => (
              <FacetCheckbox
                key={item.id}
                label={item.name}
                count={item.count}
                checked={search.correspondentIds?.includes(item.id) ?? false}
                onChange={() =>
                  onSearchChange({
                    correspondentIds: toggleArrayValue(search.correspondentIds, item.id),
                    page: undefined,
                  })
                }
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Document Types">
          <div className="space-y-1.5">
            {facets?.documentTypes.slice(0, compact ? 6 : 12).map((item) => (
              <FacetCheckbox
                key={item.id}
                label={item.name}
                count={item.count}
                checked={search.documentTypeIds?.includes(item.id) ?? false}
                onChange={() =>
                  onSearchChange({
                    documentTypeIds: toggleArrayValue(search.documentTypeIds, item.id),
                    page: undefined,
                  })
                }
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Tags">
          <div className="space-y-1.5">
            {facets?.tags.slice(0, compact ? 6 : 12).map((item) => (
              <FacetCheckbox
                key={item.id}
                label={item.name}
                count={item.count}
                checked={search.tags?.includes(item.id) ?? false}
                onChange={() =>
                  onSearchChange({
                    tags: toggleArrayValue(search.tags, item.id),
                    page: undefined,
                  })
                }
              />
            ))}
          </div>
        </FilterSection>

        <FilterSection title="Amount Range">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                Minimum
              </span>
              <input
                type="number"
                value={search.amountMin ?? ""}
                min={facets?.amountRange.min ?? undefined}
                max={facets?.amountRange.max ?? undefined}
                onChange={(event) =>
                  onSearchChange({
                    amountMin: event.target.value ? Number(event.target.value) : undefined,
                    page: undefined,
                  })
                }
                className="h-11 w-full rounded-2xl border border-[color:var(--explorer-border)] bg-white/60 px-3 text-sm text-[color:var(--explorer-ink)] outline-none transition focus:border-[color:var(--explorer-cobalt)]"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-[0.18em] text-[color:var(--explorer-muted)]">
                Maximum
              </span>
              <input
                type="number"
                value={search.amountMax ?? ""}
                min={facets?.amountRange.min ?? undefined}
                max={facets?.amountRange.max ?? undefined}
                onChange={(event) =>
                  onSearchChange({
                    amountMax: event.target.value ? Number(event.target.value) : undefined,
                    page: undefined,
                  })
                }
                className="h-11 w-full rounded-2xl border border-[color:var(--explorer-border)] bg-white/60 px-3 text-sm text-[color:var(--explorer-ink)] outline-none transition focus:border-[color:var(--explorer-cobalt)]"
              />
            </label>
          </div>
        </FilterSection>
      </div>
    </aside>
  );
}
