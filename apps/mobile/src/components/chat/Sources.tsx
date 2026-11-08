import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { AnswerCitation } from "../../lib";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import { groupCitationsByDocument } from "./conversations";

/** The citations under an answer, as a collapsible trace line of outline buttons. */
export function Sources({
  citations,
  label,
  defaultOpen = false,
  pageLabel,
  onSelect,
  isReachable,
  unreachableNote,
}: {
  citations: AnswerCitation[];
  label: string;
  defaultOpen?: boolean;
  pageLabel: string;
  onSelect: (citation: AnswerCitation) => void;
  /** Offline: whether the local copy has the document. */
  isReachable?: (documentId: string) => boolean;
  unreachableNote?: string;
}) {
  const styles = useStyles();
  const colors = useColors();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={label}
        onPress={() => setOpen((current) => !current)}
        hitSlop={{ top: 6, bottom: 6 }}
        style={styles.trigger}
      >
        <MaterialCommunityIcons name="file-document-outline" size={15} color={colors.muted} />
        <Text style={styles.triggerText}>{label}</Text>
        <MaterialCommunityIcons
          name={open ? "chevron-down" : "chevron-right"}
          size={16}
          color={colors.muted}
        />
      </Pressable>
      {open ? (
        <View style={styles.content}>
          {groupCitationsByDocument(citations).map((group) => {
            const first = group[0]!;
            const pages = [
              ...new Set(
                group
                  .map((citation) => citation.pageFrom)
                  .filter((page): page is number => page != null),
              ),
            ];
            const unreachable = isReachable ? !isReachable(first.documentId) : false;
            return (
              <Pressable
                key={`${first.documentId}-${first.index ?? 0}`}
                accessibilityRole="button"
                accessibilityLabel={first.documentTitle}
                onPress={() => onSelect(first)}
                style={({ pressed }) => [
                  styles.source,
                  unreachable ? styles.sourceMuted : null,
                  pressed ? styles.sourcePressed : null,
                ]}
              >
                <View style={styles.badges}>
                  {group.map((citation, index) => (
                    <View key={citation.index ?? index} style={styles.badge}>
                      <Text style={styles.badgeText}>{citation.index ?? index + 1}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.sourceTitle} numberOfLines={1}>
                  {first.documentTitle}
                </Text>
                {pages.length > 0 ? (
                  <Text style={styles.sourcePage}>{`${pageLabel}${pages.join(",")}`}</Text>
                ) : null}
                {unreachable && unreachableNote ? (
                  <Text style={styles.sourcePage} numberOfLines={1}>
                    {unreachableNote}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    minHeight: 32,
  },
  triggerText: {
    ...text.body,
    color: c.muted,
  },
  content: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
    marginLeft: 7,
    paddingLeft: 14,
    borderLeftWidth: 1,
    borderLeftColor: c.border,
  },
  source: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
    minHeight: 44,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    backgroundColor: c.app,
  },
  sourceMuted: {
    opacity: 0.6,
  },
  sourcePressed: {
    backgroundColor: c.bar,
  },
  badges: {
    flexDirection: "row",
    gap: 2,
    flexShrink: 0,
  },
  badge: {
    minWidth: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  badgeText: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
    color: c.accentSoftInk,
  },
  sourceTitle: {
    ...text.body,
    flexShrink: 1,
    color: c.ink,
  },
  sourcePage: {
    ...text.numeric,
    flexShrink: 0,
    color: c.muted,
  },
}));
