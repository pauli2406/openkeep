import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { Button, EmptyState, ErrorCard, Field, Notice, Panel, Pill, Screen, SectionHeader } from "../components/ui";
import { documentRowState, processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles } from "../theme";
import { fonts, text } from "../typography";
import {
  formatCurrency,
  formatDate,
  responseToMessage,
  titleForDocument,
  type SearchDocumentsResponse,
} from "../lib";

const statuses = ["all", "pending", "processing", "ready", "failed"] as const;

export function DocumentsScreen() {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");
  const isFiltered = status !== "all" || query.trim().length > 0;

  const reprocessMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await auth.authFetch(`/api/documents/${documentId}/reprocess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        // Reprocessing can clear a pending review, and the Review tab stays
        // mounted once visited.
        queryClient.invalidateQueries({ queryKey: ["review"] }),
      ]);
    },
  });

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
    <Screen
      title={t("documents.title")}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
    >
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
            isFiltered ? (
              <EmptyState
                title={query.trim() ? t("state.emptySearch") : t("state.emptyFiltered")}
                action={t("state.showAll")}
                onAction={() => {
                  setStatus("all");
                  setQuery("");
                }}
              />
            ) : (
              <EmptyState title={t("documents.noneTitle")} body={t("documents.noneBody")} />
            )
          ) : (
            documentsQuery.data.items.map((document) => {
              const state = documentRowState(document);
              const failed = state === "failed";
              // Nothing has been extracted yet, so there is no metadata to show
              // and nothing behind a tap on it.
              const inFlight = state === "processing" || state === "queued";

              return (
                <Pressable
                  key={document.id}
                  onPress={() => navigation.navigate("DocumentDetail", { documentId: document.id, title: titleForDocument(document) })}
                  style={({ pressed }) => [pressed ? styles.pressed : null]}
                >
                  <Panel padded style={failed ? styles.failedPanel : undefined}>
                    <View style={styles.titleRow}>
                      <Text style={styles.title}>{titleForDocument(document)}</Text>
                      <Pill label={statusPillLabel(document.status)} tone={document.status === "ready" ? "ok" : failed ? "bad" : "warn"} />
                    </View>

                    {inFlight ? (
                      <DocumentProcessingIndicator document={document} />
                    ) : failed ? (
                      <>
                        <Text style={styles.failedReason} numberOfLines={3}>
                          {document.latestProcessingJob?.lastError
                            ? `${t("state.failed")} · ${document.latestProcessingJob.lastError}`
                            : t("state.failed")}
                        </Text>
                        <Button
                          label={t("state.reprocess")}
                          variant="secondary"
                          size="sm"
                          disabled={shouldUseCache}
                          loading={reprocessMutation.isPending && reprocessMutation.variables === document.id}
                          onPress={() => reprocessMutation.mutate(document.id)}
                        />
                      </>
                    ) : (
                      <>
                        <Text style={styles.helper}>{document.correspondent?.name ?? t("documents.unfiled")} • {document.documentType?.name ?? t("documents.document")}</Text>
                        <Text style={styles.detailLine}>{`${t("documents.created")} ${formatDate(document.createdAt)}`}</Text>
                        <Text style={styles.detailLine}>{formatCurrency(document.amount, document.currency ?? "EUR")}</Text>
                        {document.reviewStatus === "pending" ? <Pill label={t("documents.needsReview")} tone="warn" /> : null}
                      </>
                    )}
                  </Panel>
                </Pressable>
              );
            })
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
  failedPanel: {
    backgroundColor: c.redSoft,
    borderColor: c.red,
  },
  failedReason: {
    ...text.meta,
    color: c.red,
  },
}));
