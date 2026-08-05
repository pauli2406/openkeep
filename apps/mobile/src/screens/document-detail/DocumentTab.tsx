import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { DocumentViewer } from "../../components/DocumentViewer";
import { useI18n } from "../../i18n";
import { useOfflineArchive } from "../../offline-archive";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import { formatCurrency, formatDate, type ArchiveDocument } from "../../lib";
import { isOverdue } from "./shared";

/**
 * The tab a document opens on: the three facts you opened it for, then the page
 * itself at 356pt on a sunken surface — not a 150pt thumbnail. (#114)
 */
export function DocumentTab({
  document,
  authFetch,
  localFileUri,
  hasLocalFile,
  offlineMode,
  textBlocks,
}: {
  document: ArchiveDocument;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  localFileUri?: string | null;
  hasLocalFile: boolean;
  offlineMode: boolean;
  textBlocks?: Array<{ page: number; text: string }>;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const { ensureCachedFile, isConnected } = useOfflineArchive();
  const [page, setPage] = useState(1);

  const persistOnlineFile = useCallback(
    () => ensureCachedFile(authFetch, document),
    [authFetch, document, ensureCachedFile],
  );

  const pageCount = document.metadata?.pageCount ?? 1;
  const overdue = isOverdue(document);

  const facts = [
    {
      key: "amount",
      label: t("documentDetail.fact.amount"),
      value: formatCurrency(document.amount, document.currency ?? "EUR"),
      tone: "ink" as const,
    },
    {
      key: "due",
      label: t("documentDetail.fact.due"),
      value: document.dueDate ? formatDate(document.dueDate) : "-",
      tone: overdue ? ("red" as const) : ("ink" as const),
    },
    {
      key: "issued",
      label: t("documentDetail.fact.issued"),
      value: document.issueDate ? formatDate(document.issueDate) : "-",
      tone: "ink" as const,
    },
  ];

  return (
    <>
      <View style={styles.factStrip}>
        {facts.map((fact, index) => (
          <View
            key={fact.key}
            style={[styles.factCell, index < facts.length - 1 ? styles.factCellDivided : null]}
          >
            <Text style={styles.factLabel} numberOfLines={1}>
              {fact.label}
            </Text>
            <Text
              style={[styles.factValue, fact.tone === "red" ? styles.factValueRed : null]}
              numberOfLines={1}
            >
              {fact.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.pageStage}>
        <DocumentViewer
          authFetch={authFetch}
          documentId={document.id}
          mimeType={document.mimeType}
          searchablePdfAvailable={document.searchablePdfAvailable}
          localFileUri={localFileUri}
          hasLocalFile={hasLocalFile}
          offlineMode={offlineMode}
          canFetchOnline={!offlineMode || isConnected}
          onPersistOnlineFile={persistOnlineFile}
          textBlocks={textBlocks}
        />
      </View>

      <View style={styles.pageBar}>
        <Pressable
          onPress={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page <= 1}
          hitSlop={10}
          style={styles.pageButton}
        >
          <MaterialCommunityIcons
            name="chevron-left"
            size={16}
            color={page > 1 ? colors.accent : colors.faint}
          />
        </Pressable>
        <Text style={styles.pageText}>
          {`${t("documentDetail.activity.page")} ${page} / ${pageCount}`}
        </Text>
        <Pressable
          onPress={() => setPage((current) => Math.min(pageCount, current + 1))}
          disabled={page >= pageCount}
          hitSlop={10}
          style={styles.pageButton}
        >
          <MaterialCommunityIcons
            name="chevron-right"
            size={16}
            color={page < pageCount ? colors.accent : colors.faint}
          />
        </Pressable>
        <Text style={styles.pageKind}>
          {document.searchablePdfAvailable
            ? `${document.mimeType.split("/").pop()?.toUpperCase()} · ${t("documentDetail.searchablePdf")}`
            : (document.mimeType.split("/").pop()?.toUpperCase() ?? "")}
        </Text>
      </View>
    </>
  );
}

const useStyles = createThemedStyles((c) => ({
  factStrip: {
    flexDirection: "row",
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  factCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 2,
  },
  factCellDivided: {
    borderRightWidth: 1,
    borderRightColor: c.borderSoft,
  },
  factLabel: {
    ...text.small,
    fontSize: 10.5,
    lineHeight: 14,
    color: c.faint,
  },
  factValue: {
    ...text.amount,
    color: c.ink,
  },
  factValueRed: {
    color: c.red,
  },
  pageStage: {
    minHeight: 356,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    backgroundColor: c.sunken,
  },
  pageBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  pageButton: {
    height: 30,
    width: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  pageText: {
    ...text.numeric,
    fontSize: 11.5,
    lineHeight: 16,
    color: c.dim,
  },
  pageKind: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    marginLeft: "auto",
    color: c.faint,
  },
}));
