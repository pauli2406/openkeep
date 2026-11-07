import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AppStackParamList } from "../../App";
import { useAuth } from "../auth";
import { Skeleton } from "../components/layout";
import { EmptyState, ErrorCard, Notice, Panel, Row, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { fetchTaxonomy, taxonomyQueryKey, type FacetsResponse } from "../lib";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles } from "../theme";
import { CardList, Monogram, SearchField } from "./documents/parts";

/**
 * A row per sender: monogram, name, `N documents`, chevron.
 *
 * The facets and taxonomy calls yield `id`, `name`, `slug` and `count`, no dates
 * and no sums, so nothing else may appear here. (#117)
 */
export function CorrespondentsScreen() {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const [query, setQuery] = useState("");

  const facetsQuery = useQuery({
    queryKey: ["document-facets", auth.apiUrl, shouldUseCache, offline.cacheSummary.revision],
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

  const needle = query.trim().toLowerCase();
  const visible = [...correspondents]
    .filter((item) => (needle ? item.name.toLowerCase().includes(needle) : true))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));

  const isLoading = facetsQuery.isLoading || (!shouldUseCache && taxonomyQuery.isLoading);
  const isError = facetsQuery.isError || (!shouldUseCache && taxonomyQuery.isError);
  const hasData = shouldUseCache ? Boolean(facetsQuery.data) : Boolean(taxonomyQuery.data);

  return (
    <Screen
      title={t("correspondents.title")}
      titleMeta={hasData ? `${visible.length} ${t("correspondents.count")}` : undefined}
      onBack={() => navigation.goBack()}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
    >
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={t("correspondents.searchPlaceholder")}
      />

      {isLoading ? (
        <Panel style={styles.card}>
          {[0, 1, 2, 3, 4].map((row) => (
            <View key={row} style={styles.skeletonRow}>
              <Skeleton style={styles.skeletonTile} />
              <Skeleton style={styles.skeletonLine} />
            </View>
          ))}
        </Panel>
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

      {hasData && !isError ? (
        visible.length === 0 ? (
          <Panel>
            {needle ? (
              <EmptyState
                icon="account-search-outline"
                title={t("state.emptySearch")}
                action={t("state.showAll")}
                onAction={() => setQuery("")}
              />
            ) : (
              <EmptyState
                icon="account-multiple-outline"
                title={t("correspondents.emptyTitle")}
                body={t("correspondents.emptyBody")}
              />
            )}
          </Panel>
        ) : (
          <Panel style={styles.card}>
            <CardList>
              {visible.map((item) => (
                <Row
                  key={item.id}
                  leading={<Monogram name={item.name} />}
                  title={item.name}
                  value={String(item.count)}
                  valueMeta={t("correspondents.documents")}
                  chevron
                  onPress={() =>
                    navigation.navigate("CorrespondentDossier", {
                      slug: item.slug,
                      name: item.name,
                    })
                  }
                />
              ))}
            </CardList>
          </Panel>
        )
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  card: {
    overflow: "hidden",
  },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  skeletonTile: {
    width: 32,
    height: 32,
  },
  skeletonLine: {
    flex: 1,
    height: 14,
  },
}));
