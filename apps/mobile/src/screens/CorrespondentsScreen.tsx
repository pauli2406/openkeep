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
import { fetchTaxonomy, taxonomyQueryKey, type FacetsResponse } from "../lib";

// ---------------------------------------------------------------------------
// Correspondents Screen
// ---------------------------------------------------------------------------

export function CorrespondentsScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  const facetsQuery = useQuery({
    queryKey: ["document-facets", auth.apiUrl, shouldUseCache, offline.cacheSummary.updatedAt],
    queryFn: async () => {
      if (shouldUseCache) {
        return offline.loadCachedFacets();
      }

      const response = await auth.authFetch("/api/documents/facets");
      if (!response.ok) {
        throw new Error(t("correspondents.loadError"));
      }
      return (await response.json()) as FacetsResponse;
    },
  });

  // The facets only cover correspondents that already have documents. Online we additionally read
  // the taxonomy table so freshly created ones show up too, with a count of zero. The offline
  // mirror has no taxonomy table, so there the facets stay the only source.
  const taxonomyQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "correspondents"),
    enabled: !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "correspondents", t("correspondents.loadError")),
  });

  const counts = new Map(
    (facetsQuery.data?.correspondents ?? []).map((item) => [item.id, item.count]),
  );
  const correspondents = shouldUseCache
    ? (facetsQuery.data?.correspondents ?? [])
    : (taxonomyQuery.data ?? []).map((item) => ({
        ...item,
        count: counts.get(item.id) ?? 0,
      }));

  // Sort by doc count descending, then alphabetically
  const sorted = [...correspondents].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.name.localeCompare(b.name);
  });

  const isLoading = facetsQuery.isLoading || (!shouldUseCache && taxonomyQuery.isLoading);
  const isError = facetsQuery.isError || taxonomyQuery.isError;
  const hasData = shouldUseCache ? Boolean(facetsQuery.data) : Boolean(taxonomyQuery.data);

  return (
    <Screen
      title={t("correspondents.title")}
      subtitle={t("correspondents.subtitle")}
      headerVariant="compact"
      includeTopSafeArea={false}
      contentContainerStyle={styles.content}
    >
      {isLoading ? (
        <Card>
          <Text style={styles.loadingText}>{t("correspondents.loading")}</Text>
        </Card>
      ) : null}

      {isError ? (
        <ErrorCard
          message={t("correspondents.loadError")}
          onRetry={() => {
            void facetsQuery.refetch();
            void taxonomyQuery.refetch();
          }}
        />
      ) : null}

      {hasData && sorted.length === 0 ? (
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
