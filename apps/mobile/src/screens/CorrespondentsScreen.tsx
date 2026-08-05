import { useNavigation } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { EmptyState, ErrorCard, Notice, Panel, Row, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import { fetchTaxonomy, taxonomyQueryKey, type FacetsResponse } from "../lib";

function initialsFor(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * A row per sender: initials, name, `N Dokumente`, chevron.
 *
 * The facets and taxonomy calls yield `id`, `name`, `slug` and `count` — no
 * dates and no sums — so nothing else may appear here. (#117)
 */
export function CorrespondentsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const [query, setQuery] = useState("");

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

  const needle = query.trim().toLowerCase();
  const visible = [...correspondents]
    .filter((item) => (needle ? item.name.toLowerCase().includes(needle) : true))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.name.localeCompare(b.name)));

  const isLoading = facetsQuery.isLoading || (!shouldUseCache && taxonomyQuery.isLoading);
  const isError = facetsQuery.isError || taxonomyQuery.isError;
  const hasData = shouldUseCache ? Boolean(facetsQuery.data) : Boolean(taxonomyQuery.data);

  return (
    <Screen
      title={t("correspondents.title")}
      onBack={() => navigation.goBack()}
      padded={false}
      notice={shouldUseCache ? <Notice label={t("state.offline")} /> : undefined}
    >
      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <MaterialCommunityIcons name="magnify" size={15} color={colors.dim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("correspondents.searchPlaceholder")}
            placeholderTextColor={colors.dim}
            style={styles.searchInput}
            autoCorrect={false}
          />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.gutter}>
          <Panel padded>
            <Text style={styles.hint}>{t("correspondents.loading")}</Text>
          </Panel>
        </View>
      ) : null}

      {isError ? (
        <View style={styles.gutter}>
          <ErrorCard
            message={t("correspondents.loadError")}
            onRetry={() => {
              void facetsQuery.refetch();
              void taxonomyQuery.refetch();
            }}
          />
        </View>
      ) : null}

      {hasData ? (
        <>
          <View style={styles.countStrip}>
            <Text style={styles.countText}>
              {`${visible.length} ${t("correspondents.count")}`}
            </Text>
          </View>

          {visible.length === 0 ? (
            needle ? (
              <EmptyState
                title={t("state.emptySearch")}
                action={t("state.showAll")}
                onAction={() => setQuery("")}
              />
            ) : (
              <EmptyState
                title={t("correspondents.emptyTitle")}
                body={t("correspondents.emptyBody")}
              />
            )
          ) : (
            visible.map((item) => (
              <Row
                key={item.id}
                leading={
                  <View style={styles.initials}>
                    <Text style={styles.initialsText}>{initialsFor(item.name) || "–"}</Text>
                  </View>
                }
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
            ))
          )}
        </>
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  gutter: {
    padding: 16,
  },
  hint: {
    ...text.meta,
    color: c.muted,
  },
  searchWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 9,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
    paddingHorizontal: 10,
  },
  searchInput: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    color: c.ink,
    padding: 0,
  },
  countStrip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  countText: {
    ...text.numeric,
    color: c.dim,
  },
  initials: {
    height: 32,
    width: 32,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
    backgroundColor: c.accentSoft,
  },
  initialsText: {
    ...text.numericStrong,
    fontSize: 11,
    lineHeight: 15,
    color: c.accentSoftInk,
  },
}));
