import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { Panel, EmptyState, ErrorCard, Field, Pill, Screen, SectionHeader } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles } from "../theme";
import { fonts } from "../typography";
import { formatCurrency, formatDate, titleForDocument, type SearchDocumentsResponse } from "../lib";

const statuses = ["all", "pending", "processing", "ready", "failed"] as const;

export function DocumentsScreen() {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");

  function statusFilterLabel(value: (typeof statuses)[number]) {
    switch (value) {
      case "all":
        return t("documents.filter.all");
      case "pending":
        return t("documents.filter.pending");
      case "processing":
        return t("documents.filter.processing");
      case "ready":
        return t("documents.filter.ready");
      case "failed":
        return t("documents.filter.failed");
    }
  }

  function statusPillLabel(value: string) {
    switch (value) {
      case "pending":
        return t("documents.docStatus.pending");
      case "processing":
        return t("documents.docStatus.processing");
      case "ready":
        return t("documents.docStatus.ready");
      case "failed":
        return t("documents.docStatus.failed");
      default:
        return value;
    }
  }

  const params = useMemo(() => {
    const search = new URLSearchParams();
    search.set("page", "1");
    search.set("pageSize", "30");
    if (query.trim()) {
      search.set("query", query.trim());
    }
    if (status !== "all") {
      search.set("status", status);
    }
    return search.toString();
  }, [query, status]);

  const documentsQuery = useQuery({
    queryKey: ["documents", auth.apiUrl, params, shouldUseCache, offline.cacheSummary.updatedAt],
    queryFn: async () => {
      if (shouldUseCache) {
        return offline.queryCachedDocuments({ query, status });
      }

        const response = await auth.authFetch(`/api/documents?${params}`);
        if (!response.ok) {
        throw new Error(t("documents.loadError"));
        }
        return (await response.json()) as SearchDocumentsResponse;
    },
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  return (
    <Screen title={t("documents.title")}>
      <Panel padded>
        <Field label={t("documents.query")} value={query} onChangeText={setQuery} placeholder={t("documents.placeholder")} />
        <SectionHeader label={t("documents.status")} />
        <View style={styles.filterRow}>
          {statuses.map((value) => (
            <Pressable key={value} onPress={() => setStatus(value)} style={[styles.filterChip, status === value ? styles.filterChipActive : null]}>
               <Text style={[styles.filterText, status === value ? styles.filterTextActive : null]}>{statusFilterLabel(value)}</Text>
              </Pressable>
            ))}
          </View>
      </Panel>

      {documentsQuery.isLoading ? <Panel padded><Text style={styles.helper}>{t("documents.loading")}</Text></Panel> : null}
      {documentsQuery.isError ? <ErrorCard message={t("documents.loadError")} onRetry={() => documentsQuery.refetch()} /> : null}

      {documentsQuery.data ? (
        <>
          <SectionHeader label={t("documents.results")} count={documentsQuery.data.total} />
          {documentsQuery.data.items.length === 0 ? (
            <EmptyState title={t("documents.noneTitle")} body={t("documents.noneBody")} />
          ) : (
            documentsQuery.data.items.map((document) => (
              <Pressable
                key={document.id}
                onPress={() => navigation.navigate("DocumentDetail", { documentId: document.id, title: titleForDocument(document) })}
                style={({ pressed }) => [pressed ? styles.pressed : null]}
              >
                <Panel padded>
                  <View style={styles.titleRow}>
                    <Text style={styles.title}>{titleForDocument(document)}</Text>
                    <Pill label={statusPillLabel(document.status)} tone={document.status === "ready" ? "ok" : document.status === "failed" ? "bad" : "warn"} />
                  </View>
                  <DocumentProcessingIndicator document={document} />
                  <Text style={styles.helper}>{document.correspondent?.name ?? t("documents.unfiled")} • {document.documentType?.name ?? t("documents.document")}</Text>
                  <Text style={styles.detailLine}>{`${t("documents.created")} ${formatDate(document.createdAt)}`}</Text>
                  <Text style={styles.detailLine}>{formatCurrency(document.amount, document.currency ?? "EUR")}</Text>
                  {document.reviewStatus === "pending" ? <Pill label={t("documents.needsReview")} tone="warn" /> : null}
                </Panel>
              </Pressable>
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: c.raised,
  },
  filterChipActive: {
    backgroundColor: c.accentFill,
  },
  filterText: {
    color: c.ink,
    fontFamily: fonts.sans.semibold,
  },
  filterTextActive: {
    fontFamily: fonts.sans.regular,
    color: c.accentFillInk,
  },
  helper: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
  },
  titleRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  detailLine: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.92,
  },
}));
