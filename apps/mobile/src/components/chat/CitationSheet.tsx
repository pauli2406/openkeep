import { Text, View } from "react-native";
import type { AnswerCitation } from "../../lib";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import { BottomSheet } from "../layout";
import { Button } from "../ui";
import { useCopied } from "./parts";

/** The passage a marker points at: the quote, a copy, and the way to the document. */
export function CitationSheet({
  citation,
  onClose,
  onFind,
  reachable,
}: {
  citation: AnswerCitation | null;
  onClose: () => void;
  onFind: (citation: AnswerCitation) => void;
  /** Offline: the local copy has this document. */
  reachable: boolean;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const { copied, copy } = useCopied(citation?.quote ?? "");

  const pages = citation?.pageFrom
    ? `${t("chat.pageAbbrev")} ${citation.pageFrom}${
        citation.pageTo && citation.pageTo !== citation.pageFrom ? `–${citation.pageTo}` : ""
      }`
    : null;

  return (
    <BottomSheet
      visible={citation !== null}
      onClose={onClose}
      title={t("chat.citedPassage")}
      footer={
        citation ? (
          <>
            <View style={styles.action}>
              <Button
                label={t("chat.findInDocument")}
                icon="file-search-outline"
                disabled={!reachable}
                onPress={() => onFind(citation)}
              />
            </View>
            <Button
              label={copied ? t("chat.copied") : t("chat.copyQuote")}
              icon={copied ? "check" : "content-copy"}
              variant="secondary"
              onPress={copy}
            />
          </>
        ) : null
      }
    >
      {citation ? (
        <>
          <View style={styles.document}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{citation.index ?? 1}</Text>
            </View>
            <Text style={styles.title} numberOfLines={2}>
              {citation.documentTitle}
            </Text>
            {pages ? <Text style={styles.pages}>{pages}</Text> : null}
          </View>
          <View style={styles.quote}>
            <Text style={styles.quoteText} selectable>
              {`„${citation.quote}“`}
            </Text>
          </View>
          {reachable ? null : <Text style={styles.note}>{t("chat.notCached")}</Text>}
        </>
      ) : null}
    </BottomSheet>
  );
}

const useStyles = createThemedStyles((c) => ({
  document: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  badge: {
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    backgroundColor: c.accentSoft,
  },
  badgeText: {
    ...text.numericStrong,
    color: c.accentSoftInk,
  },
  title: {
    ...text.rowTitle,
    flex: 1,
    color: c.ink,
  },
  pages: {
    ...text.numeric,
    color: c.muted,
  },
  quote: {
    borderRadius: radii.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: c.highlight,
  },
  quoteText: {
    ...text.body,
    color: c.highlightInk,
  },
  note: {
    ...text.small,
    color: c.muted,
  },
  action: {
    flex: 1,
  },
}));
