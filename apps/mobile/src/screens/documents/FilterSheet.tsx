import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  countActiveFilters,
  parseFilterAmount,
  parseFilterDate,
  toggleValue,
} from "../../api/documents";
import { BottomSheet, Skeleton } from "../../components/layout";
import { Button, Pill } from "../../components/ui";
import { useI18n, type TranslationKey } from "../../i18n";
import type { DocumentFilters, FacetsResponse } from "../../lib";
import { createThemedStyles, radii, useColors } from "../../theme";
import { tabular, text } from "../../typography";
import { CheckMark } from "./parts";

/** Above this many entries a section gets its own filter box. */
const SEARCHABLE_THRESHOLD = 8;
const UNCATEGORIZED = "__uncategorized__";

const STATUS_LABELS: Record<string, TranslationKey> = {
  ready: "documents.statusReady",
  pending: "documents.statusPending",
  processing: "documents.statusProcessing",
  failed: "documents.statusFailed",
};

type Translate = ReturnType<typeof useI18n>["t"];

/** A document status for people; an unknown status falls through as written. */
export function statusLabel(status: string, t: Translate): string {
  const key = STATUS_LABELS[status];
  return key ? t(key) : status;
}

type FacetEntry = { id: string; label: string; count: number };

function FilterSection({
  title,
  activeCount = 0,
  defaultOpen = true,
  children,
}: {
  title: string;
  activeCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(defaultOpen || activeCount > 0);
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={activeCount > 0 ? `${title}, ${activeCount}` : title}
        onPress={() => setOpen((current) => !current)}
        style={styles.sectionHead}
      >
        <MaterialCommunityIcons
          name={open ? "chevron-down" : "chevron-right"}
          size={18}
          color={colors.muted}
        />
        <Text style={styles.sectionTitle} numberOfLines={1}>
          {title}
        </Text>
        {activeCount > 0 ? (
          <View>
            <Pill label={String(activeCount)} tone="soft" />
          </View>
        ) : null}
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

function FacetSection({
  title,
  entries,
  selectedIds,
  onToggle,
  defaultOpen,
}: {
  title: string;
  entries: FacetEntry[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  defaultOpen?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [filter, setFilter] = useState("");

  const searchable = entries.length > SEARCHABLE_THRESHOLD;
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? entries.filter((entry) => entry.label.toLowerCase().includes(needle)) : entries;
  }, [entries, filter]);

  if (entries.length === 0) return null;

  const rows = visible.map((entry) => {
    const checked = selectedIds.includes(entry.id);
    return (
      <Pressable
        key={entry.id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`${entry.label}, ${entry.count}`}
        onPress={() => onToggle(entry.id)}
        style={({ pressed }) => [styles.facetRow, pressed ? styles.facetRowPressed : null]}
      >
        <CheckMark state={checked ? "on" : "off"} />
        <Text style={styles.facetLabel} numberOfLines={1}>
          {entry.label}
        </Text>
        <Text style={styles.facetCount}>{entry.count}</Text>
      </Pressable>
    );
  });

  return (
    <FilterSection title={title} activeCount={selectedIds.length} defaultOpen={defaultOpen}>
      {searchable ? (
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder={t("filters.searchPlaceholder")}
          placeholderTextColor={colors.muted}
          accessibilityLabel={`${title}: ${t("filters.searchPlaceholder")}`}
          autoCorrect={false}
          style={styles.input}
        />
      ) : null}
      {visible.length === 0 ? (
        <Text style={styles.hint}>{t("filters.noMatches")}</Text>
      ) : searchable ? (
        <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.longList}>
          {rows}
        </ScrollView>
      ) : (
        rows
      )}
    </FilterSection>
  );
}

/**
 * Applies what it can as it is typed and holds the rest. A half-typed date is not
 * a filter, and sending it would only earn a validation error from the API.
 */
function TypedFilterInput<T>({
  label,
  value,
  format,
  parse,
  onCommit,
  placeholder,
  keyboardType,
  invalidHint,
}: {
  label: string;
  value: T | undefined;
  format: (value: T) => string;
  parse: (text: string) => T | null;
  onCommit: (value: T | undefined) => void;
  placeholder: string;
  keyboardType: "default" | "decimal-pad" | "numbers-and-punctuation";
  invalidHint?: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [draft, setDraft] = useState(value === undefined ? "" : format(value));

  // A chip or `Clear` can take the value away from outside.
  useEffect(() => {
    const parsed = draft.trim() ? parse(draft) : undefined;
    if (value === undefined && parsed !== null && parsed !== undefined) {
      setDraft("");
    } else if (value !== undefined && parsed !== value) {
      setDraft(format(value));
    }
    // Only an outside change of the value should reach the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const invalid = draft.trim().length > 0 && parse(draft) === null;

  return (
    <View style={styles.typedField}>
      <Text style={styles.typedLabel}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={(next) => {
          setDraft(next);
          if (!next.trim()) {
            onCommit(undefined);
            return;
          }
          const parsed = parse(next);
          if (parsed !== null) onCommit(parsed);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={label}
        keyboardType={keyboardType}
        autoCorrect={false}
        style={[styles.input, invalid ? styles.inputInvalid : null]}
      />
      {invalid && invalidHint ? <Text style={styles.invalidHint}>{invalidHint}</Text> : null}
    </View>
  );
}

function FacetsSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeleton}>
      {[0, 1, 2].map((group) => (
        <View key={group} style={styles.skeletonGroup}>
          <Skeleton style={styles.skeletonHead} />
          <Skeleton style={styles.skeletonLine} />
          <Skeleton style={styles.skeletonLine} />
        </View>
      ))}
    </View>
  );
}

/** The web's filter sidebar, as the sheet it becomes on a phone. */
export function FilterSheet({
  visible,
  onClose,
  facets,
  loading,
  error,
  onRetry,
  filters,
  onChange,
  onClear,
}: {
  visible: boolean;
  onClose: () => void;
  facets: FacetsResponse | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  filters: DocumentFilters;
  onChange: (updates: Partial<DocumentFilters>) => void;
  onClear: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const activeCount = countActiveFilters(filters);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={t("filters.title")}
      footer={
        <View style={styles.footerSlot}>
          <Button label={t("filters.done")} onPress={onClose} />
        </View>
      }
    >
      <View style={styles.intro}>
        <Text style={styles.description}>{t("filters.sheetDescription")}</Text>
        {activeCount > 0 ? (
          <Pressable accessibilityRole="button" onPress={onClear} hitSlop={12}>
            <Text style={styles.clear}>{t("filters.clear")}</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <FacetsSkeleton />
      ) : (
        <View>
          {error ? (
            <View style={styles.errorRow}>
              <Text style={styles.errorText}>{t("filters.loadError")}</Text>
              <Button label={t("common.retry")} variant="secondary" size="sm" onPress={onRetry} />
            </View>
          ) : null}

          <FacetSection
            title={t("filters.status")}
            entries={(facets?.statuses ?? []).map((entry) => ({
              id: entry.status,
              label: statusLabel(entry.status, t),
              count: entry.count,
            }))}
            selectedIds={filters.statuses ?? []}
            onToggle={(id) => onChange({ statuses: toggleValue(filters.statuses, id) })}
          />
          <FacetSection
            title={t("filters.year")}
            entries={(facets?.years ?? []).map((entry) => ({
              id: String(entry.year),
              label: String(entry.year),
              count: entry.count,
            }))}
            selectedIds={filters.year != null ? [String(filters.year)] : []}
            onToggle={(id) =>
              onChange({ year: filters.year === Number(id) ? undefined : Number(id) })
            }
          />
          <FacetSection
            title={t("filters.type")}
            entries={(facets?.documentTypes ?? []).map((entry) => ({
              id: entry.id,
              label: entry.name,
              count: entry.count,
            }))}
            selectedIds={filters.documentTypeIds ?? []}
            onToggle={(id) =>
              onChange({ documentTypeIds: toggleValue(filters.documentTypeIds, id) })
            }
          />
          <FacetSection
            title={t("filters.correspondent")}
            entries={(facets?.correspondents ?? []).map((entry) => ({
              id: entry.id,
              label: entry.name,
              count: entry.count,
            }))}
            selectedIds={filters.correspondentIds ?? []}
            onToggle={(id) =>
              onChange({ correspondentIds: toggleValue(filters.correspondentIds, id) })
            }
          />
          <FacetSection
            title={t("filters.category")}
            defaultOpen={false}
            entries={[
              ...(facets?.categories ?? []).map((entry) => ({
                id: entry.id,
                label: entry.name,
                count: entry.count,
              })),
              ...((facets?.uncategorizedCount ?? 0) > 0
                ? [
                    {
                      id: UNCATEGORIZED,
                      label: t("filters.uncategorized"),
                      count: facets?.uncategorizedCount ?? 0,
                    },
                  ]
                : []),
            ]}
            selectedIds={[
              ...(filters.categoryIds ?? []),
              ...(filters.uncategorized ? [UNCATEGORIZED] : []),
            ]}
            onToggle={(id) =>
              id === UNCATEGORIZED
                ? onChange({ uncategorized: filters.uncategorized ? undefined : true })
                : onChange({ categoryIds: toggleValue(filters.categoryIds, id) })
            }
          />
          <FacetSection
            title={t("filters.tag")}
            defaultOpen={false}
            entries={(facets?.tags ?? []).map((entry) => ({
              id: entry.id,
              label: entry.name,
              count: entry.count,
            }))}
            selectedIds={filters.tags ?? []}
            onToggle={(id) => onChange({ tags: toggleValue(filters.tags, id) })}
          />

          {/* Date and Amount are ranges, not facet lists. */}
          <FilterSection
            title={t("filters.date")}
            defaultOpen={false}
            activeCount={filters.dateFrom || filters.dateTo ? 1 : 0}
          >
            <View style={styles.rangeRow}>
              <TypedFilterInput<string>
                label={t("filters.dateFrom")}
                value={filters.dateFrom}
                format={(value) => value}
                parse={parseFilterDate}
                onCommit={(dateFrom) => onChange({ dateFrom })}
                placeholder={t("filters.datePlaceholder")}
                keyboardType="numbers-and-punctuation"
                invalidHint={t("filters.dateInvalid")}
              />
              <TypedFilterInput<string>
                label={t("filters.dateTo")}
                value={filters.dateTo}
                format={(value) => value}
                parse={parseFilterDate}
                onCommit={(dateTo) => onChange({ dateTo })}
                placeholder={t("filters.datePlaceholder")}
                keyboardType="numbers-and-punctuation"
                invalidHint={t("filters.dateInvalid")}
              />
            </View>
          </FilterSection>

          <FilterSection
            title={t("filters.amount")}
            defaultOpen={false}
            activeCount={filters.amountMin != null || filters.amountMax != null ? 1 : 0}
          >
            <View style={styles.rangeRow}>
              <TypedFilterInput<number>
                label={t("filters.min")}
                value={filters.amountMin}
                format={String}
                parse={parseFilterAmount}
                onCommit={(amountMin) => onChange({ amountMin })}
                placeholder={t("filters.min")}
                keyboardType="decimal-pad"
              />
              <TypedFilterInput<number>
                label={t("filters.max")}
                value={filters.amountMax}
                format={String}
                parse={parseFilterAmount}
                onCommit={(amountMax) => onChange({ amountMax })}
                placeholder={t("filters.max")}
                keyboardType="decimal-pad"
              />
            </View>
          </FilterSection>
        </View>
      )}
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((c) => ({
  intro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  description: {
    ...text.body,
    flex: 1,
    color: c.muted,
  },
  clear: {
    ...text.metaStrong,
    color: c.accent,
  },
  footerSlot: {
    flex: 1,
  },
  section: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  sectionTitle: {
    ...text.bodyStrong,
    flex: 1,
    color: c.ink,
  },
  sectionBody: {
    paddingBottom: 10,
  },
  longList: {
    maxHeight: 264,
  },
  facetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 4,
    borderRadius: radii.md,
  },
  facetRowPressed: {
    backgroundColor: c.bar,
  },
  facetLabel: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  facetCount: {
    ...text.numeric,
    color: c.muted,
  },
  input: {
    ...text.body,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
    color: c.ink,
  },
  inputInvalid: {
    borderColor: c.red,
  },
  hint: {
    ...text.meta,
    paddingVertical: 8,
    color: c.muted,
  },
  rangeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  typedField: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  typedLabel: {
    ...text.small,
    ...tabular,
    color: c.muted,
  },
  invalidHint: {
    ...text.small,
    color: c.red,
  },
  errorRow: {
    gap: 8,
    paddingBottom: 12,
  },
  errorText: {
    ...text.meta,
    color: c.red,
  },
  skeleton: {
    gap: 16,
    paddingVertical: 8,
  },
  skeletonGroup: {
    gap: 10,
  },
  skeletonHead: {
    width: 96,
    height: 16,
  },
  skeletonLine: {
    height: 16,
  },
}));
