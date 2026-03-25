import { useNavigation } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { Button, Card, EmptyState, ErrorCard, Field, Pill, Screen, SectionTitle } from "../components/ui";
import type { AppStackParamList } from "../../App";
import { colors } from "../theme";
import { responseToMessage, titleForDocument, type AnswerQueryResponse, type SemanticSearchResponse } from "../lib";

export function SearchScreen() {
  const auth = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [query, setQuery] = useState("");

  const semanticMutation = useMutation({
    mutationFn: async () => {
      const response = await auth.authFetch("/api/search/semantic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, page: 1, pageSize: 10, maxChunkMatches: 3 }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
      return (await response.json()) as SemanticSearchResponse;
    },
  });

  const answerMutation = useMutation({
    mutationFn: async () => {
      const response = await auth.authFetch("/api/search/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, maxDocuments: 5, maxCitations: 6, maxChunkMatches: 6 }),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
      return (await response.json()) as AnswerQueryResponse;
    },
  });

  async function runSearch() {
    if (!query.trim()) {
      return;
    }
    await Promise.all([semanticMutation.mutateAsync(), answerMutation.mutateAsync()]);
  }

  return (
    <Screen title="Search" subtitle="Run hybrid search across the archive and get a grounded answer with citations.">
      <Card>
        <Field label="Ask your archive" value={query} onChangeText={setQuery} placeholder="What documents mention a contract end date?" multiline />
        <Button label="Search and answer" onPress={() => void runSearch()} loading={semanticMutation.isPending || answerMutation.isPending} />
      </Card>

      {(semanticMutation.isError || answerMutation.isError) ? (
        <ErrorCard
          message={(semanticMutation.error instanceof Error ? semanticMutation.error.message : "") || (answerMutation.error instanceof Error ? answerMutation.error.message : "Search failed.")}
        />
      ) : null}

      {answerMutation.data ? (
        <>
          <SectionTitle title="AI answer" hint="Grounded on matching documents and excerpts." />
          <Card>
            <Pill label={answerMutation.data.status === "answered" ? "Answered" : "Need more evidence"} tone={answerMutation.data.status === "answered" ? "success" : "warning"} />
            <Text style={styles.answerText}>{answerMutation.data.answer ?? "OpenKeep could not answer this confidently from the current evidence."}</Text>
            {answerMutation.data.citations.map((citation) => (
              <Pressable
                key={`${citation.documentId}-${citation.chunkIndex}`}
                onPress={() => navigation.navigate("DocumentDetail", { documentId: citation.documentId, title: citation.documentTitle })}
              >
                <Card style={styles.innerCard}>
                  <Text style={styles.citationTitle}>{citation.documentTitle}</Text>
                  <Text style={styles.citationBody}>{citation.quote}</Text>
                </Card>
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title="Matching documents" hint="Semantic retrieval results ranked by relevance." />
      {semanticMutation.data ? (
        semanticMutation.data.items.length === 0 ? (
          <EmptyState title="No results" body="Try a narrower question or a more exact phrase." />
        ) : (
          semanticMutation.data.items.map((result) => (
            <Pressable
              key={result.document.id}
              onPress={() => navigation.navigate("DocumentDetail", { documentId: result.document.id, title: titleForDocument(result.document) })}
            >
              <Card>
                <View style={styles.rowTop}>
                  <Text style={styles.resultTitle}>{titleForDocument(result.document)}</Text>
                  <Pill label={result.score.toFixed(2)} tone="default" />
                </View>
                <Text style={styles.resultMeta}>{result.document.correspondent?.name ?? "Unfiled"}</Text>
                {result.matchedChunks[0] ? <Text style={styles.resultSnippet}>{result.matchedChunks[0].text}</Text> : null}
              </Card>
            </Pressable>
          ))
        )
      ) : (
        <EmptyState title="Ready when you are" body="Ask a question to search OCR text, metadata, and semantic matches together." />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  answerText: {
    color: colors.text,
    lineHeight: 22,
    fontSize: 15,
  },
  innerCard: {
    padding: 14,
    backgroundColor: colors.surfaceMuted,
  },
  citationTitle: {
    fontWeight: "800",
    color: colors.text,
  },
  citationBody: {
    color: colors.text,
    lineHeight: 20,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  resultTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  resultMeta: {
    color: colors.muted,
  },
  resultSnippet: {
    color: colors.text,
    lineHeight: 20,
  },
});
