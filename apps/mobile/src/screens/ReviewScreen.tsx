import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { DocumentProcessingIndicator } from "../components/DocumentProcessingIndicator";
import { Button, Card, EmptyState, ErrorCard, Pill, Screen } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import type { AppStackParamList } from "../../App";
import { colors } from "../theme";
import { responseToMessage, titleForDocument, type ReviewQueueResponse } from "../lib";

export function ReviewScreen() {
  const auth = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const reviewQuery = useQuery({
    queryKey: ["review", auth.apiUrl],
    queryFn: async () => {
      const response = await auth.authFetch("/api/documents/review?page=1&pageSize=25");
      if (!response.ok) {
        throw new Error("Failed to load the review queue.");
      }
      return (await response.json()) as ReviewQueueResponse;
    },
    refetchInterval: (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const mutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "resolve" | "requeue" }) => {
      const response = await auth.authFetch(`/api/documents/${id}/review/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "requeue" ? { force: true } : {}),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onSettled: () => setBusyId(null),
  });

  return (
    <Screen includeTopSafeArea={false} title="Review" subtitle="Clear extraction uncertainty, then send documents back through processing when needed.">
      {reviewQuery.isLoading ? <Card><Text style={styles.helper}>Loading the review queue...</Text></Card> : null}
      {reviewQuery.isError ? <ErrorCard message="The review queue could not be loaded." onRetry={() => reviewQuery.refetch()} /> : null}

      {reviewQuery.data ? (
        reviewQuery.data.items.length === 0 ? (
          <EmptyState title="Queue is clear" body="No documents currently need manual review." />
        ) : (
          reviewQuery.data.items.map((document) => (
            <Card key={document.id}>
              <Pressable onPress={() => navigation.navigate("DocumentDetail", { documentId: document.id, title: titleForDocument(document) })}>
                <Text style={styles.title}>{titleForDocument(document)}</Text>
                <Text style={styles.helper}>{document.correspondent?.name ?? "Unfiled"}</Text>
              </Pressable>
              <DocumentProcessingIndicator document={document} />
              <View style={styles.reasonWrap}>
                {document.reviewReasons.map((reason) => (
                  <Pill key={reason} label={reason.replace(/_/g, " ")} tone="warning" />
                ))}
              </View>
              <View style={styles.actionRow}>
                <Button
                  label="Resolve"
                  variant="secondary"
                  loading={busyId === `${document.id}:resolve`}
                  onPress={() => {
                    setBusyId(`${document.id}:resolve`);
                    mutation.mutate({ id: document.id, action: "resolve" });
                  }}
                />
                <Button
                  label="Requeue"
                  loading={busyId === `${document.id}:requeue`}
                  onPress={() => {
                    setBusyId(`${document.id}:requeue`);
                    mutation.mutate({ id: document.id, action: "requeue" });
                  }}
                />
              </View>
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
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.text,
  },
  reasonWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
});
