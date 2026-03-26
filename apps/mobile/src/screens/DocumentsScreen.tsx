import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { Card, EmptyState, ErrorCard, Field, Pill, Screen, SectionTitle } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { colors } from "../theme";
import { formatCurrency, formatDate, titleForDocument, type SearchDocumentsResponse } from "../lib";

const statuses = ["all", "pending", "processing", "ready", "failed"] as const;

export function DocumentsScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
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
    queryKey: ["documents", auth.apiUrl, params, offline.shouldUseOffline, offline.summary?.lastSyncedAt],
    queryFn: async () => {
      if (offline.shouldUseOffline) {
        return offline.loadDocuments({ query, status });
      }

        const response = await auth.authFetch(`/api/documents?${params}`);
        if (!response.ok) {
        throw new Error(t("documents.loadError"));
        }
        return (await response.json()) as SearchDocumentsResponse;
    },
    refetchInterval: offline.shouldUseOffline
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  return (
    <Screen title={t("documents.title")} subtitle={t("documents.subtitle")}>
      <Card>
        <Field label={t("documents.query")} value={query} onChangeText={setQuery} placeholder={t("documents.placeholder")} />
        {offline.shouldUseOffline ? <Text style={styles.helper}>{t("documents.offlineBrowsing")}</Text> : null}
        <SectionTitle title={t("documents.status")} hint={t("documents.statusHint")} />
        <View style={styles.filterRow}>
          {statuses.map((value) => (
            <Pressable key={value} onPress={() => setStatus(value)} style={[styles.filterChip, status === value ? styles.filterChipActive : null]}>
               <Text style={[styles.filterText, status === value ? styles.filterTextActive : null]}>{statusFilterLabel(value)}</Text>
              </Pressable>
            ))}
          </View>
      </Card>

      {documentsQuery.isLoading ? <Card><Text style={styles.helper}>{t("documents.loading")}</Text></Card> : null}
      {documentsQuery.isError ? <ErrorCard message={t("documents.loadError")} onRetry={() => documentsQuery.refetch()} /> : null}

      {documentsQuery.data ? (
        <>
          <SectionTitle title={`${documentsQuery.data.total} ${t("documents.results")}`} hint={t("documents.resultsHint")} />
          {documentsQuery.data.items.length === 0 ? (
            <EmptyState title={t("documents.noneTitle")} body={t("documents.noneBody")} />
          ) : (
            documentsQuery.data.items.map((document) => (
              <Pressable
                key={document.id}
                onPress={() => navigation.navigate("DocumentDetail", { documentId: document.id, title: titleForDocument(document) })}
                style={({ pressed }) => [pressed ? styles.pressed : null]}
              >
                <Card>
                  <View style={styles.titleRow}>
                    <Text style={styles.title}>{titleForDocument(document)}</Text>
                    <Pill label={statusPillLabel(document.status)} tone={document.status === "ready" ? "success" : document.status === "failed" ? "danger" : "warning"} />
                  </View>
                  <DocumentProcessingIndicator document={document} />
                  <Text style={styles.helper}>{document.correspondent?.name ?? t("documents.unfiled")} • {document.documentType?.name ?? t("documents.document")}</Text>
                  <Text style={styles.detailLine}>{`${t("documents.created")} ${formatDate(document.createdAt)}`}</Text>
                  <Text style={styles.detailLine}>{formatCurrency(document.amount, document.currency ?? "EUR")}</Text>
                  {document.reviewStatus === "pending" ? <Pill label={t("documents.needsReview")} tone="warning" /> : null}
                </Card>
              </Pressable>
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    color: colors.text,
    fontWeight: "700",
  },
  filterTextActive: {
    color: "#fff",
  },
  helper: {
    color: colors.muted,
  },
  titleRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  detailLine: {
    color: colors.text,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.92,
  },
});
