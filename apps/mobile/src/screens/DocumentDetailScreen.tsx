import * as Sharing from "expo-sharing";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { DocumentViewer } from "../components/DocumentViewer";
import { useDocumentQa } from "../hooks/useDocumentQa";
import { useDocumentSummary } from "../hooks/useDocumentSummary";
import type { AppStackParamList } from "../../App";
import { colors, shadow } from "../theme";
import {
  formatCurrency,
  formatDate,
  responseToMessage,
  saveDownloadToFile,
  toneForStatus,
  titleForDocument,
  type ArchiveDocument,
  type DocumentHistoryResponse,
  type DocumentTextResponse,
  type HealthProvidersResponse,
  type ParseProvider,
  type QaHistoryEntry,
} from "../lib";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type TabKey = "preview" | "overview" | "insights" | "activity";

const TABS: { key: TabKey; label: string }[] = [
  { key: "preview", label: "Preview" },
  { key: "overview", label: "Overview" },
  { key: "insights", label: "Insights" },
  { key: "activity", label: "Activity" },
];

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export function DocumentDetailScreen() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const route = useRoute<RouteProp<AppStackParamList, "DocumentDetail">>();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const documentId = route.params.documentId;

  const [activeTab, setActiveTab] = useState<TabKey>("preview");

  // ---- Core queries ----
  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}`);
      if (!response.ok) throw new Error("Failed to load document detail.");
      return (await response.json()) as ArchiveDocument;
    },
  });

  const textQuery = useQuery({
    queryKey: ["document-text", documentId],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}/text`);
      if (!response.ok) throw new Error("Failed to load OCR text.");
      return (await response.json()) as DocumentTextResponse;
    },
  });

  const historyQuery = useQuery({
    queryKey: ["document-history", documentId],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}/history`);
      if (!response.ok) throw new Error("Failed to load document history.");
      return (await response.json()) as DocumentHistoryResponse;
    },
  });

  const facetsQuery = useQuery({
    queryKey: ["document-facets", auth.apiUrl],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      const response = await auth.authFetch("/api/documents/facets");
      if (!response.ok) throw new Error("Failed to load archive facets.");
      return (await response.json()) as {
        correspondents: Array<{ id: string; name: string; slug: string }>;
        documentTypes: Array<{ id: string; name: string; slug: string }>;
        tags: Array<{ id: string; name: string; slug: string }>;
      };
    },
  });

  const providersQuery = useQuery({
    queryKey: ["health-providers", auth.apiUrl],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      const response = await auth.authFetch("/api/health/providers");
      if (!response.ok) throw new Error("Failed to load providers.");
      return (await response.json()) as HealthProvidersResponse;
    },
  });

  const qaHistoryQuery = useQuery({
    queryKey: ["document-qa-history", documentId],
    enabled: documentQuery.isSuccess && activeTab === "insights",
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}/qa-history`);
      if (!response.ok) throw new Error("Failed to load Q&A history.");
      return (await response.json()) as QaHistoryEntry[];
    },
  });

  // ---- Loading / error ----
  if (documentQuery.isLoading) {
    return (
      <ScreenShell title="Document" subtitle="Loading...">
        <Card>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.helper}>Loading document detail...</Text>
        </Card>
      </ScreenShell>
    );
  }

  if (documentQuery.isError || !documentQuery.data) {
    return (
      <ScreenShell title="Document" subtitle="Unavailable">
        <ErrorCard message="The document could not be loaded." onRetry={() => documentQuery.refetch()} />
      </ScreenShell>
    );
  }

  const document = documentQuery.data;

  return (
    <ScreenShell
      title={titleForDocument(document)}
      subtitle={`${document.correspondent?.name ?? "Unfiled"} \u00B7 ${document.documentType?.name ?? "Document"}`}
    >
      {/* Status row */}
      <View style={styles.statusRow}>
        <Pill label={document.status} tone={toneForStatus(document.status)} />
        <Pill label={document.reviewStatus} tone={toneForStatus(document.reviewStatus)} />
        {document.confidence !== null && document.confidence !== undefined && (
          <Pill
            label={`${Math.round(document.confidence * 100)}% conf`}
            tone={document.confidence >= 0.8 ? "success" : document.confidence >= 0.5 ? "warning" : "danger"}
          />
        )}
      </View>

      {/* Tab bar */}
      <SegmentedTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === "preview" && (
        <PreviewTab
          document={document}
          authFetch={auth.authFetch}
          textBlocks={textQuery.data?.blocks}
        />
      )}
      {activeTab === "overview" && (
        <OverviewTab
          document={document}
          authFetch={auth.authFetch}
          queryClient={queryClient}
          documentId={documentId}
          facets={facetsQuery.data ?? null}
          providers={providersQuery.data ?? null}
          navigation={navigation}
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
              <Text style={styles.eyebrow}>OpenKeep mobile</Text>
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
  return (
    <View style={styles.tabBar}>
      {TABS.map((tab) => {
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
  textBlocks,
}: {
  document: ArchiveDocument;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  textBlocks?: Array<{ page: number; text: string }>;
}) {
  return (
    <>
      <Card>
        <DocumentViewer
          authFetch={authFetch}
          documentId={document.id}
          mimeType={document.mimeType}
          searchablePdfAvailable={document.searchablePdfAvailable}
          textBlocks={textBlocks}
        />
      </Card>
      {/* Quick metadata summary below preview */}
      <Card>
        <Text style={styles.metaText}>
          <Text style={styles.metaLabel}>Type: </Text>
          {document.mimeType}
        </Text>
        {document.metadata?.pageCount != null && (
          <Text style={styles.metaText}>
            <Text style={styles.metaLabel}>Pages: </Text>
            {document.metadata.pageCount}
          </Text>
        )}
        <Text style={styles.metaText}>
          <Text style={styles.metaLabel}>Created: </Text>
          {formatDate(document.createdAt)}
        </Text>
        {document.processedAt && (
          <Text style={styles.metaText}>
            <Text style={styles.metaLabel}>Processed: </Text>
            {formatDate(document.processedAt)}
          </Text>
        )}
        {document.parseProvider && (
          <Text style={styles.metaText}>
            <Text style={styles.metaLabel}>Parse provider: </Text>
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

function OverviewTab({
  document,
  authFetch,
  queryClient,
  documentId,
  facets,
  providers,
  navigation,
}: {
  document: ArchiveDocument;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  queryClient: ReturnType<typeof useQueryClient>;
  documentId: string;
  facets: {
    correspondents: Array<{ id: string; name: string; slug: string }>;
    documentTypes: Array<{ id: string; name: string; slug: string }>;
    tags: Array<{ id: string; name: string; slug: string }>;
  } | null;
  providers: HealthProvidersResponse | null;
  navigation: NativeStackNavigationProp<AppStackParamList>;
}) {
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
  useEffect(() => setForm(initialForm), [initialForm]);

  const [reprocessProvider, setReprocessProvider] = useState<ParseProvider | "default">("default");

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
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

  async function handleDownload(searchable: boolean) {
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
      "Delete document",
      "This will permanently remove this document and all associated data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
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
  const correspondentName = facets?.correspondents.find((c) => c.id === form.correspondentId)?.name ?? "";
  const docTypeName = facets?.documentTypes.find((d) => d.id === form.documentTypeId)?.name ?? "";

  // ---- Available providers ----
  const availableProviders = providers?.parseProviders?.filter((p) => p.available) ?? [];

  return (
    <>
      {/* Review banner */}
      {document.reviewStatus === "pending" && (
        <Card style={styles.reviewBanner}>
          <Text style={styles.reviewBannerTitle}>Needs review</Text>
          {document.reviewReasons.length > 0 && (
            <View style={styles.tagRow}>
              {document.reviewReasons.map((reason) => (
                <Pill key={reason} label={reason.replace(/_/g, " ")} tone="warning" />
              ))}
            </View>
          )}
          <View style={styles.reviewActions}>
            <Button
              label="Resolve"
              variant="primary"
              onPress={() =>
                actionMutation.mutate({
                  path: `/api/documents/${documentId}/review/resolve`,
                })
              }
              loading={actionMutation.isPending}
            />
            <Button
              label="Requeue"
              variant="secondary"
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
          <Text style={styles.errorBannerTitle}>Processing error</Text>
          <Text style={styles.errorBannerBody}>{document.lastProcessingError}</Text>
        </Card>
      )}

      {/* Quick info */}
      <SectionTitle title="Details" />
      <Card>
        <MetaRow label="Issue date" value={formatDate(document.issueDate)} />
        <MetaRow label="Due date" value={formatDate(document.dueDate)} />
        {document.expiryDate && <MetaRow label="Expiry date" value={formatDate(document.expiryDate)} />}
        <MetaRow label="Amount" value={formatCurrency(document.amount, document.currency ?? "EUR")} />
        {document.referenceNumber && <MetaRow label="Reference" value={document.referenceNumber} />}
        {document.holderName && <MetaRow label="Holder" value={document.holderName} />}
        {document.issuingAuthority && <MetaRow label="Authority" value={document.issuingAuthority} />}
        {document.tags.length > 0 && (
          <View style={styles.tagRow}>
            {document.tags.map((tag) => (
              <Pill key={tag.id} label={tag.name} tone="default" />
            ))}
          </View>
        )}
      </Card>

      {/* Metadata editing */}
      <SectionTitle title="Edit metadata" hint="Fields with a lock icon have manual overrides that persist through reprocessing." />
      <Card>
        <Field
          label={`Title${lockedFields.includes("correspondentId") ? " \uD83D\uDD12" : ""}`}
          value={form.title}
          onChangeText={(v) => setForm((s) => ({ ...s, title: v }))}
        />
        <Field
          label={`Issue date${lockedFields.includes("issueDate") ? " \uD83D\uDD12" : ""}`}
          value={form.issueDate}
          onChangeText={(v) => setForm((s) => ({ ...s, issueDate: v }))}
          placeholder="YYYY-MM-DD"
        />
        <Field
          label={`Due date${lockedFields.includes("dueDate") ? " \uD83D\uDD12" : ""}`}
          value={form.dueDate}
          onChangeText={(v) => setForm((s) => ({ ...s, dueDate: v }))}
          placeholder="YYYY-MM-DD"
        />
        <Field
          label={`Expiry date${lockedFields.includes("expiryDate") ? " \uD83D\uDD12" : ""}`}
          value={form.expiryDate}
          onChangeText={(v) => setForm((s) => ({ ...s, expiryDate: v }))}
          placeholder="YYYY-MM-DD"
        />
        <Field
          label={`Amount${lockedFields.includes("amount") ? " \uD83D\uDD12" : ""}`}
          value={form.amount}
          onChangeText={(v) => setForm((s) => ({ ...s, amount: v }))}
          keyboardType="numeric"
        />
        <Field
          label={`Currency${lockedFields.includes("currency") ? " \uD83D\uDD12" : ""}`}
          value={form.currency}
          onChangeText={(v) => setForm((s) => ({ ...s, currency: v }))}
          autoCapitalize="characters"
          placeholder="EUR"
        />
        <Field
          label={`Reference number${lockedFields.includes("referenceNumber") ? " \uD83D\uDD12" : ""}`}
          value={form.referenceNumber}
          onChangeText={(v) => setForm((s) => ({ ...s, referenceNumber: v }))}
        />
        <Field
          label={`Holder name${lockedFields.includes("holderName") ? " \uD83D\uDD12" : ""}`}
          value={form.holderName}
          onChangeText={(v) => setForm((s) => ({ ...s, holderName: v }))}
        />
        <Field
          label={`Issuing authority${lockedFields.includes("issuingAuthority") ? " \uD83D\uDD12" : ""}`}
          value={form.issuingAuthority}
          onChangeText={(v) => setForm((s) => ({ ...s, issuingAuthority: v }))}
        />

        {/* Correspondent picker */}
        {facets && (
          <PickerField
            label={`Correspondent${lockedFields.includes("correspondentId") ? " \uD83D\uDD12" : ""}`}
            selectedId={form.correspondentId}
            options={facets.correspondents.map((c) => ({ id: c.id, label: c.name }))}
            onSelect={(id) => setForm((s) => ({ ...s, correspondentId: id }))}
            placeholder="Select correspondent"
          />
        )}

        {/* Document type picker */}
        {facets && (
          <PickerField
            label={`Document type${lockedFields.includes("documentTypeId") ? " \uD83D\uDD12" : ""}`}
            selectedId={form.documentTypeId}
            options={facets.documentTypes.map((d) => ({ id: d.id, label: d.name }))}
            onSelect={(id) => setForm((s) => ({ ...s, documentTypeId: id }))}
            placeholder="Select document type"
          />
        )}

        {/* Tags picker */}
        {facets && (
          <TagsPicker
            label="Tags"
            selectedIds={form.tagIds}
            options={facets.tags.map((t) => ({ id: t.id, label: t.name }))}
            onToggle={(id) =>
              setForm((s) => ({
                ...s,
                tagIds: s.tagIds.includes(id) ? s.tagIds.filter((i) => i !== id) : [...s.tagIds, id],
              }))
            }
          />
        )}

        <Button label="Save changes" onPress={() => updateMutation.mutate()} loading={updateMutation.isPending} />
        {updateMutation.isError && (
          <Text style={styles.error}>
            {updateMutation.error instanceof Error ? updateMutation.error.message : "Failed to save."}
          </Text>
        )}

        {/* Clear overrides hint */}
        {lockedFields.length > 0 && (
          <Text style={styles.hintText}>
            {lockedFields.length} field{lockedFields.length > 1 ? "s" : ""} locked by manual overrides. These persist through reprocessing.
          </Text>
        )}
      </Card>

      {/* Actions */}
      <SectionTitle title="Actions" />
      <Card>
        <Button label="Share original file" variant="secondary" onPress={() => void handleDownload(false)} />
        {document.searchablePdfAvailable && (
          <Button label="Share searchable PDF" variant="secondary" onPress={() => void handleDownload(true)} />
        )}

        {/* Reprocess with provider picker */}
        {availableProviders.length > 1 && (
          <View style={styles.reprocessRow}>
            <Text style={styles.fieldLabelSmall}>Reprocess with:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.providerScroll}>
              <Pressable
                onPress={() => setReprocessProvider("default")}
                style={[styles.providerChip, reprocessProvider === "default" && styles.providerChipActive]}
              >
                <Text style={[styles.providerChipText, reprocessProvider === "default" && styles.providerChipTextActive]}>
                  Default
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
          label="Reprocess document"
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
        />

        {/* Processing job status */}
        {document.latestProcessingJob && (
          <View style={styles.jobStatus}>
            <Text style={styles.jobStatusLabel}>Latest job:</Text>
            <Pill label={document.latestProcessingJob.status} tone={toneForStatus(document.latestProcessingJob.status)} />
            {document.latestProcessingJob.lastError && (
              <Text style={styles.jobError} numberOfLines={3}>{document.latestProcessingJob.lastError}</Text>
            )}
          </View>
        )}

        {/* Danger zone */}
        <View style={styles.dangerZone}>
          <Button label="Delete document" variant="danger" onPress={confirmDelete} loading={deleteMutation.isPending} />
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
  authFetch,
  qaHistory,
  refetchQaHistory,
}: {
  document: ArchiveDocument;
  documentId: string;
  streamFetch: (path: string, init?: RequestInit) => Promise<Response>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  qaHistory: QaHistoryEntry[];
  refetchQaHistory: () => void;
}) {
  const summary = useDocumentSummary(streamFetch, documentId);
  const qa = useDocumentQa(streamFetch, documentId);
  const [qaQuestion, setQaQuestion] = useState("");

  const intelligence = document.metadata?.intelligence;

  const handleAsk = useCallback(() => {
    const q = qaQuestion.trim();
    if (!q) return;
    qa.ask(q);
  }, [qaQuestion, qa]);

  const saveQaEntry = useCallback(async () => {
    if (qa.status !== "done" || !qa.answerText) return;
    try {
      await authFetch(`/api/documents/${documentId}/qa-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: qaQuestion,
          answer: qa.answerText,
          citations: qa.citations,
        }),
      });
      refetchQaHistory();
    } catch {
      // silent failure
    }
  }, [qa, qaQuestion, authFetch, documentId, refetchQaHistory]);

  return (
    <>
      {/* Summary section */}
      <SectionTitle title="Summary" hint="AI-generated document summary." />
      <Card>
        {summary.status === "idle" && (
          <Button label="Generate summary" variant="secondary" onPress={() => summary.generate()} />
        )}
        {summary.status === "streaming" && (
          <>
            <Markdown style={markdownStyles}>{summary.summaryText || "Generating..."}</Markdown>
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          </>
        )}
        {summary.status === "done" && summary.summaryText && (
          <>
            <Markdown style={markdownStyles}>{summary.summaryText}</Markdown>
            {summary.isCached && <Text style={styles.hintText}>Cached summary</Text>}
            {summary.provider && (
              <Text style={styles.hintText}>
                {summary.provider}{summary.model ? ` / ${summary.model}` : ""}
              </Text>
            )}
            <Button label="Regenerate" variant="secondary" onPress={() => summary.generate(true)} />
          </>
        )}
        {summary.status === "error" && (
          <>
            <Text style={styles.error}>{summary.errorMessage}</Text>
            <Button label="Retry" variant="secondary" onPress={() => summary.generate()} />
          </>
        )}
      </Card>

      {/* Intelligence metadata */}
      {intelligence && (
        <>
          <SectionTitle title="Intelligence" hint="Extraction pipeline metadata." />
          <Card>
            {intelligence.routing && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>Routing</Text>
                <Text style={styles.metaText}>
                  Type: {intelligence.routing.documentType ?? "Unknown"}
                  {intelligence.routing.subtype ? ` / ${intelligence.routing.subtype}` : ""}
                </Text>
                {intelligence.routing.confidence != null && (
                  <Text style={styles.metaText}>
                    Confidence: {Math.round(intelligence.routing.confidence * 100)}%
                  </Text>
                )}
                {intelligence.routing.reasoningHints && intelligence.routing.reasoningHints.length > 0 && (
                  <Text style={styles.hintText}>
                    Hints: {intelligence.routing.reasoningHints.join(", ")}
                  </Text>
                )}
              </View>
            )}

            {intelligence.title && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>Title extraction</Text>
                <Text style={styles.metaText}>{intelligence.title.value ?? "None"}</Text>
                {intelligence.title.confidence != null && (
                  <Text style={styles.hintText}>{Math.round(intelligence.title.confidence * 100)}% confidence</Text>
                )}
              </View>
            )}

            {intelligence.extraction && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>Field extraction</Text>
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
                <Text style={styles.intelLabel}>Suggested tags</Text>
                <View style={styles.tagRow}>
                  {intelligence.tagging.tags.map((tag) => (
                    <Pill key={tag} label={tag} tone="default" />
                  ))}
                </View>
              </View>
            )}

            {intelligence.validation && (intelligence.validation.errors.length > 0 || intelligence.validation.warnings.length > 0) && (
              <View style={styles.intelSection}>
                <Text style={styles.intelLabel}>Validation</Text>
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
                <Text style={styles.intelLabel}>Pipeline</Text>
                {intelligence.pipeline.framework && <Text style={styles.hintText}>Framework: {intelligence.pipeline.framework}</Text>}
                {intelligence.pipeline.status && <Text style={styles.hintText}>Status: {intelligence.pipeline.status}</Text>}
                {Object.keys(intelligence.pipeline.durationsMs).length > 0 && (
                  <Text style={styles.hintText}>
                    Durations: {Object.entries(intelligence.pipeline.durationsMs).map(([k, v]) => `${k}: ${v}ms`).join(", ")}
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
          <SectionTitle title="Review evidence" />
          <Card>
            <Text style={styles.metaText}>
              <Text style={styles.metaLabel}>Document class: </Text>
              {document.metadata.reviewEvidence.documentClass}
            </Text>
            {document.metadata.reviewEvidence.missingFields.length > 0 && (
              <View>
                <Text style={styles.intelLabel}>Missing fields</Text>
                <View style={styles.tagRow}>
                  {document.metadata.reviewEvidence.missingFields.map((f) => (
                    <Pill key={f} label={f} tone="warning" />
                  ))}
                </View>
              </View>
            )}
            {document.metadata.reviewEvidence.confidence != null && (
              <Text style={styles.metaText}>
                <Text style={styles.metaLabel}>Confidence: </Text>
                {Math.round(document.metadata.reviewEvidence.confidence * 100)}%
                {document.metadata.reviewEvidence.confidenceThreshold != null &&
                  ` (threshold: ${Math.round(document.metadata.reviewEvidence.confidenceThreshold * 100)}%)`}
              </Text>
            )}
          </Card>
        </>
      )}

      {/* Document Q&A */}
      <SectionTitle title="Ask this document" hint="Ask questions about this specific document." />
      <Card>
        <View style={styles.qaInputRow}>
          <TextInput
            style={styles.qaInput}
            value={qaQuestion}
            onChangeText={setQaQuestion}
            placeholder="Ask a question..."
            placeholderTextColor={colors.muted}
            multiline
            returnKeyType="send"
            onSubmitEditing={handleAsk}
          />
          <Pressable
            onPress={handleAsk}
            disabled={qa.status === "streaming" || !qaQuestion.trim()}
            style={({ pressed }) => [
              styles.qaButton,
              pressed && styles.qaButtonPressed,
              (qa.status === "streaming" || !qaQuestion.trim()) && styles.qaButtonDisabled,
            ]}
          >
            {qa.status === "streaming" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.qaButtonText}>Ask</Text>
            )}
          </Pressable>
        </View>

        {qa.status === "streaming" && (
          <View style={styles.qaAnswer}>
            <Markdown style={markdownStyles}>{qa.answerText || "Thinking..."}</Markdown>
          </View>
        )}

        {qa.status === "done" && qa.answerText && (
          <View style={styles.qaAnswer}>
            <Markdown style={markdownStyles}>{qa.answerText}</Markdown>
            {qa.citations.length > 0 && (
              <View style={styles.citationsWrap}>
                <Text style={styles.intelLabel}>Sources</Text>
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
            <Button label="Save to history" variant="secondary" onPress={() => void saveQaEntry()} />
          </View>
        )}

        {qa.status === "error" && (
          <Text style={styles.error}>{qa.errorMessage}</Text>
        )}
      </Card>

      {/* Q&A history */}
      {qaHistory.length > 0 && (
        <>
          <SectionTitle title="Q&A history" />
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
      <SectionTitle title="OCR text" hint="Extracted text grouped by page." />
      {textQuery.isLoading && (
        <Card>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.helper}>Loading OCR text...</Text>
        </Card>
      )}
      {textQuery.data && pageGroups.length === 0 && (
        <EmptyState title="No OCR text" body="No readable text was extracted from this document." />
      )}
      {pageGroups.map(({ page, text }) => (
        <Card key={page}>
          <Text style={styles.pageLabel}>Page {page}</Text>
          <Text style={styles.ocrText} selectable>{text}</Text>
        </Card>
      ))}

      {/* Audit history timeline */}
      <SectionTitle title="History" hint="Audit trail of document events." />
      {historyQuery.isLoading && (
        <Card>
          <ActivityIndicator color={colors.primary} />
        </Card>
      )}
      {historyQuery.data && historyQuery.data.items.length === 0 && (
        <EmptyState title="No history" body="No audit events recorded for this document yet." />
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
                  {formatDate(item.createdAt)} \u00B7 {item.actorDisplayName ?? item.actorEmail ?? "System"}
                </Text>
                {hasPayload && (
                  <Text style={styles.expandHint}>{isExpanded ? "Collapse" : "Tap to expand"}</Text>
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

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

function PickerField({
  label,
  selectedId,
  options,
  onSelect,
  placeholder,
}: {
  label: string;
  selectedId: string;
  options: Array<{ id: string; label: string }>;
  onSelect: (id: string) => void;
  placeholder: string;
}) {
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
            placeholder="Filter..."
            placeholderTextColor={colors.muted}
          />
          {/* Clear option */}
          <Pressable
            onPress={() => {
              onSelect("");
              setOpen(false);
              setSearch("");
            }}
            style={styles.pickerOption}
          >
            <Text style={[styles.pickerOptionText, styles.pickerOptionClear]}>None</Text>
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

const markdownStyles = StyleSheet.create({
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  strong: {
    fontWeight: "800" as const,
  },
  code_inline: {
    backgroundColor: colors.surfaceMuted,
    color: colors.textSoft,
    fontSize: 13,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bullet_list_icon: {
    color: colors.primary,
    fontSize: 8,
    marginTop: 8,
    marginRight: 8,
  },
  list_item: {
    flexDirection: "row" as const,
    marginBottom: 4,
  },
});

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  title: {
    fontSize: 26,
    lineHeight: 31,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },

  // Tab bar
  tabBar: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
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
    backgroundColor: colors.surface,
    ...shadow,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: colors.text,
  },

  // Shared
  helper: {
    color: colors.muted,
    textAlign: "center",
  },
  error: {
    color: colors.danger,
    fontSize: 14,
  },
  hintText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  metaText: {
    color: colors.text,
    lineHeight: 20,
    fontSize: 14,
  },
  metaLabel: {
    fontWeight: "700",
    color: colors.textSoft,
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
  metaValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
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
    borderColor: colors.warning,
    borderWidth: 1.5,
  },
  reviewBannerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.warning,
  },
  reviewActions: {
    flexDirection: "row",
    gap: 10,
  },

  // Error banner
  errorBanner: {
    borderColor: colors.danger,
    borderWidth: 1.5,
  },
  errorBannerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.danger,
  },
  errorBannerBody: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
  },

  // Reprocess provider picker
  reprocessRow: {
    gap: 8,
  },
  fieldLabelSmall: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSoft,
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
    backgroundColor: colors.surfaceMuted,
    marginRight: 8,
  },
  providerChipActive: {
    backgroundColor: colors.primary,
  },
  providerChipText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSoft,
    textTransform: "capitalize",
  },
  providerChipTextActive: {
    color: "#fff",
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
    fontWeight: "700",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  jobError: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },

  // Danger zone
  dangerZone: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  // Picker
  fieldWrap: {
    gap: 9,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSoft,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  pickerButton: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerButtonText: {
    fontSize: 17,
    color: colors.text,
    flex: 1,
  },
  pickerPlaceholder: {
    color: colors.muted,
  },
  pickerChevron: {
    color: colors.muted,
    fontSize: 12,
    marginLeft: 8,
  },
  pickerDropdown: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  pickerSearch: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    fontSize: 15,
    color: colors.text,
  },
  pickerList: {
    maxHeight: 200,
  },
  pickerOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  pickerOptionSelected: {
    backgroundColor: colors.primarySoft,
  },
  pickerOptionText: {
    fontSize: 15,
    color: colors.text,
  },
  pickerOptionTextSelected: {
    color: colors.primary,
    fontWeight: "700",
  },
  pickerOptionClear: {
    color: colors.muted,
    fontStyle: "italic",
  },

  // Intelligence
  intelSection: {
    gap: 4,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  intelLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.accent,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  validationError: {
    color: colors.danger,
    fontSize: 13,
    lineHeight: 18,
  },
  validationWarning: {
    color: colors.warning,
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
    flex: 1,
    minHeight: 48,
    maxHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    lineHeight: 20,
  },
  qaButton: {
    width: 54,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primary,
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
    color: "#fff",
    fontWeight: "800",
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
    borderTopColor: colors.border,
  },
  qaHistoryQuestion: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 21,
  },

  // OCR
  pageLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.accent,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  ocrText: {
    color: colors.text,
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
    backgroundColor: colors.primarySoft,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 20,
    gap: 2,
  },
  historyTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.text,
  },
  historyMeta: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 17,
  },
  expandHint: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: "600",
    marginTop: 2,
  },
  payloadWrap: {
    marginTop: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  payloadLine: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 17,
  },
});
