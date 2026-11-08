import { Pressable, Text, View } from "react-native";
import { formatShortDate } from "../../lib";
import { createThemedStyles, cardShadow, radii } from "../../theme";
import { text } from "../../typography";
import type { StructuredRow } from "./conversations";

/** A structured result as a card with one row per item. */
export function StructuredCard({
  title,
  total,
  rows,
  onOpen,
  isReachable,
}: {
  title: string;
  total?: string | null;
  rows: StructuredRow[];
  onOpen: (documentId: string, title: string) => void;
  /** Offline: a row whose document the copy has not got does not open. */
  isReachable: (documentId: string) => boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerLabel} numberOfLines={1}>
          {title}
        </Text>
        {total ? <Text style={styles.headerTotal}>{total}</Text> : null}
      </View>
      {rows.map((row, index) => {
        const documentId = row.documentId && isReachable(row.documentId) ? row.documentId : null;
        const body = (
          <>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {row.title}
              </Text>
              {row.date ? (
                <Text style={[styles.rowDate, row.overdue ? styles.overdue : null]}>
                  {formatShortDate(row.date)}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.rowAmount, row.overdue ? styles.overdue : null]} numberOfLines={1}>
              {row.amount ?? "—"}
            </Text>
          </>
        );
        const ruled = index < rows.length - 1 ? styles.rule : null;
        return documentId ? (
          <Pressable
            key={`${row.title}-${index}`}
            accessibilityRole="button"
            onPress={() => onOpen(documentId, row.title)}
            style={({ pressed }) => [styles.row, ruled, pressed ? styles.rowPressed : null]}
          >
            {body}
          </Pressable>
        ) : (
          <View key={`${row.title}-${index}`} style={[styles.row, ruled]}>
            {body}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  card: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
    ...cardShadow(c),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    backgroundColor: c.bar,
  },
  headerLabel: {
    ...text.sectionLabel,
    flex: 1,
    color: c.muted,
  },
  headerTotal: {
    ...text.numericStrong,
    color: c.ink,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  rule: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  rowPressed: {
    backgroundColor: c.bar,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...text.rowTitle,
    color: c.ink,
  },
  rowDate: {
    ...text.numeric,
    color: c.muted,
  },
  rowAmount: {
    ...text.amount,
    flexShrink: 0,
    color: c.ink,
  },
  overdue: {
    color: c.red,
  },
}));
