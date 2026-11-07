import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Sharing from "expo-sharing";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppStackParamList } from "../../App";
import {
  clearLockedFields,
  clearQaHistory,
  createCorrespondent,
  createTag,
  deleteDocument,
  downloadDocumentToFile,
  fetchQaHistory,
  reprocessDocument,
  requeueDocument,
  resolveReview,
  updateDocument,
  type DownloadVariant,
  type QaCitation,
} from "../api/document";
import { useAuth } from "../auth";
import { BottomSheet, Skeleton } from "../components/layout";
import { findPassage, type Passage } from "../components/Passage";
import { Button, ErrorCard, Notice } from "../components/ui";
import { isDocumentProcessing, processingRefetchInterval } from "../document-processing";
import { useDocumentQa, type QaAnsweredTurn } from "../hooks/useDocumentQa";
import { useDocumentSummary } from "../hooks/useDocumentSummary";
import { useI18n } from "../i18n";
import {
  fetchTaxonomy,
  sortTaxonomyOptions,
  taxonomyQueryKey,
  titleForDocument,
  type ArchiveDocument,
  type DocumentHistoryResponse,
  type DocumentTextResponse,
  type HealthProvidersResponse,
  type ManualOverrideField,
  type ParseProvider,
  type QaHistoryEntry,
  type TaxonomyOption,
} from "../lib";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import { DetailHeader, DetailHeaderSkeleton, InspectorTabs } from "./document-detail/DetailBar";
import { FieldsTab, SaveBar } from "./document-detail/FieldsTab";
import { HistoryTab } from "./document-detail/HistoryTab";
import { IntelligenceTab } from "./document-detail/IntelligenceTab";
import { OcrTextTab } from "./document-detail/OcrTextTab";
import { InlineError } from "./document-detail/parts";
import { QaComposer, QaTab } from "./document-detail/QaTab";
import {
  buildDocumentPatch,
  dirtyFields,
  parseProviderLabel,
  validateForm,
  type EditableField,
  type TabKey,
} from "./document-detail/shared";
import { useDocumentForm } from "./document-detail/useDocumentForm";
import { ViewerPane } from "./document-detail/ViewerPane";

const TAXONOMY_KINDS = ["correspondents", "document-types", "tags"] as const;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : null);

