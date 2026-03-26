import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { Card, EmptyState, ErrorCard, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { colors, shadow } from "../theme";
import type { FacetsResponse } from "../lib";

// ---------------------------------------------------------------------------
// Correspondents Screen
// ---------------------------------------------------------------------------

export function CorrespondentsScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  const facetsQuery = useQuery({
    queryKey: ["document-facets", auth.apiUrl, offline.shouldUseOffline, offline.summary?.lastSyncedAt],
    queryFn: async () => {
      if (offline.shouldUseOffline) {
        const cached = await offline.loadFacets();
        if (!cached) {
          throw new Error(t("correspondents.loadError"));
        }
        return cached;
      }

      const response = await auth.authFetch("/api/documents/facets");
      if (!response.ok) {
        throw new Error(t("correspondents.loadError"));
      }
      return (await response.json()) as FacetsResponse;
    },
  });

  const correspondents = facetsQuery.data?.correspondents ?? [];

  // Sort by doc count descending, then alphabetically
  const sorted = [...correspondents].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });

  return (
    <Screen
      title={t("correspondents.title")}
      subtitle={t("correspondents.subtitle")}
      headerVariant="compact"
      includeTopSafeArea={false}
      contentContainerStyle={styles.content}
    >
      {facetsQuery.isLoading ? (
        <Card>
          <Text style={styles.loadingText}>{t("correspondents.loading")}</Text>
        </Card>
      ) : null}

      {facetsQuery.isError ? (
        <ErrorCard
          message={t("correspondents.loadError")}
          onRetry={() => facetsQuery.refetch()}
        />
      ) : null}

      {facetsQuery.data && sorted.length === 0 ? (
        <EmptyState
          title={t("correspondents.emptyTitle")}
          body={t("correspondents.emptyBody")}
        />
      ) : null}

      {sorted.map((item) => (
        <Pressable
          key={item.id}
          onPress={() =>
            navigation.navigate("CorrespondentDossier", {
              slug: item.slug,
              name: item.name,
            })
          }
          style={({ pressed }) => [
            pressed ? styles.cardPressed : null,
          ]}
        >
          <Card style={styles.card}>
            <View style={styles.topRow}>
              <View style={styles.nameWrap}>
                <Text numberOfLines={1} style={styles.name}>
                  {item.name}
                </Text>
                <Text style={styles.docCount}>
                  {item.count} {item.count === 1 ? t("correspondents.document") : t("correspondents.documents")}
                </Text>
              </View>
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color={colors.muted}
              />
            </View>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 10,
  },
  loadingText: {
    color: colors.muted,
    lineHeight: 20,
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  card: {
    gap: 0,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  nameWrap: {
    flex: 1,
    gap: 3,
  },
  name: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.2,
  },
  docCount: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.muted,
  },
});
