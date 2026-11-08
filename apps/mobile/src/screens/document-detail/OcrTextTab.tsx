import { useMemo } from "react";
import { Text, View } from "react-native";
import type { useQuery } from "@tanstack/react-query";
import { EmptyState, ErrorCard } from "../../components/ui";
import { useI18n } from "../../i18n";
import { cardShadow, createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import type { DocumentTextResponse } from "../../lib";
import { SkeletonLines } from "./parts";

/** The recognised text, page by page, on the same paper as the viewer. */
export function OcrTextTab({
  textQuery,
}: {
  textQuery: ReturnType<typeof useQuery<DocumentTextResponse>>;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  const pages = useMemo(() => {
    const groups = new Map<number, string[]>();
    for (const block of textQuery.data?.blocks ?? []) {
      groups.set(block.page, [...(groups.get(block.page) ?? []), block.text]);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => left - right)
      .map(([page, lines]) => ({ page, text: lines.join("\n") }));
  }, [textQuery.data]);

  if (textQuery.isLoading) {
    return (
      <View style={styles.tab}>
        <SkeletonLines widths={["92%", "88%", "94%", "60%", "80%"]} />
      </View>
    );
  }
  if (textQuery.isError) {
    return (
      <View style={styles.tab}>
        <ErrorCard
          message={t("documentDetail.loadDocumentTextFailed")}
          onRetry={() => void textQuery.refetch()}
        />
      </View>
    );
  }
  if (pages.length === 0) {
    return (
      <View style={styles.tab}>
        <EmptyState icon="text-recognition" title={t("documentDetail.noOcr")} />
      </View>
    );
  }

  return (
    <View style={styles.tab}>
      {pages.map(({ page, text: pageText }) => (
        <View key={page} style={styles.page}>
          <Text style={styles.pageLabel}>{`${t("documentDetail.pageWord")} ${page}`}</Text>
          <View style={styles.paper}>
            <Text style={styles.paperText} selectable>
              {pageText}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  tab: {
    flexGrow: 1,
    gap: 16,
    padding: 16,
    backgroundColor: c.sunken,
  },
  page: {
    gap: 6,
  },
  pageLabel: {
    ...text.numericStrong,
    color: c.muted,
  },
  paper: {
    borderWidth: 1,
    borderColor: c.paperBorder,
    borderRadius: radii.sm,
    backgroundColor: c.paper,
    padding: 16,
    ...cardShadow(c),
  },
  paperText: {
    ...text.body,
    lineHeight: 22,
    color: c.paperInk,
  },
}));
