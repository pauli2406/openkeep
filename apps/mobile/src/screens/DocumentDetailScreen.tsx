import * as Sharing from "expo-sharing";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import Markdown from "react-native-markdown-display";
import { useAuth } from "../auth";
import {
  Button,
  Card,
  EmptyState,
  ErrorCard,
  Field,
  Pill,
  SectionTitle,
} from "../components/ui";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { processingRefetchInterval } from "../document-processing";
import { DocumentViewer } from "../components/DocumentViewer";
import { useDocumentQa } from "../hooks/useDocumentQa";
import { useDocumentSummary } from "../hooks/useDocumentSummary";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, useColors } from "../theme";
import { fonts, text } from "../typography";
import {
  fetchTaxonomy,
  formatCurrency,
  formatDate,
  responseToMessage,
  saveDownloadToFile,
  sortTaxonomyOptions,
  taxonomyQueryKey,
  toneForStatus,
  titleForDocument,
  type ArchiveDocument,
  type DocumentHistoryResponse,
  type DocumentTextResponse,
  type HealthProvidersResponse,
  type ParseProvider,
  type QaHistoryEntry,
  type TaxonomyOption,
} from "../lib";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabKey = "preview" | "overview" | "insights" | "activity";

const TAXONOMY_KINDS = ["correspondents", "document-types", "tags"] as const;

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function DocumentDetailScreen() {
  const colors = useColors();
  const styles = useStyles();
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

  const [activeTab, setActiveTab] = useState<TabKey>("preview");

  const cachedRecordQuery = useQuery({
    queryKey: ["cached-document-record", documentId, shouldUseCache, offline.cacheSummary.updatedAt],
    queryFn: async () => {
      const record = await offline.loadCachedDocument(documentId);
      if (!record && shouldUseCache) {
        throw new Error(t("documentDetail.offlineNotCached"));
      }
      return record ?? null;
    },
  });

  // ---- Core queries ----
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
      queryFn: () =>
        fetchTaxonomy(auth.authFetch, kind, t("documentDetail.loadTaxonomiesFailed")),
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

  const providersQuery = useQuery({
    queryKey: ["health-providers", auth.apiUrl],
    enabled: documentQuery.isSuccess && !shouldUseCache,
    queryFn: async () => {
      const response = await auth.authFetch("/api/health/providers");
      if (!response.ok) throw new Error(t("documentDetail.loadProvidersFailed"));
      return (await response.json()) as HealthProvidersResponse;
    },
  });

  const qaHistoryQuery = useQuery({
    queryKey: ["document-qa-history", documentId, shouldUseCache],
    enabled: documentQuery.isSuccess && activeTab === "insights" && !shouldUseCache,
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

  // ---- Loading / error ----
  if (documentQuery.isLoading) {
    return (
      <ScreenShell title={t("documentDetail.doc")} subtitle={t("documentDetail.loading")}>
        <Card>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.helper}>{t("documentDetail.loadingDetail")}</Text>
        </Card>
      </ScreenShell>
    );
  }

  if (documentQuery.isError || !documentQuery.data) {
    return (
      <ScreenShell title={t("documentDetail.doc")} subtitle={t("documentDetail.unavailable")}>
        <ErrorCard message={t("documentDetail.loadError")} onRetry={() => documentQuery.refetch()} />
      </ScreenShell>
    );
  }

  const document = documentQuery.data;

  return (
    <ScreenShell
      title={titleForDocument(document)}
      subtitle={`${document.correspondent?.name ?? t("documentDetail.unfiled")} \u00B7 ${document.documentType?.name ?? t("documentDetail.doc")}`}
    >
      {/* Status row */}
      <View style={styles.statusRow}>
        <Pill label={formatDocumentStatus(t, document.status)} tone={toneForStatus(document.status)} />
        <Pill label={formatReviewStatus(t, document.reviewStatus)} tone={toneForStatus(document.reviewStatus)} />
        {document.confidence !== null && document.confidence !== undefined && (
          <Pill
            label={`${Math.round(document.confidence * 100)}% ${t("documentDetail.confidenceShort")}`}
            tone={document.confidence >= 0.8 ? "success" : document.confidence >= 0.5 ? "warning" : "danger"}
          />
        )}
      </View>
      <DocumentProcessingIndicator document={document} />

      {/* Tab bar */}
      <SegmentedTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === "preview" && (
        <PreviewTab
          document={document}
          authFetch={auth.authFetch}
          localFileUri={cachedRecordQuery.data?.fileUri ?? null}
          hasLocalFile={Boolean(cachedRecordQuery.data?.fileUri)}
          offlineMode={shouldUseCache}
          textBlocks={textQuery.data?.blocks}
        />
      )}
      {activeTab === "overview" && (
        <OverviewTab
          document={document}
          authFetch={auth.authFetch}
          queryClient={queryClient}
          documentId={documentId}
          apiUrl={auth.apiUrl}
          taxonomies={taxonomies}
          providers={providersQuery.data ?? null}
          navigation={navigation}
          offlineReadOnly={shouldUseCache}
        />
      )}
      {activeTab === "insights" && (
        <InsightsTab
          document={document}
          documentId={documentId}
          streamFetch={auth.streamFetch}
          authFetch={auth.authFetch}
          qaHistory={qaHistoryQuery.data ?? []}
          refetchQaHistory={() => qaHistoryQuery.refetch()}
          offlineMode={shouldUseCache}
        />
      )}
      {activeTab === "activity" && (
        <ActivityTab
          documentId={documentId}
          textQuery={textQuery}
          historyQuery={historyQuery}
        />
      )}
    </ScreenShell>
  );
}

// ---------------------------------------------------------------------------
// Lightweight screen shell (avoids the full <Screen> component so we can
// customize the scroll behaviour per tab)
// ---------------------------------------------------------------------------

function ScreenShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title} numberOfLines={2}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
          </View>
          {children}
        </View>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Segmented tab bar
// ---------------------------------------------------------------------------

function SegmentedTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const tabs = [
    { key: "preview" as const, label: t("documentDetail.tab.preview") },
    { key: "overview" as const, label: t("documentDetail.tab.overview") },
    { key: "insights" as const, label: t("documentDetail.tab.insights") },
    { key: "activity" as const, label: t("documentDetail.tab.activity") },
  ];
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onTabChange(tab.key)}
            style={[styles.tab, isActive && styles.tabActive]}
          >
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ===========================================================================
// TAB: Preview
// ===========================================================================