/**
 * The route. Queries, mutations and the form live here; the header, the viewer and
 * each inspector tab are their own modules under `document-detail/`.
 *
 * On a phone the viewer stacks above the inspector in one scrolling column, as the
 * web does below `lg`, with the tab bar sticking under the header. A tap on a tab
 * scrolls the column up to it, so a tab always opens onto its content even though
 * the page above takes most of the first screen.
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
  const { height: windowHeight } = useWindowDimensions();
  const documentId = route.params.documentId;
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const cacheOpenedDocument = offline.cacheOpenedDocument;
  // Only queries that actually read the offline cache should re-key when it changes. Online
  // queries fetch from the network, so a cache refresh must not discard their entry — that would
  // unmount the metadata form mid-edit.
  const cacheRevision = shouldUseCache ? offline.cacheSummary.revision : null;

  const [activeTab, setActiveTab] = useState<TabKey>("fields");
  const [menuOpen, setMenuOpen] = useState(false);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ParseProvider | "">("");
  const [page, setPage] = useState(route.params.citation?.page ?? 1);
  /** The passage to show on the viewer: from a chat deep link, or a tap in Q&A. */
  const [citation, setCitation] = useState(route.params.citation ?? null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const inspectorOffset = useRef(0);
  const [columnHeight, setColumnHeight] = useState(windowHeight);
  /** While an answer streams in, the column follows it, until the reader scrolls away. */
  const followThread = useRef(false);

  const qaHistoryKey = useMemo(
    () => ["document-qa-history", documentId, shouldUseCache],
    [documentId, shouldUseCache],
  );

  const onAnswered = useCallback(
    (turn: QaAnsweredTurn) => {
      queryClient.setQueryData<QaHistoryEntry[]>(qaHistoryKey, (current) => [
        ...(current ?? []),
        {
          id: turn.historyEntryId ?? `local-${Date.now()}`,
          question: turn.question,
          answer: turn.answer,
          status: turn.status,
          citations: turn.citations,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
    [qaHistoryKey, queryClient],
  );

  const qa = useDocumentQa(auth.streamFetch, documentId, onAnswered);
  const summary = useDocumentSummary(auth.streamFetch, documentId);

  const cachedRecordQuery = useQuery({
    queryKey: [
      "cached-document-record",
      documentId,
      shouldUseCache,
      offline.cacheSummary.revision,
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

  /**
   * The viewer takes a path, not a buffer, so the encrypted bytes are decrypted
   * into the cache directory for as long as this screen is open. The effect
   * below deletes that copy on the way out.
   */
  const localFileQuery = useQuery({
    queryKey: ["cached-file", documentId, shouldUseCache, cacheRevision],
    enabled: shouldUseCache && documentQuery.isSuccess,
    queryFn: () => offline.ensureCachedFile(auth.authFetch, documentQuery.data!),
  });

  useEffect(
    () => () => {
      void offline.releaseCachedFile(documentId);
    },
    [documentId, offline],
  );

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

  // Reprocessing may need a different parser than the active one; the endpoint
  // still accepts `parseProvider`, so the choice stays available on mobile.
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
    queryKey: qaHistoryKey,
    enabled: documentQuery.isSuccess && activeTab === "qa" && !shouldUseCache,
    queryFn: () => fetchQaHistory(auth.authFetch, documentId),
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
      queryClient.invalidateQueries({ queryKey: ["document-history", documentId] }),
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["document-facets"] }),
    ]);
  }, [documentId, queryClient]);

  const document = documentQuery.data;
  const { form, patchForm, resetForm } = useDocumentForm(document);

  const resolveMutation = useMutation({
    mutationFn: () => resolveReview(auth.authFetch, documentId),
    onSuccess: invalidateAll,
  });

  const requeueMutation = useMutation({
    mutationFn: () => requeueDocument(auth.authFetch, documentId),
    onSuccess: invalidateAll,
  });

  const reprocessMutation = useMutation({
    mutationFn: (parseProvider?: ParseProvider) =>
      reprocessDocument(auth.authFetch, documentId, parseProvider),
    onSuccess: async () => {
      setProviderPickerOpen(false);
      await invalidateAll();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDocument(auth.authFetch, documentId),
    onSuccess: async () => {
      await invalidateAll();
      navigation.goBack();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateDocument>[2]) =>
      updateDocument(auth.authFetch, documentId, patch),
    onSuccess: invalidateAll,
  });

  const unlockMutation = useMutation({
    mutationFn: (fields: ManualOverrideField[]) =>
      clearLockedFields(auth.authFetch, documentId, fields),
    onSuccess: invalidateAll,
  });

  const createTagMutation = useMutation({
    mutationFn: (name: string) => createTag(auth.authFetch, name),
    onSuccess: async (tag) => {
      const key = taxonomyQueryKey(auth.apiUrl, "tags");
      queryClient.setQueryData(key, (current: TaxonomyOption[] | undefined) =>
        sortTaxonomyOptions([...(current ?? []).filter((item) => item.id !== tag.id), tag]),
      );
      await queryClient.invalidateQueries({ queryKey: key });
      if (form && !form.tagIds.includes(tag.id)) {
        patchForm({ tagIds: [...form.tagIds, tag.id] });
      }
    },
  });

  const createCorrespondentMutation = useMutation({
    mutationFn: (name: string) => createCorrespondent(auth.authFetch, name),
    onSuccess: async (correspondent) => {
      const key = taxonomyQueryKey(auth.apiUrl, "correspondents");
      queryClient.setQueryData(key, (current: TaxonomyOption[] | undefined) =>
        sortTaxonomyOptions([
          ...(current ?? []).filter((item) => item.id !== correspondent.id),
          correspondent,
        ]),
      );
      await queryClient.invalidateQueries({ queryKey: key });
      patchForm({ correspondentId: correspondent.id });
    },
  });

  const clearHistoryMutation = useMutation({
    mutationFn: () => clearQaHistory(auth.authFetch, documentId),
    onSuccess: () => {
      qa.reset();
      queryClient.setQueryData<QaHistoryEntry[]>(qaHistoryKey, []);
    },
  });

  /** A citation's passage, located in the recognised text so its page is real. */
  const passage = useMemo<Passage | null>(() => {
    if (!citation) {
      return null;
    }
    return (
      findPassage(textQuery.data?.blocks, citation.quote, {
        allowPrefix: true,
        page: citation.page,
      }) ?? {
        // The OCR text does not have it, or has not loaded. The quote still shows.
        page: citation.page ?? page,
        lines: [{ text: citation.quote, hit: true }],
      }
    );
    // `page` only supplies the fallback's number, and following it would re-run
    // this on every page turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citation, textQuery.data?.blocks]);

  const passagePage = passage?.page;
  useEffect(() => {
    if (passagePage) {
      setPage(passagePage);
    }
  }, [citation, passagePage]);

  useEffect(() => {
    if (route.params.citation) {
      setCitation(route.params.citation);
    }
  }, [route.params.citation]);

  const openCitation = useCallback((target: QaCitation) => {
    setCitation({ page: target.pageFrom ?? target.pageTo, quote: target.quote });
    followThread.current = false;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const selectTab = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    followThread.current = false;
    // After the new tab has laid out: it may be taller than the old one.
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: inspectorOffset.current, animated: true });
    });
  }, []);

  /**
   * Keeps an in-place editor above the keyboard. React Native's scroll view does
   * not chase a focused input, so the row asks to be brought into view once the
   * keyboard has had time to shrink the column.
   */
  const revealEditor = useCallback((node: View | null) => {
    setTimeout(() => {
      const container = contentRef.current;
      if (!node || !container) {
        return;
      }
      node.measureLayout(
        container,
        (_x, y) => {
          scrollRef.current?.scrollTo({
            y: Math.max(0, inspectorOffset.current + y - 56),
            animated: true,
          });
        },
        () => {},
      );
    }, 280);
  }, []);

  const askQuestion = useCallback(
    (question: string) => {
      followThread.current = true;
      void qa.ask(question);
    },
    [qa],
  );

  // A starter is asked from inside the tab, so it joins the follow here too.
  const qaStatus = qa.status;
  useEffect(() => {
    if (qaStatus === "loading") {
      followThread.current = true;
    }
    if (qaStatus === "idle" || qaStatus === "error") {
      const stop = setTimeout(() => {
        followThread.current = false;
      }, 400);
      return () => clearTimeout(stop);
    }
  }, [qaStatus]);

  /**
   * Offline the bytes are already on the device, so sharing them is a read: the
   * decrypted copy the viewer is showing goes to the share sheet. Online, each
   * variant is downloaded under a name derived from the title.
   */
  const localFileUri = localFileQuery.data ?? null;
  const canDownload = shouldUseCache ? Boolean(localFileUri) : Boolean(document);
  const download = useCallback(
    async (variant: DownloadVariant) => {
      setDownloadError(null);
      setMenuOpen(false);
      try {
        if (shouldUseCache) {
          if (localFileUri) {
            await Sharing.shareAsync(localFileUri);
          }
          return;
        }
        if (!document) {
          return;
        }
        const file = await downloadDocumentToFile(auth.authFetch, document, variant);
        await Sharing.shareAsync(file);
      } catch (error) {
        setDownloadError(errorMessage(error) ?? t("documentDetail.downloadFailed"));
      }
    },
    [auth.authFetch, document, localFileUri, shouldUseCache, t],
  );

  const availableProviders = (providersQuery.data?.parseProviders ?? []).filter(
    (provider) => provider.available,
  );

  const startReprocess = () => {
    setMenuOpen(false);
    if (availableProviders.length > 1) {
      setSelectedProvider(providersQuery.data?.activeParseProvider ?? availableProviders[0].id);
      setProviderPickerOpen(true);
      return;
    }
    reprocessMutation.mutate(undefined);
  };

  const confirmDelete = () => {
    setMenuOpen(false);
    Alert.alert(
      t("documentDetail.deleteDialogTitle"),
      `${document ? titleForDocument(document) : ""}\n\n${t("documentDetail.deleteDialogDescription")}`,
      [
        { text: t("settings.cancel"), style: "cancel" },
        {
          text: t("documentDetail.deletePermanently"),
          style: "destructive",
          onPress: () => deleteMutation.mutate(),
        },
      ],
    );
  };

  const confirmClearHistory = () => {
    Alert.alert(t("documentDetail.clearHistoryTitle"), t("documentDetail.clearHistoryBody"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("documentDetail.clearHistory"),
        style: "destructive",
        onPress: () => clearHistoryMutation.mutate(),
      },
    ]);
  };

  const dirty: EditableField[] = useMemo(
    () => (document && form ? dirtyFields(document, form) : []),
    [document, form],
  );

  const lockedFields = document?.metadata?.manual?.lockedFields ?? [];

  const fieldName = (field: EditableField) => {
    switch (field) {
      case "title":
        return t("documentDetail.title");
      case "issueDate":
        return t("documentDetail.issueDate");
      case "dueDate":
        return t("documentDetail.deadline");
      case "expiryDate":
        return t("documentDetail.expiryDate");
      case "amount":
        return t("documentDetail.amount");
      case "currency":
        return t("documentDetail.currency");
      case "referenceNumber":
        return t("documentDetail.reference");
      case "holderName":
        return t("documentDetail.holderName");
      case "issuingAuthority":
        return t("documentDetail.issuingAuthority");
      case "correspondentId":
        return t("documentDetail.correspondent");
      case "documentTypeId":
        return t("documentDetail.documentType");
      case "tagIds":
        return t("documentDetail.tags");
    }
  };
  const newLocks = dirty.filter(
    (field): field is ManualOverrideField =>
      field !== "title" && !lockedFields.includes(field),
  );
  const lockNote =
    newLocks.length > 0
      ? `${t("documentDetail.savingWillLock")} ${newLocks.map(fieldName).join(", ")}.`
      : lockedFields.length > 0
        ? t("documentDetail.lockedFieldsSticky")
        : null;

  const save = () => {
    if (!document || !form) {
      return;
    }
    const problem = validateForm(form);
    if (problem) {
      setFormProblem(
        problem === "title"
          ? t("documentDetail.invalidTitle")
          : problem === "date"
            ? t("documentDetail.invalidDate")
            : t("documentDetail.invalidAmount"),
      );
      return;
    }
    setFormProblem(null);
    updateMutation.mutate(buildDocumentPatch(document, form));
  };

  const goBack = () => navigation.goBack();

  if (documentQuery.isLoading || (!document && !documentQuery.isError)) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <DetailHeaderSkeleton onBack={goBack} />
        <View style={[styles.skeletonStage, { height: Math.max(320, windowHeight * 0.62) }]}>
          <View style={styles.skeletonPaper}>
            {[40, 92, 88, 94, 76].map((width) => (
              <Skeleton key={width} style={[styles.skeletonLine, { width: `${width}%` }]} />
            ))}
          </View>
        </View>
        <View style={styles.skeletonRows}>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} style={styles.skeletonRow} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  if (!document || !form) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <DetailHeaderSkeleton onBack={goBack} />
        <View style={styles.errorBox}>
          <ErrorCard
            message={errorMessage(documentQuery.error) ?? t("documentDetail.loadError")}
            onRetry={() => void documentQuery.refetch()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const processing = isDocumentProcessing(document);
  const actionError =
    errorMessage(resolveMutation.error) ??
    errorMessage(requeueMutation.error) ??
    (providerPickerOpen ? null : errorMessage(reprocessMutation.error)) ??
    errorMessage(deleteMutation.error) ??
    downloadError;

  const taxonomyError =
    errorMessage(correspondentsResult.error) ??
    errorMessage(documentTypesResult.error) ??
    errorMessage(tagsResult.error);

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <DetailHeader
        document={document}
        offlineReadOnly={shouldUseCache}
        canDownload={canDownload}
        resolving={resolveMutation.isPending}
        onBack={goBack}
        onResolve={() => resolveMutation.mutate()}
        onDownload={() => void download("original")}
        onMenu={() => setMenuOpen(true)}
      />

      {shouldUseCache ? <Notice label={t("state.offlineReadOnly")} /> : null}

      {actionError ? (
        <View style={styles.actionError}>
          <InlineError message={actionError} />
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          stickyHeaderIndices={[1]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          onLayout={(event) => setColumnHeight(event.nativeEvent.layout.height)}
          onScrollBeginDrag={() => {
            followThread.current = false;
          }}
          onContentSizeChange={() => {
            if (followThread.current) {
              scrollRef.current?.scrollToEnd({ animated: true });
            }
          }}
        >
          <View
            onLayout={(event) => {
              inspectorOffset.current = event.nativeEvent.layout.height;
            }}
          >
            <ViewerPane
              document={document}
              authFetch={auth.authFetch}
              localFileUri={localFileUri}
              hasLocalFile={Boolean(cachedRecordQuery.data?.fileUri)}
              localFilePending={shouldUseCache && localFileQuery.isLoading}
              offlineMode={shouldUseCache}
              textBlocks={textQuery.data?.blocks}
              page={page}
              onPageChange={setPage}
              passage={passage}
              onDismissPassage={() => setCitation(null)}
              canDownload={canDownload}
              onDownload={(variant) => void download(variant)}
              onFullScreenFailed={() => setDownloadError(t("documentViewer.previewUnavailable"))}
            />
          </View>

          <InspectorTabs activeTab={activeTab} onChange={selectTab} />

          {/* At least a screen tall, so a short tab can still scroll up to the bar. */}
          <View ref={contentRef} style={[styles.inspector, { minHeight: columnHeight - 44 }]}>
            {activeTab === "fields" ? (
              <FieldsTab
                document={document}
                form={form}
                onFormChange={(patch) => {
                  setFormProblem(null);
                  patchForm(patch);
                }}
                taxonomies={taxonomies}
                taxonomiesLoading={
                  !shouldUseCache &&
                  (correspondentsResult.isLoading ||
                    documentTypesResult.isLoading ||
                    tagsResult.isLoading)
                }
                taxonomiesError={taxonomyError}
                onRetryTaxonomies={() => {
                  void correspondentsResult.refetch();
                  void documentTypesResult.refetch();
                  void tagsResult.refetch();
                }}
                lockedFields={lockedFields}
                onUnlock={(fields) => unlockMutation.mutate(fields)}
                unlockPending={unlockMutation.isPending}
                onCreateTag={(name) => createTagMutation.mutate(name)}
                createTagPending={createTagMutation.isPending}
                onCreateCorrespondent={(name) => createCorrespondentMutation.mutate(name)}
                createCorrespondentPending={createCorrespondentMutation.isPending}
                dirty={dirty}
                actionError={
                  createTagMutation.isError
                    ? t("documentDetail.failedToCreateTag")
                    : createCorrespondentMutation.isError
                      ? t("documentDetail.failedToCreateCorrespondent")
                      : unlockMutation.isError
                        ? t("documentDetail.failedToClearOverride")
                        : null
                }
                readOnly={shouldUseCache}
                onReveal={revealEditor}
              />
            ) : null}

            {activeTab === "intelligence" ? (
              <IntelligenceTab
                document={document}
                summary={summary}
                offlineReadOnly={shouldUseCache}
              />
            ) : null}

            {activeTab === "qa" ? (
              <QaTab
                history={qaHistoryQuery.data ?? []}
                historyLoading={!shouldUseCache && qaHistoryQuery.isLoading}
                historyError={qaHistoryQuery.isError}
                onRetryHistory={() => void qaHistoryQuery.refetch()}
                qa={qa}
                offlineReadOnly={shouldUseCache}
                clearPending={clearHistoryMutation.isPending}
                clearError={
                  clearHistoryMutation.isError ? t("documentDetail.failedToClearHistory") : null
                }
                onClearHistory={confirmClearHistory}
                onOpenCitation={openCitation}
              />
            ) : null}

            {activeTab === "text" ? <OcrTextTab textQuery={textQuery} /> : null}

            {activeTab === "history" ? <HistoryTab historyQuery={historyQuery} /> : null}
          </View>
        </ScrollView>

        {activeTab === "fields" && dirty.length > 0 ? (
          <SaveBar
            note={lockNote}
            error={
              formProblem ??
              (updateMutation.isError ? t("documentDetail.failedToSaveChanges") : null)
            }
            saving={updateMutation.isPending}
            disabled={shouldUseCache}
            onSave={save}
            onDiscard={() => {
              setFormProblem(null);
              updateMutation.reset();
              resetForm();
            }}
          />
        ) : null}

        {activeTab === "qa" && !shouldUseCache ? (
          <QaComposer
            busy={qa.status === "loading" || qa.status === "streaming"}
            onSend={askQuestion}
          />
        ) : null}
      </KeyboardAvoidingView>

      {/* Everything else: the variants, then what asks the server to do something. */}
      <BottomSheet
        visible={menuOpen}
        title={t("documentDetail.moreActions")}
        onClose={() => setMenuOpen(false)}
      >
        <View>
          {shouldUseCache ? (
            // Every server-side entry is gone rather than greyed out. The session is
            // read-only, and a reconnect mid-session must not turn that into a delete.
            <>
              <MenuRow
                icon="download-outline"
                label={t("documentDetail.download")}
                disabled={!canDownload}
                onPress={() => void download("original")}
              />
              <Text style={styles.menuNote}>{t("state.offlineReadOnly")}</Text>
            </>
          ) : (
            <>
              <MenuRow
                icon="download-outline"
                label={t("documentDetail.original")}
                onPress={() => void download("original")}
              />
              {document.searchablePdfAvailable ? (
                <MenuRow
                  icon="file-document-outline"
                  label={t("documentDetail.searchablePdfFull")}
                  onPress={() => void download("searchable")}
                />
              ) : null}
              <View style={styles.menuRule} />
              <MenuRow
                icon="restore"
                label={t("documentDetail.requeue")}
                busy={requeueMutation.isPending}
                onPress={() => {
                  setMenuOpen(false);
                  requeueMutation.mutate();
                }}
              />
              <MenuRow
                icon="text-recognition"
                label={t("documentDetail.reprocess")}
                busy={reprocessMutation.isPending}
                disabled={processing}
                onPress={startReprocess}
              />
              <View style={styles.menuRule} />
              <MenuRow
                icon="trash-can-outline"
                label={t("documentDetail.delete")}
                destructive
                busy={deleteMutation.isPending}
                disabled={processing}
                onPress={confirmDelete}
              />
            </>
          )}
        </View>
      </BottomSheet>

      {/* Which parser to rerun with, when more than one is configured */}
      <BottomSheet
        visible={providerPickerOpen}
        title={t("documentDetail.reprocessDialogTitle")}
        onClose={() => setProviderPickerOpen(false)}
        footer={
          <>
            <View style={styles.flex}>
              <Button
                label={t("settings.cancel")}
                variant="secondary"
                disabled={reprocessMutation.isPending}
                onPress={() => setProviderPickerOpen(false)}
              />
            </View>
            <View style={styles.flex}>
              <Button
                label={t("documentDetail.reprocess")}
                loading={reprocessMutation.isPending}
                disabled={!selectedProvider}
                onPress={() => reprocessMutation.mutate(selectedProvider || undefined)}
              />
            </View>
          </>
        }
      >
        <Text style={styles.sheetBody}>{t("documentDetail.reprocessDialogDescription")}</Text>
        {reprocessMutation.isError ? (
          <InlineError
            message={
              errorMessage(reprocessMutation.error) ??
              t("documentDetail.failedToReprocessDocument")
            }
          />
        ) : null}
        <View>
          {availableProviders.map((provider) => {
            const selected = provider.id === selectedProvider;
            const tags = [
              provider.id === providersQuery.data?.activeParseProvider
                ? t("documentDetail.active")
                : null,
              provider.id === providersQuery.data?.fallbackParseProvider
                ? t("documentDetail.fallback")
                : null,
            ].filter(Boolean);
            return (
              <Pressable
                key={provider.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setSelectedProvider(provider.id)}
                style={({ pressed }) => [styles.menuRow, pressed ? styles.menuRowPressed : null]}
              >
                <MaterialCommunityIcons
                  name={selected ? "radiobox-marked" : "radiobox-blank"}
                  size={20}
                  color={selected ? colors.accent : colors.muted}
                />
                <Text style={styles.menuLabel} numberOfLines={1}>
                  {parseProviderLabel(provider.id)}
                </Text>
                {tags.length > 0 ? (
                  <Text style={styles.menuMeta}>{`(${tags.join(", ")})`}</Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {document.parseProvider ? (
          <Text style={styles.menuNote}>
            {`${t("documentDetail.lastProcessedWith")} ${parseProviderLabel(document.parseProvider)}`}
          </Text>
        ) : null}
      </BottomSheet>
    </SafeAreaView>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  disabled = false,
  busy = false,
  destructive = false,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const ink = destructive ? colors.red : colors.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        disabled ? styles.menuRowDisabled : null,
        pressed ? styles.menuRowPressed : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={ink} />
      ) : (
        <MaterialCommunityIcons name={icon as never} size={20} color={ink} />
      )}
      <Text style={[styles.menuLabel, destructive ? styles.menuLabelDestructive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.panel,
  },
  flex: {
    flex: 1,
  },
  inspector: {
    backgroundColor: c.panel,
  },
  actionError: {
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.panel,
  },
  errorBox: {
    padding: 16,
  },
  skeletonStage: {
    padding: 12,
    backgroundColor: c.sunken,
  },
  skeletonPaper: {
    flex: 1,
    gap: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: c.paperBorder,
    borderRadius: radii.sm,
    backgroundColor: c.paper,
  },
  skeletonLine: {
    height: 12,
    borderRadius: radii.pill,
    backgroundColor: c.paperBorder,
  },
  skeletonRows: {
    gap: 12,
    padding: 16,
  },
  skeletonRow: {
    height: 28,
    borderRadius: radii.md,
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    borderRadius: radii.md,
    paddingHorizontal: 4,
  },
  menuRowPressed: {
    backgroundColor: c.raised,
  },
  menuRowDisabled: {
    opacity: 0.45,
  },
  menuLabel: {
    ...text.body,
    flexShrink: 1,
    color: c.ink,
  },
  menuLabelDestructive: {
    color: c.red,
  },
  menuMeta: {
    ...text.meta,
    color: c.muted,
  },
  menuNote: {
    ...text.meta,
    paddingVertical: 8,
    color: c.muted,
  },
  menuRule: {
    height: 1,
    marginVertical: 4,
    backgroundColor: c.border,
  },
  sheetBody: {
    ...text.body,
    color: c.muted,
  },
}));
