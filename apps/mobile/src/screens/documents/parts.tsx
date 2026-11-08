import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { categoryColorIndex, formatRowDate } from "../../api/documents";
import { DocumentProcessingIndicator } from "../../components/DocumentProcessingIndicator";
import { Gradient } from "../../components/layout";
import { Pill, Row, type PillTone } from "../../components/ui";
import { documentRowState, isDocumentProcessing } from "../../document-processing";
import { useI18n } from "../../i18n";
import { formatCurrency, parseArchiveDate, titleForDocument, type ArchiveDocument } from "../../lib";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";

type Translate = ReturnType<typeof useI18n>["t"];

export function isOverdue(document: ArchiveDocument) {
  // A finished task is never overdue: the deadline queues exclude it too.
  if (!document.dueDate || document.taskCompletedAt) return false;
  const due = parseArchiveDate(document.dueDate);
  if (!due) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}

/** At most one flag per row, and failed outranks everything. */
function documentFlag(document: ArchiveDocument, t: Translate): { label: string; tone: PillTone } | null {
  if (documentRowState(document) === "failed") {
    return { label: t("documents.flagFailed"), tone: "bad" };
  }
  if (isOverdue(document)) {
    return { label: t("documents.duePill"), tone: "bad" };
  }
  if (document.reviewStatus === "pending") {
    return { label: t("documents.flagReview"), tone: "warn" };
  }
  return null;
}

/** The web's search field: a card-coloured input with a magnifier. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  onSubmit?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.search}>
      <MaterialCommunityIcons name="magnify" size={17} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={placeholder}
        style={styles.searchInput}
        autoCorrect={false}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={placeholder}
          onPress={() => onChangeText("")}
          hitSlop={12}
        >
          <MaterialCommunityIcons name="close" size={15} color={colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The colour a name always has, in lists and on cards. */
export function useCategoryColor(value: string) {
  return useColors().cat[categoryColorIndex(value)];
}

export function CategoryDot({ value }: { value: string }) {
  const styles = useStyles();
  const color = useCategoryColor(value);
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

/** A name's initial on a tint of its colour. */
export function Monogram({ name, muted = false }: { name: string; muted?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const assigned = useCategoryColor(name);
  const color = muted ? colors.muted : assigned;
  return (
    <View style={styles.monogram}>
      <View style={[StyleSheet.absoluteFill, styles.monogramTint, { backgroundColor: color }]} />
      <Text style={[styles.monogramText, { color }]}>{name.trim().charAt(0).toUpperCase() || "–"}</Text>
    </View>
  );
}

/** A square check, as the web's: `mixed` is the select-all of a partial selection. */
export function CheckMark({ state }: { state: "on" | "off" | "mixed" }) {
  const colors = useColors();
  const icon = state === "on" ? "checkbox-marked" : state === "mixed" ? "minus-box" : "checkbox-blank-outline";
  return (
    <MaterialCommunityIcons
      name={icon}
      size={22}
      color={state === "off" ? colors.borderStrong : colors.accent}
    />
  );
}

/** A slim bar that weighs one count against the largest. */
export function Meter({ share, color }: { share: number; color?: string }) {
  const styles = useStyles();
  const width = `${Math.max(Math.min(share, 1) * 100, 3)}%` as const;
  return (
    <View style={styles.meter}>
      {color ? (
        <View style={[styles.meterFill, { width, backgroundColor: color }]} />
      ) : (
        <Gradient name="action" borderRadius={radii.pill} style={[styles.meterFill, { width }]} />
      )}
    </View>
  );
}

/** One document in a list: colour dot, title, sender and date, amount and flag. */
export function DocumentRow({
  document,
  selecting = false,
  selected = false,
  onPress,
  onLongPress,
}: {
  document: ArchiveDocument;
  selecting?: boolean;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const flag = documentFlag(document, t);
  const overdue = isOverdue(document);

  return (
    <Row
      minHeight={60}
      selected={selected}
      onPress={onPress}
      onLongPress={onLongPress}
      tone={documentRowState(document) === "failed" ? "bad" : "default"}
      leading={
        selecting ? (
          <CheckMark state={selected ? "on" : "off"} />
        ) : (
          <CategoryDot value={document.correspondent?.name ?? document.status} />
        )
      }
      title={titleForDocument(document)}
      meta={`${document.correspondent?.name ?? t("documents.flagUnfiled")} · ${formatRowDate(
        document.issueDate ?? document.createdAt,
      )}`}
      trailing={
        <View style={styles.rowTrail}>
          <Text style={[styles.rowAmount, overdue ? styles.rowAmountOverdue : null]} numberOfLines={1}>
            {document.amount != null ? formatCurrency(document.amount, document.currency ?? "EUR") : "—"}
          </Text>
          {/* A badge sizes itself to its start edge; this holds it to the column's end. */}
          {isDocumentProcessing(document) ? (
            <View>
              <DocumentProcessingIndicator document={document} />
            </View>
          ) : flag ? (
            <View>
              <Pill label={flag.label} tone={flag.tone} />
            </View>
          ) : null}
        </View>
      }
    />
  );
}

/** A card's list of rows, without the last row's rule. The card must clip. */
export function CardList({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.cardList}>{children}</View>;
}

const useStyles = createThemedStyles((c) => ({
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
  },
  searchInput: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: c.ink,
  },
  dot: {
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: radii.pill,
  },
  monogram: {
    width: 32,
    height: 32,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: radii.md,
  },
  monogramTint: {
    opacity: 0.14,
  },
  monogramText: {
    ...text.bodyStrong,
  },
  meter: {
    height: 6,
    overflow: "hidden",
    borderRadius: radii.pill,
    backgroundColor: c.raised,
  },
  meterFill: {
    height: "100%",
    borderRadius: radii.pill,
  },
  rowTrail: {
    flexShrink: 0,
    maxWidth: "50%",
    alignItems: "flex-end",
    gap: 4,
  },
  rowAmount: {
    ...text.amount,
    color: c.ink,
  },
  rowAmountOverdue: {
    color: c.red,
  },
  cardList: {
    // The last row's rule would double the card's own border; the card clips it.
    marginBottom: -1,
  },
}));
