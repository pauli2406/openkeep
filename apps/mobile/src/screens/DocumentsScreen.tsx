import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { Card, EmptyState, ErrorCard, Field, Pill, Screen, SectionTitle } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import type { AppStackParamList } from "../../App";
import { colors } from "../theme";
import { formatCurrency, formatDate, titleForDocument, type SearchDocumentsResponse } from "../lib";

const statuses = ["all", "pending", "processing", "ready", "failed"] as const;

export function DocumentsScreen() {
  const auth = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<(typeof statuses)[number]>("all");
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
    queryKey: ["documents", auth.apiUrl, params],
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents?${params}`);
      if (!response.ok) {
        throw new Error("Failed to load documents.");
      }
      return (await response.json()) as SearchDocumentsResponse;
    },
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  return (
    <Screen title="Documents" subtitle="Search across your archive and jump straight into document detail.">
      <Card>
        <Field label="Query" value={query} onChangeText={setQuery} placeholder="Search title, OCR text, or metadata" />
        <SectionTitle title="Status" hint="A light mobile filter for the first MVP release." />
        <View style={styles.filterRow}>
          {statuses.map((value) => (
            <Pressable key={value} onPress={() => setStatus(value)} style={[styles.filterChip, status === value ? styles.filterChipActive : null]}>
              <Text style={[styles.filterText, status === value ? styles.filterTextActive : null]}>{value}</Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {documentsQuery.isLoading ? <Card><Text style={styles.helper}>Loading documents...</Text></Card> : null}
      {documentsQuery.isError ? <ErrorCard message="Your documents could not be loaded." onRetry={() => documentsQuery.refetch()} /> : null}

      {documentsQuery.data ? (
        <>
          <SectionTitle title={`${documentsQuery.data.total} results`} hint="Tap a document to inspect OCR, metadata, history, and actions." />
          {documentsQuery.data.items.length === 0 ? (
            <EmptyState title="No documents found" body="Try a different query or clear the status filter." />
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
                    <Pill label={document.status} tone={document.status === "ready" ? "success" : document.status === "failed" ? "danger" : "warning"} />
                  </View>
                  <DocumentProcessingIndicator document={document} />
                  <Text style={styles.helper}>{document.correspondent?.name ?? "Unfiled"} • {document.documentType?.name ?? "Document"}</Text>
                  <Text style={styles.detailLine}>Created {formatDate(document.createdAt)}</Text>
                  <Text style={styles.detailLine}>{formatCurrency(document.amount, document.currency ?? "EUR")}</Text>
                  {document.reviewStatus === "pending" ? <Pill label="Needs review" tone="warning" /> : null}
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