function PreviewTab({
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
  const { t } = useI18n();
  const { ensureCachedFile, isConnected } = useOfflineArchive();
  const persistOnlineFile = useCallback(
    () => ensureCachedFile(authFetch, document),
    [authFetch, document, ensureCachedFile],
  );

  return (
    <>
      <Card>
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
      </Card>
      {/* Quick metadata summary below preview */}
      <Card>
        <Text style={styles.metaText}>
          <Text style={styles.metaLabel}>{t("documentDetail.preview.type")}</Text>
          {document.mimeType}
        </Text>
        {document.metadata?.pageCount != null && (
          <Text style={styles.metaText}>
            <Text style={styles.metaLabel}>{t("documentDetail.preview.pages")}</Text>
            {document.metadata.pageCount}
          </Text>
        )}
        <Text style={styles.metaText}>
          <Text style={styles.metaLabel}>{t("documentDetail.preview.created")}</Text>
          {formatDate(document.createdAt)}
        </Text>
        {document.processedAt && (
          <Text style={styles.metaText}>
            <Text style={styles.metaLabel}>{t("documentDetail.preview.processed")}</Text>
            {formatDate(document.processedAt)}
          </Text>
        )}
        {document.parseProvider && (
          <Text style={styles.metaText}>
            <Text style={styles.metaLabel}>{t("documentDetail.preview.parseProvider")}</Text>
            {document.parseProvider}
          </Text>
        )}
      </Card>
    </>
  );
}

// ===========================================================================
// TAB: Overview (metadata editing + actions)
// ===========================================================================

type MetadataForm = {
  title: string;
  issueDate: string;
  dueDate: string;
  expiryDate: string;
  amount: string;
  currency: string;
  referenceNumber: string;
  holderName: string;
  issuingAuthority: string;
  correspondentId: string;
  documentTypeId: string;
  tagIds: string[];
};

function isSameForm(left: MetadataForm, right: MetadataForm) {
  return (
    left.title === right.title &&
    left.issueDate === right.issueDate &&
    left.dueDate === right.dueDate &&
    left.expiryDate === right.expiryDate &&
    left.amount === right.amount &&
    left.currency === right.currency &&
    left.referenceNumber === right.referenceNumber &&
    left.holderName === right.holderName &&
    left.issuingAuthority === right.issuingAuthority &&
    left.correspondentId === right.correspondentId &&
    left.documentTypeId === right.documentTypeId &&
    left.tagIds.length === right.tagIds.length &&
    left.tagIds.every((id, index) => id === right.tagIds[index])
  );
}

function OverviewTab({
  document,
  authFetch,
  queryClient,
  documentId,
  apiUrl,
  taxonomies,
  providers,
  navigation,
  offlineReadOnly,
}: {
  document: ArchiveDocument;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  queryClient: ReturnType<typeof useQueryClient>;
  documentId: string;
  apiUrl: string;
  taxonomies: {
    correspondents: TaxonomyOption[];
    documentTypes: TaxonomyOption[];
    tags: TaxonomyOption[];
  } | null;
  providers: HealthProvidersResponse | null;
  navigation: NativeStackNavigationProp<AppStackParamList>;
  offlineReadOnly: boolean;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  // ---- Form state ----
  const initialForm = useMemo(
    () => ({
      title: document.title ?? "",
      issueDate: document.issueDate ?? "",
      dueDate: document.dueDate ?? "",
      expiryDate: document.expiryDate ?? "",
      amount: document.amount?.toString() ?? "",
      currency: document.currency ?? "",
      referenceNumber: document.referenceNumber ?? "",
      holderName: document.holderName ?? "",
      issuingAuthority: document.issuingAuthority ?? "",
      correspondentId: document.correspondent?.id ?? "",
      documentTypeId: document.documentType?.id ?? "",
      tagIds: document.tags.map((t) => t.id),
    }),
    [document],
  );
  const [form, setForm] = useState(initialForm);
  // Snapshot of the server state the form was last synced with, so unsaved edits can be told
  // apart from incoming server changes.
  const syncedFormRef = useRef(initialForm);
  useEffect(() => {
    if (isSameForm(form, initialForm)) {
      syncedFormRef.current = initialForm;
      return;
    }
    if (!isSameForm(form, syncedFormRef.current)) {
      // The user has unsaved edits — a background refetch must not discard them.
      return;
    }
    syncedFormRef.current = initialForm;
    setForm(initialForm);
  }, [form, initialForm]);

  const [reprocessProvider, setReprocessProvider] = useState<ParseProvider | "default">("default");
  const [newCorrespondentName, setNewCorrespondentName] = useState("");

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      // Assigning a taxonomy entry changes the facet counts shown elsewhere.
      queryClient.invalidateQueries({ queryKey: ["document-facets"] }),
    ]);
  };

  // ---- Mutations ----
  const updateMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim() || undefined,
          issueDate: form.issueDate.trim() || null,
          dueDate: form.dueDate.trim() || null,
          expiryDate: form.expiryDate.trim() || null,
          amount: form.amount.trim() ? Number(form.amount) : null,
          currency: form.currency.trim() || null,
          referenceNumber: form.referenceNumber.trim() || null,
          holderName: form.holderName.trim() || null,
          issuingAuthority: form.issuingAuthority.trim() || null,
          correspondentId: form.correspondentId || null,
          documentTypeId: form.documentTypeId || null,
          tagIds: form.tagIds.length > 0 ? form.tagIds : undefined,
        }),
      });
      if (!response.ok) throw new Error(await responseToMessage(response));
    },
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`/api/documents/${documentId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error(await responseToMessage(response));
    },
    onSuccess: async () => {
      await invalidateAll();
      navigation.goBack();
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method?: string; body?: object }) => {
      const response = await authFetch(path, {
        method: method ?? "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) throw new Error(await responseToMessage(response));
    },
    onSuccess: invalidateAll,
  });

  const createCorrespondentMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await authFetch("/api/taxonomies/correspondents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await responseToMessage(response));
      return (await response.json()) as TaxonomyOption;
    },
    onSuccess: async (correspondent) => {
      // Insert into the cached list right away so the new entry is selectable regardless of
      // refetch timing. The API returns the existing row for a duplicate name, hence the filter.
      const correspondentsKey = taxonomyQueryKey(apiUrl, "correspondents");
      queryClient.setQueryData(correspondentsKey, (current: TaxonomyOption[] | undefined) =>
        current
          ? sortTaxonomyOptions([
              ...current.filter((item) => item.id !== correspondent.id),
              correspondent,
            ])
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: correspondentsKey });
      setForm((current) => ({ ...current, correspondentId: correspondent.id }));
      setNewCorrespondentName("");
    },
  });

  async function handleDownload(searchable: boolean) {
    if (offlineReadOnly) {
      throw new Error("Sharing requires a cached file from the Preview tab while offline mode is active.");
    }

    const endpoint = searchable
      ? `/api/documents/${documentId}/download/searchable`
      : `/api/documents/${documentId}/download`;
    const response = await authFetch(endpoint);
    if (!response.ok) throw new Error(await responseToMessage(response));
    const file = await saveDownloadToFile(
      response,
      searchable ? `openkeep-${documentId}-searchable.pdf` : `openkeep-${documentId}`,
    );
    await Sharing.shareAsync(file);
  }

  function confirmDelete() {
    Alert.alert(
      t("documentDetail.overview.deleteTitle"),
      t("documentDetail.overview.deleteBody"),
      [
        { text: t("settings.cancel"), style: "cancel" },
        {
          text: t("documentDetail.overview.deleteDocument"),
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ],
    );
  }

  // ---- Manual override info ----
  const manualOverrides = document.metadata?.manual;
  const lockedFields = manualOverrides?.lockedFields ?? [];

  // ---- Correspondent picker ----
  const correspondentName = taxonomies?.correspondents.find((c) => c.id === form.correspondentId)?.name ?? "";
  const docTypeName = taxonomies?.documentTypes.find((d) => d.id === form.documentTypeId)?.name ?? "";

  // ---- Available providers ----
  const availableProviders = providers?.parseProviders?.filter((p) => p.available) ?? [];

  return (
    <>
      {/* Review banner */}
      {document.reviewStatus === "pending" && (
        <Card style={styles.reviewBanner}>
          <Text style={styles.reviewBannerTitle}>{t("documentDetail.overview.needsReview")}</Text>
          {document.reviewReasons.length > 0 && (
            <View style={styles.tagRow}>
              {document.reviewReasons.map((reason) => (
                <Pill key={reason} label={reason.replace(/_/g, " ")} tone="warning" />
              ))}
            </View>
          )}
          <View style={styles.reviewActions}>
            <Button
                label={t("documentDetail.overview.resolve")}
              variant="primary"
              disabled={offlineReadOnly}
              onPress={() =>
                actionMutation.mutate({
                  path: `/api/documents/${documentId}/review/resolve`,
                })
              }
              loading={actionMutation.isPending}
            />
            <Button
                label={t("documentDetail.overview.requeue")}
              variant="secondary"
              disabled={offlineReadOnly}
              onPress={() =>
                actionMutation.mutate({
                  path: `/api/documents/${documentId}/review/requeue`,
                  body: { force: true },
                })
              }
              loading={actionMutation.isPending}
            />
          </View>
        </Card>
      )}

      {/* Processing error banner */}
      {document.lastProcessingError && (
        <Card style={styles.errorBanner}>
          <Text style={styles.errorBannerTitle}>{t("documentDetail.overview.processingError")}</Text>
          <Text style={styles.errorBannerBody}>{document.lastProcessingError}</Text>
        </Card>
      )}

      {/* Quick info */}
      <SectionTitle title={t("documentDetail.overview.details")} />
      <Card>
        <MetaRow label={t("documentDetail.overview.issueDate")} value={formatDate(document.issueDate)} numeric />
        <MetaRow label={t("documentDetail.overview.dueDate")} value={formatDate(document.dueDate)} numeric />
        {document.expiryDate && <MetaRow label={t("documentDetail.overview.expiryDate")} value={formatDate(document.expiryDate)} numeric />}
        <MetaRow label={t("documentDetail.overview.amount")} value={formatCurrency(document.amount, document.currency ?? "EUR")} numeric />
        {document.referenceNumber && <MetaRow label={t("documentDetail.overview.reference")} value={document.referenceNumber} numeric />}
        {document.holderName && <MetaRow label={t("documentDetail.overview.holder")} value={document.holderName} />}
        {document.issuingAuthority && <MetaRow label={t("documentDetail.overview.authority")} value={document.issuingAuthority} />}
        {document.tags.length > 0 && (
          <View style={styles.tagRow}>
            {document.tags.map((tag) => (
              <Pill key={tag.id} label={tag.name} tone="default" />
            ))}
          </View>
        )}
      </Card>

      {/* Metadata editing */}
      <SectionTitle title={t("documentDetail.overview.editMetadata")} hint={t("documentDetail.overview.editHint")} />
      <Card>
        <Field
          label={`${t("documentDetail.overview.title")}${lockedFields.includes("correspondentId") ? " \uD83D\uDD12" : ""}`}
          value={form.title}
          onChangeText={(v) => setForm((s) => ({ ...s, title: v }))}
        />
        <Field
          label={`${t("documentDetail.overview.issueDate")}${lockedFields.includes("issueDate") ? " \uD83D\uDD12" : ""}`}
          value={form.issueDate}
          onChangeText={(v) => setForm((s) => ({ ...s, issueDate: v }))}
          placeholder={t("documentDetail.overview.datePlaceholder")}
        />
        <Field
          label={`${t("documentDetail.overview.dueDate")}${lockedFields.includes("dueDate") ? " \uD83D\uDD12" : ""}`}
          value={form.dueDate}
          onChangeText={(v) => setForm((s) => ({ ...s, dueDate: v }))}
          placeholder={t("documentDetail.overview.datePlaceholder")}
        />
        <Field
          label={`${t("documentDetail.overview.expiryDate")}${lockedFields.includes("expiryDate") ? " \uD83D\uDD12" : ""}`}
          value={form.expiryDate}
          onChangeText={(v) => setForm((s) => ({ ...s, expiryDate: v }))}
          placeholder={t("documentDetail.overview.datePlaceholder")}
        />
        <Field
          label={`${t("documentDetail.overview.amountField")}${lockedFields.includes("amount") ? " \uD83D\uDD12" : ""}`}
          value={form.amount}
          onChangeText={(v) => setForm((s) => ({ ...s, amount: v }))}
          keyboardType="numeric"
        />
        <Field
          label={`${t("documentDetail.overview.currencyField")}${lockedFields.includes("currency") ? " \uD83D\uDD12" : ""}`}
          value={form.currency}
          onChangeText={(v) => setForm((s) => ({ ...s, currency: v }))}
          autoCapitalize="characters"
          placeholder={t("documentDetail.overview.currencyPlaceholder")}
        />
        <Field
          label={`${t("documentDetail.overview.referenceNumber")}${lockedFields.includes("referenceNumber") ? " \uD83D\uDD12" : ""}`}
          value={form.referenceNumber}
          onChangeText={(v) => setForm((s) => ({ ...s, referenceNumber: v }))}
        />
        <Field
          label={`${t("documentDetail.overview.holderName")}${lockedFields.includes("holderName") ? " \uD83D\uDD12" : ""}`}
          value={form.holderName}
          onChangeText={(v) => setForm((s) => ({ ...s, holderName: v }))}
        />
        <Field
          label={`${t("documentDetail.overview.issuingAuthority")}${lockedFields.includes("issuingAuthority") ? " \uD83D\uDD12" : ""}`}
          value={form.issuingAuthority}
          onChangeText={(v) => setForm((s) => ({ ...s, issuingAuthority: v }))}
        />

        {/* Correspondent picker */}
        {taxonomies && (
          <PickerField
            label={`${t("documentDetail.overview.correspondent")}${lockedFields.includes("correspondentId") ? " \uD83D\uDD12" : ""}`}
            selectedId={form.correspondentId}
            options={taxonomies.correspondents.map((c) => ({ id: c.id, label: c.name }))}
            onSelect={(id) => setForm((s) => ({ ...s, correspondentId: id }))}
            placeholder={t("documentDetail.overview.selectCorrespondent")}
            createValue={newCorrespondentName}
            onCreateValueChange={setNewCorrespondentName}
            onCreateOption={() => createCorrespondentMutation.mutate(newCorrespondentName.trim())}
            createPending={createCorrespondentMutation.isPending}
            createError={
              createCorrespondentMutation.isError
                ? createCorrespondentMutation.error instanceof Error
                  ? createCorrespondentMutation.error.message
                  : t("documentDetail.overview.createCorrespondentFailed")
                : null
            }
          />
        )}

        {/* Document type picker */}
        {taxonomies && (
          <PickerField
            label={`${t("documentDetail.overview.documentType")}${lockedFields.includes("documentTypeId") ? " \uD83D\uDD12" : ""}`}
            selectedId={form.documentTypeId}
            options={taxonomies.documentTypes.map((d) => ({ id: d.id, label: d.name }))}
            onSelect={(id) => setForm((s) => ({ ...s, documentTypeId: id }))}
            placeholder={t("documentDetail.overview.selectDocumentType")}
          />
        )}

        {/* Tags picker */}
        {taxonomies && (
          <TagsPicker
            label={t("documentDetail.overview.tags")}
            selectedIds={form.tagIds}
            options={taxonomies.tags.map((t) => ({ id: t.id, label: t.name }))}
            onToggle={(id) =>
              setForm((s) => ({
                ...s,
                tagIds: s.tagIds.includes(id) ? s.tagIds.filter((i) => i !== id) : [...s.tagIds, id],
              }))
            }
          />
        )}

        <Button label={t("documentDetail.overview.saveChanges")} onPress={() => updateMutation.mutate()} loading={updateMutation.isPending} disabled={offlineReadOnly} />
        {updateMutation.isError && (
          <Text style={styles.error}>
            {updateMutation.error instanceof Error ? updateMutation.error.message : t("documentDetail.overview.saveFailed")}
          </Text>
        )}

        {/* Clear overrides hint */}
        {lockedFields.length > 0 && (
          <Text style={styles.hintText}>
            {lockedFields.length === 1
              ? `1 ${t("documentDetail.overview.lockedFields.one")}`
              : `${lockedFields.length} ${t("documentDetail.overview.lockedFields.other")}`}
          </Text>
        )}
      </Card>

      {/* Actions */}
      <SectionTitle title={t("documentDetail.overview.actions")} />
      <Card>
        <Button label={t("documentDetail.overview.shareOriginal")} variant="secondary" onPress={() => void handleDownload(false)} disabled={offlineReadOnly} />
        {document.searchablePdfAvailable && (
          <Button label={t("documentDetail.overview.shareSearchable")} variant="secondary" onPress={() => void handleDownload(true)} disabled={offlineReadOnly} />
        )}

        {/* Reprocess with provider picker */}
        {availableProviders.length > 1 && (
          <View style={styles.reprocessRow}>
            <Text style={styles.fieldLabelSmall}>{t("documentDetail.overview.reprocessWith")}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerScroll}>
              <Pressable
                onPress={() => setReprocessProvider("default")}
                style={[styles.providerChip, reprocessProvider === "default" && styles.providerChipActive]}
              >
                <Text style={[styles.providerChipText, reprocessProvider === "default" && styles.providerChipTextActive]}>
                  {t("documentDetail.overview.defaultProvider")}
                </Text>
              </Pressable>
              {availableProviders.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setReprocessProvider(p.id)}
                  style={[styles.providerChip, reprocessProvider === p.id && styles.providerChipActive]}
                >
                  <Text style={[styles.providerChipText, reprocessProvider === p.id && styles.providerChipTextActive]}>
                    {p.id.replace(/-/g, " ")}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}
        <Button
          label={t("documentDetail.overview.reprocessDocument")}
          onPress={() =>
            actionMutation.mutate({
              path: `/api/documents/${documentId}/reprocess`,
              body: {
                force: true,
                ...(reprocessProvider !== "default" ? { parseProvider: reprocessProvider } : {}),
              },
            })
          }
          loading={actionMutation.isPending}
          disabled={offlineReadOnly}
        />

        {/* Processing job status */}
        {document.latestProcessingJob && (
          <View style={styles.jobStatus}>
            <Text style={styles.jobStatusLabel}>{t("documentDetail.overview.latestJob")}</Text>
            <Pill label={formatDocumentStatus(t, document.latestProcessingJob.status)} tone={toneForStatus(document.latestProcessingJob.status)} />
            {document.latestProcessingJob.lastError && (
              <Text style={styles.jobError} numberOfLines={3}>{document.latestProcessingJob.lastError}</Text>
            )}
          </View>
        )}

        {/* Danger zone */}
        <View style={styles.dangerZone}>
          <Button label={t("documentDetail.overview.deleteDocument")} variant="danger" onPress={confirmDelete} loading={deleteMutation.isPending} disabled={offlineReadOnly} />
        </View>
      </Card>
    </>
  );
}

// ===========================================================================
// TAB: Insights (Summary + Intelligence + Q&A)
// ===========================================================================

function InsightsTab({
  document,
  documentId,
  streamFetch,
  qaHistory,
  refetchQaHistory,
  offlineMode,
}: {
  document: ArchiveDocument;
  documentId: string;
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>;
  authFetch?: (path: string, init?: RequestInit) => Promise<Response>;
  qaHistory: QaHistoryEntry[];
  refetchQaHistory: () => void;
  offlineMode: boolean;
}) {
  const colors = useColors();
  const styles = useStyles();
  const markdownStyles = useMarkdownStyles();
  const { t } = useI18n();
  const summary = useDocumentSummary(streamFetch, documentId);
  const qa = useDocumentQa(streamFetch, documentId);
  const [qaQuestion, setQaQuestion] = useState("");

  const intelligence = document.metadata?.intelligence;

  const handleAsk = useCallback(() => {
    if (offlineMode) return;
    const q = qaQuestion.trim();
    if (!q) return;
    qa.ask(q);
  }, [offlineMode, qaQuestion, qa]);

  // The server persists the Q&A entry at stream end (the done event carries
  // historyEntryId) — refresh the history list instead of writing client-side.
  useEffect(() => {
    if (qa.status === "done" && qa.answerText) {
      refetchQaHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qa.status]);

  return (
    <>
      {/* Summary section */}
      <SectionTitle title={t("documentDetail.insights.summary")} hint={t("documentDetail.insights.summaryHint")} />
      <Card>
        {offlineMode ? (
          <Text style={styles.hintText}>{t("documentDetail.insights.aiDisabled")}</Text>
        ) : null}
        {!offlineMode && summary.status === "idle" && (
          <Button label={t("documentDetail.insights.generateSummary")} variant="secondary" onPress={() => summary.generate()} />
        )}
        {!offlineMode && summary.status === "streaming" && (
          <>
            <Markdown style={markdownStyles}>{summary.summaryText || t("documentDetail.insights.generating")}</Markdown>
            <ActivityIndicator color={colors.accent} style={{ marginTop: 8 }} />
          </>
        )}
        {!offlineMode && summary.status === "done" && summary.summaryText && (
          <>
            <Markdown style={markdownStyles}>{summary.summaryText}</Markdown>
            {summary.isCached && <Text style={styles.hintText}>{t("documentDetail.insights.cachedSummary")}</Text>}
            {summary.provider && (
              <Text style={styles.hintText}>
                {summary.provider}{summary.model ? ` / ${summary.model}` : ""}
              </Text>
            )}
            <Button label={t("documentDetail.insights.regenerate")} variant="secondary" onPress={() => summary.generate(true)} />
          </>
        )}
        {!offlineMode && summary.status === "error" && (
          <>
            <Text style={styles.error}>{summary.errorMessage}</Text>
            <Button label={t("documentDetail.insights.retry")} variant="secondary" onPress={() => summary.generate()} />
          </>
        )}
      </Card>

      {/* Intelligence metadata */}
      {intelligence && (
        <>
          <SectionTitle title={t("documentDetail.insights.intelligence")} hint={t("documentDetail.insights.intelligenceHint")} />
          <Card>
            {intelligence.routing && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.routing")}</Text>
                <Text style={styles.metaText}>
                  {t("documentDetail.insights.type")}: {intelligence.routing.documentType ?? t("documentDetail.insights.unknown")}
                  {intelligence.routing.subtype ? ` / ${intelligence.routing.subtype}` : ""}
                </Text>
                {intelligence.routing.confidence != null && (
                  <Text style={styles.metaText}>
                    {t("documentDetail.insights.confidence")}: {Math.round(intelligence.routing.confidence * 100)}%
                  </Text>
                )}
                {intelligence.routing.reasoningHints && intelligence.routing.reasoningHints.length > 0 && (
                  <Text style={styles.hintText}>
                    {t("documentDetail.insights.hints")}: {intelligence.routing.reasoningHints.join(", ")}
                  </Text>
                )}
              </View>
            )}

            {intelligence.title && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.titleExtraction")}</Text>
                <Text style={styles.metaText}>{intelligence.title.value ?? t("documentDetail.insights.none")}</Text>
                {intelligence.title.confidence != null && (
                  <Text style={styles.hintText}>{Math.round(intelligence.title.confidence * 100)}% {t("documentDetail.insights.confidence")}</Text>
                )}
              </View>
            )}

            {intelligence.extraction && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.fieldExtraction")}</Text>
                {Object.entries(intelligence.extraction.fields).map(([key, value]) => (
                  <Text key={key} style={styles.metaText}>
                    <Text style={styles.metaLabel}>{key}: </Text>
                    {String(value ?? "-")}
                    {intelligence.extraction?.fieldConfidence[key] != null
                      ? ` (${Math.round(intelligence.extraction.fieldConfidence[key]! * 100)}%)`
                      : ""}
                  </Text>
                ))}
              </View>
            )}

            {intelligence.tagging && intelligence.tagging.tags.length > 0 && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.suggestedTags")}</Text>
                <View style={styles.tagRow}>
                  {intelligence.tagging.tags.map((tag) => (
                    <Pill key={tag} label={tag} tone="default" />
                  ))}
                </View>
              </View>
            )}

            {intelligence.validation && (intelligence.validation.errors.length > 0 || intelligence.validation.warnings.length > 0) && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.validation")}</Text>
                {intelligence.validation.errors.map((e, i) => (
                  <Text key={`e-${i}`} style={styles.validationError}>{e}</Text>
                ))}
                {intelligence.validation.warnings.map((w, i) => (
                  <Text key={`w-${i}`} style={styles.validationWarning}>{w}</Text>
                ))}
              </View>
            )}

            {intelligence.pipeline && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.pipeline")}</Text>
                {intelligence.pipeline.framework && <Text style={styles.hintText}>{t("documentDetail.insights.framework")}: {intelligence.pipeline.framework}</Text>}
                {intelligence.pipeline.status && <Text style={styles.hintText}>{t("documentDetail.insights.pipelineStatus")}: {intelligence.pipeline.status}</Text>}
                {Object.keys(intelligence.pipeline.durationsMs).length > 0 && (
                  <Text style={styles.hintText}>
                    {t("documentDetail.insights.durations")}: {Object.entries(intelligence.pipeline.durationsMs).map(([k, v]) => `${k}: ${v}ms`).join(", ")}
                  </Text>
                )}
              </View>
            )}
          </Card>
        </>
      )}

      {/* Review evidence */}
      {document.metadata?.reviewEvidence && (
        <>
          <SectionTitle title={t("documentDetail.insights.reviewEvidence")} />
          <Card>
            <Text style={styles.metaText}>
              <Text style={styles.metaLabel}>{t("documentDetail.insights.documentClass")}: </Text>
              {document.metadata.reviewEvidence.documentClass}
            </Text>
            {document.metadata.reviewEvidence.missingFields.length > 0 && (
              <View>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.missingFields")}</Text>
                <View style={styles.tagRow}>
                  {document.metadata.reviewEvidence.missingFields.map((f) => (
                    <Pill key={f} label={f} tone="warning" />
                  ))}
                </View>
              </View>
            )}
            {document.metadata.reviewEvidence.confidence != null && (
              <Text style={styles.metaText}>
                <Text style={styles.metaLabel}>{t("documentDetail.insights.confidence")}: </Text>
                {Math.round(document.metadata.reviewEvidence.confidence * 100)}%
                {document.metadata.reviewEvidence.confidenceThreshold != null &&
                  ` (${t("documentDetail.insights.threshold")}: ${Math.round(document.metadata.reviewEvidence.confidenceThreshold * 100)}%)`}
              </Text>
            )}
          </Card>
        </>
      )}

      {/* Document Q&A */}
      <SectionTitle title={t("documentDetail.insights.askDocument")} hint={t("documentDetail.insights.askHint")} />
      <Card>
        <View style={styles.qaInputRow}>
          <TextInput
            style={styles.qaInput}
            value={qaQuestion}
            onChangeText={setQaQuestion}
            placeholder={t("documentDetail.insights.askPlaceholder")}
            placeholderTextColor={colors.muted}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleAsk}
          />
          <Pressable
            onPress={handleAsk}
            disabled={offlineMode || qa.status === "streaming" || !qaQuestion.trim()}
            style={({ pressed }) => [
              styles.qaButton,
              pressed && styles.qaButtonPressed,
              (offlineMode || qa.status === "streaming" || !qaQuestion.trim()) && styles.qaButtonDisabled,
            ]}
          >
            {qa.status === "streaming" ? (
              <ActivityIndicator color={colors.accentFillInk} size="small" />
            ) : (
              <Text style={styles.qaButtonText}>{t("documentDetail.insights.ask")}</Text>
            )}
          </Pressable>
        </View>

        {!offlineMode && qa.status === "streaming" && (
          <View style={styles.qaAnswer}>
            <Markdown style={markdownStyles}>{qa.answerText || t("documentDetail.insights.thinking")}</Markdown>
          </View>
        )}

        {!offlineMode && qa.status === "done" && qa.answerText && (
          <View style={styles.qaAnswer}>
            <Markdown style={markdownStyles}>{qa.answerText}</Markdown>
            {qa.citations.length > 0 && (
              <View style={styles.citationsWrap}>
                <Text style={styles.intelLabel}>{t("documentDetail.insights.sources")}</Text>
                {qa.citations.map((c, i) => (
                  <Text key={i} style={styles.hintText}>
                    {c.pageFrom ? `p.${c.pageFrom}${c.pageTo && c.pageTo !== c.pageFrom ? `-${c.pageTo}` : ""}` : `chunk ${c.chunkIndex}`}
                    {": "}
                    {c.quote.slice(0, 120)}
                    {c.quote.length > 120 ? "..." : ""}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {!offlineMode && qa.status === "error" && (
          <Text style={styles.error}>{qa.errorMessage}</Text>
        )}
      </Card>

      {/* Q&A history */}
      {qaHistory.length > 0 && (
        <>
          <SectionTitle title={t("documentDetail.insights.qaHistory")} />
          {qaHistory.map((entry) => (
            <Card key={entry.id}>
              <Text style={styles.qaHistoryQuestion}>{entry.question}</Text>
              {entry.answer && <Markdown style={markdownStyles}>{entry.answer}</Markdown>}
              <Text style={styles.hintText}>{formatDate(entry.createdAt)}</Text>
            </Card>
          ))}
        </>
      )}
    </>
  );
}

// ===========================================================================
// TAB: Activity (OCR text + audit history)
// ===========================================================================

function ActivityTab({
  documentId,
  textQuery,
  historyQuery,
}: {
  documentId: string;
  textQuery: ReturnType<typeof useQuery<DocumentTextResponse>>;
  historyQuery: ReturnType<typeof useQuery<DocumentHistoryResponse>>;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useI18n();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  // Group OCR blocks by page
  const pageGroups = useMemo(() => {
    if (!textQuery.data?.blocks) return [];
    const groups = new Map<number, string[]>();
    for (const block of textQuery.data.blocks) {
      const existing = groups.get(block.page) ?? [];
      existing.push(block.text);
      groups.set(block.page, existing);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([page, lines]) => ({ page, text: lines.join(" ") }));
  }, [textQuery.data]);

  return (
    <>
      {/* OCR text by page */}
      <SectionTitle title={t("documentDetail.activity.ocrText")} hint={t("documentDetail.activity.ocrHint")} />
      {textQuery.isLoading && (
        <Card>
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.helper}>{t("documentDetail.activity.loadingOcr")}</Text>
        </Card>
      )}
      {textQuery.data && pageGroups.length === 0 && (
        <EmptyState title={t("documentDetail.activity.noOcrTitle")} body={t("documentDetail.activity.noOcrBody")} />
      )}
      {pageGroups.map(({ page, text }) => (
        <Card key={page}>
          <Text style={styles.pageLabel}>{`${t("documentDetail.activity.page")} ${page}`}</Text>
          <Text style={styles.ocrText} selectable>{text}</Text>
        </Card>
      ))}

      {/* Audit history timeline */}
      <SectionTitle title={t("documentDetail.activity.history")} hint={t("documentDetail.activity.historyHint")} />
      {historyQuery.isLoading && (
        <Card>
          <ActivityIndicator color={colors.accent} />
        </Card>
      )}
      {historyQuery.data && historyQuery.data.items.length === 0 && (
        <EmptyState title={t("documentDetail.activity.noHistoryTitle")} body={t("documentDetail.activity.noHistoryBody")} />
      )}
      {historyQuery.data?.items.map((item, index) => {
        const isExpanded = expandedEvents.has(item.id);
        const hasPayload = item.payload && Object.keys(item.payload).length > 0;
        return (
          <Pressable
            key={item.id}
            onPress={() => {
              if (!hasPayload) return;
              setExpandedEvents((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            }}
          >
            <View style={styles.timelineItem}>
              {/* Timeline connector */}
              <View style={styles.timelineDot}>
                <View style={styles.timelineDotInner} />
                {index < historyQuery.data!.items.length - 1 && <View style={styles.timelineLine} />}
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.historyTitle}>{formatEventType(item.eventType)}</Text>
                <Text style={styles.historyMeta}>
                  {formatDate(item.createdAt)} \u00B7 {item.actorDisplayName ?? item.actorEmail ?? t("documentDetail.activity.system")}
                </Text>
                {hasPayload && (
                  <Text style={styles.expandHint}>{isExpanded ? t("documentDetail.activity.collapse") : t("documentDetail.activity.expand")}</Text>
                )}
                {isExpanded && hasPayload && (
                  <View style={styles.payloadWrap}>
                    {Object.entries(item.payload).map(([key, value]) => (
                      <Text key={key} style={styles.payloadLine}>
                        <Text style={styles.metaLabel}>{key}: </Text>
                        {typeof value === "object" ? JSON.stringify(value, null, 2) : String(value ?? "-")}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

// ===========================================================================
// Shared sub-components
// ===========================================================================

function MetaRow({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string;
  /** Dates, amounts and reference numbers are set in IBM Plex Mono. */
  numeric?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, numeric ? styles.metaValueNumeric : null]}>{value}</Text>
    </View>
  );
}

function formatDocumentStatus(
  t: ReturnType<typeof useI18n>["t"],
  status: string,
) {
  switch (status) {
    case "pending":
      return t("documentDetail.status.pending");
    case "processing":
      return t("documentDetail.status.processing");
    case "ready":
      return t("documentDetail.status.ready");
    case "failed":
      return t("documentDetail.status.failed");
    default:
      return status;
  }
}

function formatReviewStatus(
  t: ReturnType<typeof useI18n>["t"],
  status: string,
) {
  switch (status) {
    case "pending":
      return t("documentDetail.reviewStatus.pending");
    case "resolved":
      return t("documentDetail.reviewStatus.resolved");
    default:
      return status;
  }
}

function PickerField({
  label,
  selectedId,
  options,
  onSelect,
  placeholder,
  createValue,
  onCreateValueChange,
  onCreateOption,
  createPending = false,
  createError = null,
}: {
  label: string;
  selectedId: string;
  options: Array<{ id: string; label: string }>;
  onSelect: (id: string) => void;
  placeholder: string;
  createValue?: string;
  onCreateValueChange?: (value: string) => void;
  onCreateOption?: () => void;
  createPending?: boolean;
  createError?: string | null;
}) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedLabel = options.find((o) => o.id === selectedId)?.label ?? "";

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable onPress={() => setOpen(!open)} style={styles.pickerButton}>
        <Text style={[styles.pickerButtonText, !selectedLabel && styles.pickerPlaceholder]}>
          {selectedLabel || placeholder}
        </Text>
        <Text style={styles.pickerChevron}>{open ? "\u25B2" : "\u25BC"}</Text>
      </Pressable>
      {open && (
        <View style={styles.pickerDropdown}>
          <TextInput
            style={styles.pickerSearch}
            value={search}
            onChangeText={setSearch}
            placeholder={t("documentDetail.picker.filter")}
            placeholderTextColor={colors.muted}
          />
          {onCreateValueChange && onCreateOption && (
            <View style={styles.pickerCreateWrap}>
              <TextInput
                style={styles.pickerCreateInput}
                value={createValue ?? ""}
                onChangeText={onCreateValueChange}
                placeholder={t("documentDetail.picker.addNew")}
                placeholderTextColor={colors.muted}
              />
              <Pressable
                onPress={onCreateOption}
                disabled={createPending || !(createValue ?? "").trim()}
                style={[
                  styles.pickerCreateButton,
                  (createPending || !(createValue ?? "").trim()) && styles.pickerCreateButtonDisabled,
                ]}
              >
                <Text style={styles.pickerCreateButtonText}>{createPending ? t("documentDetail.picker.adding") : t("documentDetail.picker.add")}</Text>
              </Pressable>
            </View>
          )}
          {createError ? <Text style={styles.pickerCreateError}>{createError}</Text> : null}
          {/* Clear option */}
          <Pressable
            onPress={() => {
              onSelect("");
              setOpen(false);
              setSearch("");
            }}
            style={styles.pickerOption}
          >
            <Text style={[styles.pickerOptionText, styles.pickerOptionClear]}>{t("documentDetail.picker.none")}</Text>
          </Pressable>
          <ScrollView style={styles.pickerList} nestedScrollEnabled>
            {filtered.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => {
                  onSelect(o.id);
                  setOpen(false);
                  setSearch("");
                }}
                style={[styles.pickerOption, o.id === selectedId && styles.pickerOptionSelected]}
              >
                <Text style={[styles.pickerOptionText, o.id === selectedId && styles.pickerOptionTextSelected]}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function TagsPicker({
  label,
  selectedIds,
  options,
  onToggle,
}: {
  label: string;
  selectedIds: string[];
  options: Array<{ id: string; label: string }>;
  onToggle: (id: string) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.fieldWrap}>
      <Pressable onPress={() => setOpen(!open)}>
        <Text style={styles.fieldLabel}>{label} ({selectedIds.length})</Text>
      </Pressable>
      {selectedIds.length > 0 && (
        <View style={styles.tagRow}>
          {selectedIds.map((id) => {
            const opt = options.find((o) => o.id === id);
            return opt ? (
              <Pressable key={id} onPress={() => onToggle(id)}>
                <Pill label={`${opt.label} \u00D7`} tone="default" />
              </Pressable>
            ) : null;
          })}
        </View>
      )}
      {open && (
        <View style={styles.pickerDropdown}>
          <ScrollView style={styles.pickerList} nestedScrollEnabled>
            {options.map((o) => {
              const isSelected = selectedIds.includes(o.id);
              return (
                <Pressable
                  key={o.id}
                  onPress={() => onToggle(o.id)}
                  style={[styles.pickerOption, isSelected && styles.pickerOptionSelected]}
                >
                  <Text style={[styles.pickerOptionText, isSelected && styles.pickerOptionTextSelected]}>
                    {isSelected ? "\u2713 " : ""}{o.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEventType(eventType: string): string {
  return eventType
    .replace(/[._]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Markdown theme
// ---------------------------------------------------------------------------

const useMarkdownStyles = createThemedStyles((c) => ({
  body: {
    ...text.body,
    color: c.ink,
  },
  strong: {
    fontFamily: fonts.sans.semibold,
  },
  code_inline: {
    fontFamily: fonts.mono.regular,
    backgroundColor: c.raised,
    color: c.muted,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bullet_list_icon: {
    fontFamily: fonts.sans.regular,
    color: c.accent,
    fontSize: 8,
    marginTop: 8,
    marginRight: 8,
  },
  list_item: {
    flexDirection: "row" as const,
    marginBottom: 4,
  },
}));

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = createThemedStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.app,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 40,
    gap: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    ...text.screenTitle,
    color: c.ink,
  },
  subtitle: {
    fontFamily: fonts.sans.regular,
    marginTop: 4,
    fontSize: 14,
    lineHeight: 21,
    color: c.muted,
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },

  // Tab bar
  tabBar: {
    flexDirection: "row",
    backgroundColor: c.raised,
    borderRadius: 16,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },
  tabActive: {
    backgroundColor: c.panel,
  },
  tabText: {
    fontSize: 13,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    letterSpacing: 0.2,
  },
  tabTextActive: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
  },

  // Shared
  helper: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
    textAlign: "center",
  },
  error: {
    fontFamily: fonts.sans.regular,
    color: c.red,
    fontSize: 14,
  },
  hintText: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  metaText: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
    lineHeight: 20,
    fontSize: 14,
  },
  metaLabel: {
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },
  metaValueNumeric: {
    ...text.amount,
    color: c.ink,
    textAlign: "right",
  },
  metaValue: {
    color: c.ink,
    fontSize: 14,
    fontFamily: fonts.sans.semibold,
    textAlign: "right",
    flex: 1,
    marginLeft: 12,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },

  // Review banner
  reviewBanner: {
    borderColor: c.amber,
    borderWidth: 1.5,
  },
  reviewBannerTitle: {
    fontSize: 17,
    fontFamily: fonts.sans.semibold,
    color: c.amber,
  },
  reviewActions: {
    flexDirection: "row",
    gap: 10,
  },

  // Error banner
  errorBanner: {
    borderColor: c.red,
    borderWidth: 1.5,
  },
  errorBannerTitle: {
    fontSize: 17,
    fontFamily: fonts.sans.semibold,
    color: c.red,
  },
  errorBannerBody: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
    fontSize: 13,
    lineHeight: 19,
  },

  // Reprocess provider picker
  reprocessRow: {
    gap: 8,
  },
  fieldLabelSmall: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  providerScroll: {
    flexGrow: 0,
  },
  providerChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: c.raised,
    marginRight: 8,
  },
  providerChipActive: {
    backgroundColor: c.accentFill,
  },
  providerChipText: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    textTransform: "capitalize",
  },
  providerChipTextActive: {
    fontFamily: fonts.sans.regular,
    color: c.accentFillInk,
  },

  // Job status
  jobStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  jobStatusLabel: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  jobError: {
    fontFamily: fonts.sans.regular,
    color: c.red,
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },

  // Danger zone
  dangerZone: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },

  // Picker
  fieldWrap: {
    gap: 9,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  pickerButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerButtonText: {
    fontFamily: fonts.sans.regular,
    fontSize: 17,
    color: c.ink,
    flex: 1,
  },
  pickerPlaceholder: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
  },
  pickerChevron: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
    fontSize: 12,
    marginLeft: 8,
  },
  pickerDropdown: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
    overflow: "hidden",
  },
  pickerSearch: {
    fontFamily: fonts.sans.regular,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    fontSize: 15,
    color: c.ink,
  },
  pickerCreateWrap: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  pickerCreateInput: {
    fontFamily: fonts.sans.regular,
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.app,
    paddingHorizontal: 12,
    color: c.ink,
    fontSize: 15,
  },
  pickerCreateButton: {
    minWidth: 72,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: c.accentFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  pickerCreateButtonDisabled: {
    opacity: 0.5,
  },
  pickerCreateButtonText: {
    color: c.accentFillInk,
    fontFamily: fonts.sans.semibold,
    fontSize: 14,
  },
  pickerCreateError: {
    fontFamily: fonts.sans.regular,
    paddingHorizontal: 12,
    paddingBottom: 8,
    color: c.red,
    fontSize: 13,
  },
  pickerList: {
    maxHeight: 200,
  },
  pickerOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerOptionSelected: {
    backgroundColor: c.accentSoft,
  },
  pickerOptionText: {
    fontFamily: fonts.sans.regular,
    fontSize: 15,
    color: c.ink,
  },
  pickerOptionTextSelected: {
    color: c.accent,
    fontFamily: fonts.sans.semibold,
  },
  pickerOptionClear: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
    fontStyle: "italic",
  },

  // Intelligence
  intelSection: {
    gap: 4,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border,
  },
  intelLabel: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.accent,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  validationError: {
    fontFamily: fonts.sans.regular,
    color: c.red,
    fontSize: 13,
    lineHeight: 18,
  },
  validationWarning: {
    fontFamily: fonts.sans.regular,
    color: c.amber,
    fontSize: 13,
    lineHeight: 18,
  },

  // Q&A
  qaInputRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-end",
  },
  qaInput: {
    fontFamily: fonts.sans.regular,
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: c.ink,
    lineHeight: 20,
  },
  qaButton: {
    width: 54,
    height: 48,
    borderRadius: 16,
    backgroundColor: c.accentFill,
    alignItems: "center",
    justifyContent: "center",
  },
  qaButtonPressed: {
    opacity: 0.85,
  },
  qaButtonDisabled: {
    opacity: 0.4,
  },
  qaButtonText: {
    color: c.accentFillInk,
    fontFamily: fonts.sans.semibold,
    fontSize: 14,
  },
  qaAnswer: {
    paddingTop: 8,
    gap: 10,
  },
  citationsWrap: {
    gap: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border,
  },
  qaHistoryQuestion: {
    fontSize: 15,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
    lineHeight: 21,
  },

  // OCR
  pageLabel: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.accent,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  ocrText: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
    fontSize: 14,
    lineHeight: 22,
  },

  // History timeline
  timelineItem: {
    flexDirection: "row",
    paddingHorizontal: 20,
    gap: 12,
  },
  timelineDot: {
    alignItems: "center",
    width: 20,
    paddingTop: 4,
  },
  timelineDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: c.accentSoft,
    borderWidth: 2,
    borderColor: c.accent,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: c.border,
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 20,
    gap: 2,
  },
  historyTitle: {
    fontSize: 15,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  historyMeta: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    color: c.muted,
    lineHeight: 17,
  },
  expandHint: {
    fontSize: 12,
    color: c.accent,
    fontFamily: fonts.sans.semibold,
    marginTop: 2,
  },
  payloadWrap: {
    marginTop: 6,
    backgroundColor: c.raised,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  payloadLine: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    color: c.ink,
    lineHeight: 17,
  },
}));
