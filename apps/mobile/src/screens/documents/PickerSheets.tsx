import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { DocumentSort } from "../../api/documents";
import { BottomSheet, Segmented, Skeleton } from "../../components/layout";
import { Button, EmptyState } from "../../components/ui";
import { useI18n, type TranslationKey } from "../../i18n";
import type { DocumentSortField, TaxonomyOption } from "../../lib";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import { SearchField } from "./parts";

/** One choice in a picker sheet. */
function PickerRow({
  label,
  selected,
  onPress,
  trailing,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  trailing?: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected ? styles.rowSelected : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <Text style={[styles.rowLabel, selected ? styles.rowLabelSelected : null]} numberOfLines={1}>
        {label}
      </Text>
      {trailing ??
        (selected ? <MaterialCommunityIcons name="check" size={18} color={colors.accent} /> : null)}
    </Pressable>
  );
}

function PickerLoading() {
  const styles = useStyles();
  return (
    <View style={styles.loading}>
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} style={styles.loadingRow} />
      ))}
    </View>
  );
}

function PickerError({ onRetry }: { onRetry: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View style={styles.errorBlock}>
      <Text style={styles.failure}>{t("documents.pickerLoadError")}</Text>
      <Button label={t("common.retry")} variant="secondary" size="sm" onPress={onRetry} />
    </View>
  );
}

function SheetFooter({
  onCancel,
  onApply,
  applyDisabled,
  busy,
}: {
  onCancel: () => void;
  onApply: () => void;
  applyDisabled: boolean;
  busy: boolean;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <>
      <View style={styles.footerSlot}>
        <Button label={t("documents.bulkCancel")} variant="secondary" onPress={onCancel} disabled={busy} />
      </View>
      <View style={styles.footerSlot}>
        <Button label={t("documents.bulkApply")} onPress={onApply} disabled={applyDisabled} loading={busy} />
      </View>
    </>
  );
}

/** Add or remove one tag on every selected document. */
export function BulkTagSheet({
  visible,
  onClose,
  count,
  tags,
  loading,
  error,
  busy,
  failureMessage,
  onApply,
  onRetry,
}: {
  visible: boolean;
  onClose: () => void;
  count: number;
  tags: TaxonomyOption[] | undefined;
  loading: boolean;
  error: boolean;
  busy: boolean;
  failureMessage: string | null;
  onApply: (tagId: string, action: "add" | "remove") => void;
  onRetry: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const [action, setAction] = useState<"add" | "remove">("add");
  const [tagId, setTagId] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (visible) {
      setTagId("");
      setSearch("");
    }
  }, [visible]);

  const needle = search.trim().toLowerCase();
  const visibleTags = (tags ?? []).filter((tag) =>
    needle ? tag.name.toLowerCase().includes(needle) : true,
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={
        count === 1
          ? t("documents.bulkTagTitleOne")
          : t("documents.bulkTagTitle").replace("{count}", String(count))
      }
      footer={
        <SheetFooter
          onCancel={onClose}
          onApply={() => onApply(tagId, action)}
          applyDisabled={!tagId || count === 0}
          busy={busy}
        />
      }
    >
      <Text style={styles.description}>{t("documents.bulkTagDescription")}</Text>
      <Segmented
        value={action}
        onChange={setAction}
        options={[
          { value: "add", label: t("documents.bulkTagAdd") },
          { value: "remove", label: t("documents.bulkTagRemove") },
        ]}
      />
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder={t("documents.bulkPickTag")}
      />
      {loading ? (
        <PickerLoading />
      ) : error ? (
        <PickerError onRetry={onRetry} />
      ) : (tags ?? []).length === 0 ? (
        <EmptyState icon="tag-outline" title={t("documents.noTags")} />
      ) : visibleTags.length === 0 ? (
        <Text style={styles.hint}>{t("filters.noMatches")}</Text>
      ) : (
        <View accessibilityRole="radiogroup">
          {visibleTags.map((tag) => (
            <PickerRow
              key={tag.id}
              label={tag.name}
              selected={tag.id === tagId}
              onPress={() => setTagId(tag.id)}
            />
          ))}
        </View>
      )}
      {failureMessage ? <Text style={styles.failure}>{failureMessage}</Text> : null}
    </BottomSheet>
  );
}

const NO_TYPE = "";

