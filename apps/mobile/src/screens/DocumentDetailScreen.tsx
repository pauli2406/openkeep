import * as Sharing from "expo-sharing";
import { useRoute } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { RouteProp } from "@react-navigation/native";
import { useAuth } from "../auth";
import { Button, Card, EmptyState, ErrorCard, Field, Pill, Screen, SectionTitle } from "../components/ui";
import type { AppStackParamList } from "../../App";
import { colors } from "../theme";
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
} from "../lib";

export function DocumentDetailScreen() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const route = useRoute<RouteProp<AppStackParamList, "DocumentDetail">>();
  const documentId = route.params.documentId;

  const documentQuery = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}`);
      if (!response.ok) {
        throw new Error("Failed to load document detail.");
      }
      return (await response.json()) as ArchiveDocument;
    },
  });

  const textQuery = useQuery({
    queryKey: ["document-text", documentId],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}/text`);
      if (!response.ok) {
        throw new Error("Failed to load OCR text.");
      }
      return (await response.json()) as DocumentTextResponse;
    },
  });

  const historyQuery = useQuery({
    queryKey: ["document-history", documentId],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}/history`);
      if (!response.ok) {
        throw new Error("Failed to load document history.");
      }
      return (await response.json()) as DocumentHistoryResponse;
    },
  });

  const facetsQuery = useQuery({
    queryKey: ["document-facets", auth.apiUrl],
    enabled: documentQuery.isSuccess,
    queryFn: async () => {
      const response = await auth.authFetch("/api/documents/facets");
      if (!response.ok) {
        throw new Error("Failed to load archive facets.");
      }
      return (await response.json()) as {
        correspondents: Array<{ id: string; name: string }>;
        documentTypes: Array<{ id: string; name: string }>;
        tags: Array<{ id: string; name: string }>;
      };
    },
  });

  const initialForm = useMemo(() => ({
    title: documentQuery.data?.title ?? "",
    issueDate: documentQuery.data?.issueDate ?? "",
    dueDate: documentQuery.data?.dueDate ?? "",
    amount: documentQuery.data?.amount?.toString() ?? "",
    currency: documentQuery.data?.currency ?? "",
    referenceNumber: documentQuery.data?.referenceNumber ?? "",
    correspondentId: documentQuery.data?.correspondent?.id ?? "",
    documentTypeId: documentQuery.data?.documentType?.id ?? "",
  }), [documentQuery.data]);
  const [form, setForm] = useState(initialForm);

  useEffect(() => {
    setForm(initialForm);
  }, [initialForm]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim() || undefined,
          issueDate: form.issueDate.trim() || null,
          dueDate: form.dueDate.trim() || null,
          amount: form.amount.trim() ? Number(form.amount) : null,
          currency: form.currency.trim() || null,
          referenceNumber: form.referenceNumber.trim() || null,
          correspondentId: form.correspondentId || null,
          documentTypeId: form.documentTypeId || null,
        }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["review"] }),
      ]);
    },
  });

  const actionMutation = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: object }) => {
      const response = await auth.authFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  async function handleDownload(searchable: boolean) {
    const endpoint = searchable
      ? `/api/documents/${documentId}/download/searchable`
      : `/api/documents/${documentId}/download`;
    const response = await auth.authFetch(endpoint);
    if (!response.ok) {
      throw new Error(await responseToMessage(response));
    }

    const file = await saveDownloadToFile(
      response,
      searchable ? `openkeep-${documentId}-searchable.pdf` : `openkeep-${documentId}`,
    );
    await Sharing.shareAsync(file);
  }

  if (documentQuery.isLoading) {
    return <Screen includeTopSafeArea={false} title="Document" subtitle="Loading detail..."><Card><Text style={styles.helper}>Loading document detail...</Text></Card></Screen>;
  }

  if (documentQuery.isError || !documentQuery.data) {
    return <Screen includeTopSafeArea={false} title="Document" subtitle="Detail unavailable"><ErrorCard message="The document could not be loaded." onRetry={() => documentQuery.refetch()} /></Screen>;
  }

  const document = documentQuery.data;

  return (
    <Screen includeTopSafeArea={false} title={titleForDocument(document)} subtitle={`${document.correspondent?.name ?? "Unfiled"} • ${document.documentType?.name ?? "Document"}`}>
      <Card>
        <View style={styles.statusRow}>
          <Pill label={document.status} tone={toneForStatus(document.status)} />
          <Pill label={document.reviewStatus} tone={toneForStatus(document.reviewStatus)} />
        </View>
        <Text style={styles.metaText}>Created {formatDate(document.createdAt)}</Text>
        <Text style={styles.metaText}>Issue date {formatDate(document.issueDate)}</Text>
        <Text style={styles.metaText}>Due date {formatDate(document.dueDate)}</Text>
        <Text style={styles.metaText}>{formatCurrency(document.amount, document.currency ?? "EUR")}</Text>
        {document.reviewReasons.length > 0 ? (
          <View style={styles.tagRow}>
            {document.reviewReasons.map((reason) => (
              <Pill key={reason} label={reason.replace(/_/g, " ")} tone="warning" />
            ))}
          </View>
        ) : null}
      </Card>

      <SectionTitle title="Actions" hint="Quick mobile controls for download and processing." />
      <Card>
        <Button label="Share original file" variant="secondary" onPress={() => void handleDownload(false)} />
        {document.searchablePdfAvailable ? <Button label="Share searchable PDF" variant="secondary" onPress={() => void handleDownload(true)} /> : null}
        <Button label="Reprocess document" onPress={() => actionMutation.mutate({ path: `/api/documents/${documentId}/reprocess`, body: { force: true } })} loading={actionMutation.isPending} />
        {document.reviewStatus === "pending" ? (
          <Button label="Resolve review" variant="secondary" onPress={() => actionMutation.mutate({ path: `/api/documents/${documentId}/review/resolve` })} loading={actionMutation.isPending} />
        ) : null}
      </Card>

      <SectionTitle title="Corrections" hint="Sticky manual overrides for the highest-value metadata fields." />
      <Card>
        <Field label="Title" value={form.title} onChangeText={(value) => setForm((current) => ({ ...current, title: value }))} />
        <Field label="Issue date" value={form.issueDate} onChangeText={(value) => setForm((current) => ({ ...current, issueDate: value }))} placeholder="YYYY-MM-DD" />
        <Field label="Due date" value={form.dueDate} onChangeText={(value) => setForm((current) => ({ ...current, dueDate: value }))} placeholder="YYYY-MM-DD" />
        <Field label="Amount" value={form.amount} onChangeText={(value) => setForm((current) => ({ ...current, amount: value }))} keyboardType="numeric" />
        <Field label="Currency" value={form.currency} onChangeText={(value) => setForm((current) => ({ ...current, currency: value }))} autoCapitalize="characters" placeholder="EUR" />
        <Field label="Reference number" value={form.referenceNumber} onChangeText={(value) => setForm((current) => ({ ...current, referenceNumber: value }))} />
        {facetsQuery.data ? (
          <>
            <Field
              label="Correspondent ID"
              value={form.correspondentId}
              onChangeText={(value) => setForm((current) => ({ ...current, correspondentId: value }))}
              placeholder={facetsQuery.data.correspondents[0]?.name ? `e.g. ${facetsQuery.data.correspondents[0].name}` : "Correspondent UUID"}
            />
            <Field
              label="Document type ID"
              value={form.documentTypeId}
              onChangeText={(value) => setForm((current) => ({ ...current, documentTypeId: value }))}
              placeholder={facetsQuery.data.documentTypes[0]?.name ? `e.g. ${facetsQuery.data.documentTypes[0].name}` : "Document type UUID"}
            />
          </>
        ) : null}
        <Button label="Save corrections" onPress={() => updateMutation.mutate()} loading={updateMutation.isPending} />
        {updateMutation.isError ? <Text style={styles.error}>{updateMutation.error instanceof Error ? updateMutation.error.message : "Failed to save changes."}</Text> : null}
      </Card>

      <SectionTitle title="OCR text" hint="The first mobile release focuses on readable extracted text rather than a heavy inline preview surface." />
      {textQuery.isLoading ? <Card><Text style={styles.helper}>Loading OCR text...</Text></Card> : null}
      {textQuery.data ? (
        textQuery.data.blocks.length === 0 ? (
          <EmptyState title="No OCR text yet" body="The processing pipeline may still be running or the document had no readable text." />
        ) : (
          <Card>
            <Text style={styles.ocrText}>{textQuery.data.blocks.slice(0, 80).map((block) => block.text).join(" ")}</Text>
          </Card>
        )
      ) : null}

      <SectionTitle title="History" hint="Audit entries from upload, processing, and manual edits." />
      {historyQuery.data ? (
        historyQuery.data.items.length === 0 ? (
          <EmptyState title="No history yet" body="OpenKeep has not recorded any audit events for this document yet." />
        ) : (
          historyQuery.data.items.slice(0, 10).map((item) => (
            <Card key={item.id}>
              <Text style={styles.historyTitle}>{item.eventType}</Text>
              <Text style={styles.helper}>{formatDate(item.createdAt)}</Text>
              <Text style={styles.metaText}>{item.actorDisplayName ?? item.actorEmail ?? "System"}</Text>
            </Card>
          ))
        )
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  helper: {
    color: colors.muted,
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  metaText: {
    color: colors.text,
    lineHeight: 20,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  error: {
    color: colors.danger,
  },
  ocrText: {
    color: colors.text,
    lineHeight: 22,
  },
  historyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
});
