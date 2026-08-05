import * as Sharing from "expo-sharing";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth";
import { Button, ErrorCard, Notice, Panel, Row } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import { useDocumentQa } from "../hooks/useDocumentQa";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import {
  fetchTaxonomy,
  responseToMessage,
  saveDownloadToFile,
  taxonomyQueryKey,
  titleForDocument,
  type ArchiveDocument,
  type DocumentHistoryResponse,
  type DocumentTextResponse,
  type QaHistoryEntry,
} from "../lib";
import { AskComposer, AskTab } from "./document-detail/AskTab";
import { DetailBanners } from "./document-detail/DetailBanners";
import { DetailBar, DetailTabs } from "./document-detail/DetailBar";
import { DetailsTab } from "./document-detail/DetailsTab";
import { DocumentTab } from "./document-detail/DocumentTab";
import { HistoryTab } from "./document-detail/HistoryTab";
import type { TabKey } from "./document-detail/shared";

const TAXONOMY_KINDS = ["correspondents", "document-types", "tags"] as const;

/**
 * The route. Queries, the app bar, the tab bar, the two banners and the pinned
 * action bar live here; each tab is its own module under `document-detail/`.
 * (#114 — this file was 69 KB.)
 */
export function DocumentDetailScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const queryClient = useQueryClient();
  const route = useRoute<RouteProp<AppStackParamList, "DocumentDetail">>();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const documentId = route.params.documentId;
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const cacheOpenedDocument = offline.cacheOpenedDocument;
  // Only queries that actually read the offline cache should re-key when it changes. Online
  // queries fetch from the network, so a cache refresh must not discard their entry — that would
  // unmount the metadata form mid-edit.
  const cacheRevision = shouldUseCache ? offline.cacheSummary.updatedAt : null;

  const [activeTab, setActiveTab] = useState<TabKey>("document");
  const [menuOpen, setMenuOpen] = useState(false);

  const qa = useDocumentQa(auth.streamFetch, documentId);

  const cachedRecordQuery = useQuery({
    queryKey: [
      "cached-document-record",
      documentId,
      shouldUseCache,
      offline.cacheSummary.updatedAt,
    ],
    queryFn: async () => {
      const record = await offline.loadCachedDocument(documentId);
      if (!record && shouldUseCache) {
        throw new Error(t("documentDetail.offlineNotCached"));
      }
      return record ?? null;
    },
  });

  const documentQuery = useQuery({
    queryKey: ["document", documentId, shouldUseCache, cacheRevision],
    queryFn: async () => {
      if (shouldUseCache) {
        const record = await offline.loadCachedDocument(documentId);
        if (!record) throw new Error(t("documentDetail.loadOfflineFailed"));
        return record.document;
      }

      const response = await auth.authFetch(`/api/documents/${documentId}`);
      if (!response.ok) throw new Error(t("documentDetail.loadDetailFailed"));
      return (await response.json()) as ArchiveDocument;
    },
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data),
  });

  const textQuery = useQuery({
    queryKey: ["document-text", documentId, shouldUseCache, cacheRevision],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      if (shouldUseCache) {
        const record = cachedRecordQuery.data ?? (await offline.loadCachedDocument(documentId));
        return record?.text ?? { documentId, blocks: [] };
      }

      const response = await auth.authFetch(`/api/documents/${documentId}/text`);
      if (!response.ok) throw new Error(t("documentDetail.loadOcrFailed"));
      return (await response.json()) as DocumentTextResponse;
    },
    refetchInterval: shouldUseCache
      ? false
      : () => processingRefetchInterval(documentQuery.data, (data) => data),
  });

  const historyQuery = useQuery({
    queryKey: ["document-history", documentId, shouldUseCache, cacheRevision],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      if (shouldUseCache) {
        const record = cachedRecordQuery.data ?? (await offline.loadCachedDocument(documentId));
        return record?.history ?? { documentId, items: [] };
      }

      const response = await auth.authFetch(`/api/documents/${documentId}/history`);
      if (!response.ok) throw new Error(t("documentDetail.loadHistoryFailed"));
      return (await response.json()) as DocumentHistoryResponse;
    },
    refetchInterval: shouldUseCache
      ? false
      : () => processingRefetchInterval(documentQuery.data, (data) => data),
  });

  // The pickers must offer every taxonomy entry, including ones not yet used by any document.
  // `/api/documents/facets` aggregates over documents and would hide freshly created entries.
  const taxonomyQueries = useQueries({
    queries: TAXONOMY_KINDS.map((kind) => ({
      queryKey: taxonomyQueryKey(auth.apiUrl, kind),
      enabled: documentQuery.isSuccess && !shouldUseCache,
      queryFn: () => fetchTaxonomy(auth.authFetch, kind, t("documentDetail.loadTaxonomiesFailed")),
    })),
  });
  const [correspondentsResult, documentTypesResult, tagsResult] = taxonomyQueries;
  const taxonomies = useMemo(() => {
    if (!correspondentsResult.data || !documentTypesResult.data || !tagsResult.data) {
      return null;
    }
    return {
      correspondents: correspondentsResult.data,
      documentTypes: documentTypesResult.data,
      tags: tagsResult.data,
    };
  }, [correspondentsResult.data, documentTypesResult.data, tagsResult.data]);

  const qaHistoryQuery = useQuery({
    queryKey: ["document-qa-history", documentId, shouldUseCache],
    enabled: documentQuery.isSuccess && activeTab === "questions" && !shouldUseCache,
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}/qa-history`);
      if (!response.ok) throw new Error(t("documentDetail.loadQaHistoryFailed"));
      return (await response.json()) as QaHistoryEntry[];
    },
  });

  useEffect(() => {
    if (shouldUseCache) {
      return;
    }
    void cacheOpenedDocument(auth.authFetch, documentId)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ["cached-document-record", documentId] });
      })
      .catch(() => {
        // Online document viewing should not fail because the local cache could not be refreshed.
      });
  }, [auth.authFetch, cacheOpenedDocument, documentId, queryClient, shouldUseCache]);

  const invalidateAll = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["document-facets"] }),
    ]);
  }, [documentId, queryClient]);

  const actionMutation = useMutation({
    mutationFn: async ({
      path,
      body,
    }: {
      path: string;
      body?: object;
    }) => {
      const response = await auth.authFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) throw new Error(await responseToMessage(response));
    },
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseToMessage(response));
    },
    onSuccess: async () => {
      await invalidateAll();
      navigation.goBack();
    },
  });

  const shareOriginal = useCallback(async () => {
    const response = await auth.authFetch(`/api/documents/${documentId}/download`);
    if (!response.ok) throw new Error(await responseToMessage(response));
    const file = await saveDownloadToFile(response, `openkeep-${documentId}`);
    await Sharing.shareAsync(file);
  }, [auth, documentId]);

  function confirmDelete() {
    setMenuOpen(false);
    Alert.alert(t("documentDetail.overview.deleteTitle"), t("documentDetail.overview.deleteBody"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("documentDetail.overview.deleteDocument"),
        style: "destructive",
        onPress: () => deleteMutation.mutate(),
      },
    ]);
  }

  const document = documentQuery.data;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <DetailBar
        document={document}
        offlineReadOnly={shouldUseCache}
        onBack={() => navigation.goBack()}
        onShare={() => void shareOriginal()}
        onMenu={() => setMenuOpen(true)}
      />

      {shouldUseCache ? <Notice label={t("state.offlineReadOnly")} /> : null}

      <DetailTabs activeTab={activeTab} onChange={setActiveTab} />

      <ScrollView contentContainerStyle={styles.body}>
        {documentQuery.isLoading ? (
          <View style={styles.gutter}>
            <Panel padded>
              <Text style={styles.hint}>{t("documentDetail.loadingDetail")}</Text>
            </Panel>
          </View>
        ) : null}

        {documentQuery.isError || !document ? (
          documentQuery.isLoading ? null : (
            <View style={styles.gutter}>
              <ErrorCard
                message={t("documentDetail.loadError")}
                onRetry={() => documentQuery.refetch()}
              />
            </View>
          )
        ) : (
          <>
            <DetailBanners
              document={document}
              offlineReadOnly={shouldUseCache}
              busy={actionMutation.isPending}
              onResolve={() =>
                actionMutation.mutate({ path: `/api/documents/${documentId}/review/resolve` })
              }
              onRequeue={() =>
                actionMutation.mutate({
                  path: `/api/documents/${documentId}/review/requeue`,
                  body: { force: true },
                })
              }
            />

            {activeTab === "document" ? (
              <DocumentTab
                document={document}
                authFetch={auth.authFetch}
                localFileUri={cachedRecordQuery.data?.fileUri ?? null}
                hasLocalFile={Boolean(cachedRecordQuery.data?.fileUri)}
                offlineMode={shouldUseCache}
                textBlocks={textQuery.data?.blocks}
              />
            ) : null}

            {activeTab === "details" ? (
              <DetailsTab
                document={document}
                documentId={documentId}
                apiUrl={auth.apiUrl}
                authFetch={auth.authFetch}
                queryClient={queryClient}
                taxonomies={taxonomies}
                offlineReadOnly={shouldUseCache}
              />
            ) : null}

            {activeTab === "questions" ? (
              <AskTab
                documentId={documentId}
                streamFetch={auth.streamFetch}
                qaHistory={qaHistoryQuery.data ?? []}
                refetchQaHistory={() => qaHistoryQuery.refetch()}
                offlineMode={shouldUseCache}
                qa={qa}
              />
            ) : null}

            {activeTab === "history" ? (
              <HistoryTab textQuery={textQuery} historyQuery={historyQuery} />
            ) : null}
          </>
        )}
      </ScrollView>

      {/* The composer replaces the action bar on Fragen */}
      {activeTab === "questions" ? (
        <AskComposer qa={qa} disabled={shouldUseCache} />
      ) : (
        <View style={styles.actionBar}>
          <View style={styles.actionSlot}>
            <Button
              label={t("documentDetail.overview.shareOriginal")}
              variant="secondary"
              disabled={shouldUseCache}
              onPress={() => void shareOriginal()}
            />
          </View>
          <View style={styles.actionSlot}>
            <Button label={t("documentDetail.done")} onPress={() => navigation.goBack()} />
          </View>
        </View>
      )}

      {/* Overflow: reprocess and delete */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <Row
              title={t("documentDetail.overview.reprocessDocument")}
              onPress={() => {
                setMenuOpen(false);
                actionMutation.mutate({
                  path: `/api/documents/${documentId}/reprocess`,
                  body: { force: true },
                });
              }}
            />
            <Row title={t("documentDetail.overview.deleteDocument")} onPress={confirmDelete} />
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.app,
  },
  gutter: {
    padding: 16,
  },
  hint: {
    ...text.meta,
    color: c.muted,
  },
  body: {
    paddingBottom: 12,
  },
  actionBar: {
    flexDirection: "row",
    gap: 9,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  actionSlot: {
    flex: 1,
  },
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: c.overlay,
  },
  menu: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    backgroundColor: c.panel,
    overflow: "hidden",
    paddingBottom: 24,
  },
}));