/** Every selected document gets one document type, or none. */
export function BulkTypeSheet({
  visible,
  onClose,
  count,
  types,
  loading,
  error,
  busy,
  failureMessage,
  onApply,
  onRetry,
}: {
  visible: boolean;
  onClose: () => void;
  count: number;
  types: TaxonomyOption[] | undefined;
  loading: boolean;
  error: boolean;
  busy: boolean;
  failureMessage: string | null;
  onApply: (documentTypeId: string | null) => void;
  onRetry: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const [typeId, setTypeId] = useState(NO_TYPE);

  useEffect(() => {
    if (visible) setTypeId(NO_TYPE);
  }, [visible]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={
        count === 1
          ? t("documents.bulkTypeTitleOne")
          : t("documents.bulkTypeTitle").replace("{count}", String(count))
      }
      footer={
        <SheetFooter
          onCancel={onClose}
          onApply={() => onApply(typeId === NO_TYPE ? null : typeId)}
          applyDisabled={count === 0}
          busy={busy}
        />
      }
    >
      <Text style={styles.description}>{t("documents.bulkTypeDescription")}</Text>
      {loading ? (
        <PickerLoading />
      ) : error ? (
        <PickerError onRetry={onRetry} />
      ) : (
        <View accessibilityRole="radiogroup">
          <PickerRow
            label={t("documents.bulkTypeNone")}
            selected={typeId === NO_TYPE}
            onPress={() => setTypeId(NO_TYPE)}
          />
          {(types ?? []).map((type) => (
            <PickerRow
              key={type.id}
              label={type.name}
              selected={type.id === typeId}
              onPress={() => setTypeId(type.id)}
            />
          ))}
        </View>
      )}
      {failureMessage ? <Text style={styles.failure}>{failureMessage}</Text> : null}
    </BottomSheet>
  );
}

export const SORT_LABELS: Record<DocumentSortField, TranslationKey> = {
  title: "explorer.sortTitle",
  issueDate: "explorer.sortIssueDate",
  createdAt: "explorer.sortCreated",
  dueDate: "explorer.sortDueDate",
};

/** The fields the API sorts by. The active one flips direction when tapped again. */
export function SortSheet({
  visible,
  onClose,
  sort,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  sort: DocumentSort;
  onChange: (sort: DocumentSort) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const fields: DocumentSortField[] = ["createdAt", "issueDate", "dueDate", "title"];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={t("explorer.sortBy")}>
      <Text style={styles.description}>{t("explorer.sortHint")}</Text>
      <View accessibilityRole="radiogroup">
        {fields.map((field) => {
          const active = sort.field === field;
          const label = t(SORT_LABELS[field]);
          return (
            <PickerRow
              key={field}
              label={
                active
                  ? `${label}, ${t(sort.direction === "desc" ? "explorer.sortDesc" : "explorer.sortAsc")}`
                  : label
              }
              selected={active}
              onPress={() =>
                onChange({
                  field,
                  direction: active && sort.direction === "desc" ? "asc" : "desc",
                })
              }
              trailing={
                active ? (
                  <MaterialCommunityIcons
                    name={sort.direction === "desc" ? "arrow-down" : "arrow-up"}
                    size={18}
                    color={colors.accent}
                  />
                ) : null
              }
            />
          );
        })}
      </View>
    </BottomSheet>
  );
}

/** One-of-many taxonomy sheet applied on tap: the dossier's category. */
export function CategorySheet({
  visible,
  onClose,
  title,
  noneLabel,
  categories,
  loading,
  error,
  selectedId,
  busy,
  onSelect,
  onRetry,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  noneLabel: string;
  categories: TaxonomyOption[] | undefined;
  loading: boolean;
  error: boolean;
  selectedId: string | null;
  busy: boolean;
  onSelect: (categoryId: string | null) => void;
  onRetry: () => void;
}) {
  const colors = useColors();
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {loading ? (
        <PickerLoading />
      ) : error ? (
        <PickerError onRetry={onRetry} />
      ) : (
        <View accessibilityRole="radiogroup">
          <PickerRow
            label={noneLabel}
            selected={selectedId === null}
            onPress={() => onSelect(null)}
          />
          {(categories ?? []).map((category) => (
            <PickerRow
              key={category.id}
              label={category.name}
              selected={category.id === selectedId}
              onPress={() => onSelect(category.id)}
              trailing={
                busy && category.id === selectedId ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : undefined
              }
            />
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((c) => ({
  description: {
    ...text.body,
    color: c.muted,
  },
  hint: {
    ...text.meta,
    color: c.muted,
  },
  failure: {
    ...text.meta,
    color: c.red,
  },
  errorBlock: {
    gap: 8,
  },
  footerSlot: {
    flex: 1,
  },
  loading: {
    gap: 10,
  },
  loadingRow: {
    height: 40,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radii.md,
  },
  rowSelected: {
    backgroundColor: c.accentSoft,
  },
  rowPressed: {
    backgroundColor: c.bar,
  },
  rowLabel: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  rowLabelSelected: {
    fontFamily: text.bodyStrong.fontFamily,
    color: c.accentSoftInk,
  },
}));
