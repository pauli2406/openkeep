import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Segmented, Skeleton } from "../../components/layout";
import { EmptyState, Panel } from "../../components/ui";
import { useI18n } from "../../i18n";
import type { FacetsResponse } from "../../lib";
import { cardShadow, createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import { Meter, Monogram, useCategoryColor } from "./parts";

export type GroupBy = "correspondents" | "categories";

/** One group: its name, its count, and how it weighs against the largest group. */
function GroupCard({
  name,
  count,
  max,
  detail,
  selected = false,
  muted = false,
  onPress,
  onOpenDossier,
}: {
  name: string;
  count: number;
  max: number;
  detail?: string | null;
  selected?: boolean;
  muted?: boolean;
  onPress: () => void;
  /** A correspondent has a dossier; a category does not. */
  onOpenDossier?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const assigned = useCategoryColor(name);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${name}, ${count}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        selected ? styles.cardSelected : null,
        muted ? styles.cardMuted : null,
        pressed ? styles.cardPressed : null,
      ]}
    >
      <View style={styles.head}>
        <Monogram name={name} muted={muted} />
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {onOpenDossier ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t("groups.openDossier").replace("{name}", name)}
            onPress={onOpenDossier}
            hitSlop={8}
            style={styles.dossier}
          >
            <MaterialCommunityIcons name="card-account-details-outline" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.count}>{count}</Text>
      <Meter share={count / Math.max(max, 1)} color={muted ? colors.muted : assigned} />
      {detail ? (
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Cards weighted by document count, at two levels: correspondents, or life-domain
 * categories with their top correspondents. Tapping a card filters the list to
 * that group.
 */
export function GroupsView({
  facets,
  loading,
  selectedCorrespondentIds,
  groupBy,
  onGroupByChange,
  onSelectCorrespondent,
  onSelectCategory,
  onSelectUncategorized,
  onOpenDossier,
}: {
  facets: FacetsResponse | undefined;
  loading: boolean;
  selectedCorrespondentIds: string[];
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  onSelectCorrespondent: (id: string) => void;
  onSelectCategory: (id: string) => void;
  onSelectUncategorized: () => void;
  onOpenDossier: (correspondent: { slug: string; name: string }) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  const categories = [...(facets?.categories ?? [])].sort((a, b) => b.count - a.count);
  const uncategorized = facets?.uncategorizedCount ?? 0;
  const groups = [...(facets?.correspondents ?? [])].sort((a, b) => b.count - a.count);
  const isEmpty =
    groupBy === "categories" ? categories.length === 0 && uncategorized === 0 : groups.length === 0;
  const categoryMax = Math.max(categories[0]?.count ?? 1, uncategorized, 1);

  return (
    <View style={styles.root}>
      <Segmented
        value={groupBy}
        onChange={onGroupByChange}
        options={[
          { value: "correspondents", label: t("groups.byCorrespondents") },
          { value: "categories", label: t("groups.byCategories") },
        ]}
      />
      <Text style={styles.hint}>
        {groupBy === "categories" ? t("groups.categoriesHint") : t("groups.correspondentsHint")}
      </Text>

      {loading ? (
        [0, 1, 2].map((card) => <Skeleton key={card} style={styles.skeleton} />)
      ) : isEmpty ? (
        <Panel>
          <EmptyState icon="view-grid-outline" title={t("groups.empty")} />
        </Panel>
      ) : groupBy === "categories" ? (
        <>
          {categories.map((category) => (
            <GroupCard
              key={category.id}
              name={category.name}
              count={category.count}
              max={categoryMax}
              detail={category.topCorrespondents.join(", ")}
              onPress={() => onSelectCategory(category.id)}
            />
          ))}
          {uncategorized > 0 ? (
            <GroupCard
              muted
              name={t("filters.uncategorized")}
              count={uncategorized}
              max={categoryMax}
              onPress={onSelectUncategorized}
            />
          ) : null}
        </>
      ) : (
        groups.map((group) => (
          <GroupCard
            key={group.id}
            name={group.name}
            count={group.count}
            max={groups[0]?.count ?? 1}
            detail={group.dominantTypeName}
            selected={selectedCorrespondentIds.includes(group.id)}
            onPress={() => onSelectCorrespondent(group.id)}
            onOpenDossier={() => onOpenDossier({ slug: group.slug, name: group.name })}
          />
        ))
      )}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    gap: 12,
  },
  hint: {
    ...text.small,
    color: c.muted,
  },
  skeleton: {
    height: 144,
    borderRadius: radii.xl,
  },
  card: {
    gap: 12,
    padding: 16,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
    ...cardShadow(c),
  },
  cardSelected: {
    borderColor: c.accent,
    backgroundColor: c.accentSoft,
  },
  cardMuted: {
    borderStyle: "dashed",
    borderColor: c.borderStrong,
    backgroundColor: "transparent",
    shadowOpacity: 0,
    elevation: 0,
  },
  cardPressed: {
    opacity: 0.85,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  name: {
    ...text.bodyStrong,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  dossier: {
    width: 36,
    height: 36,
    marginVertical: -2,
    marginRight: -6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  count: {
    ...text.statValue,
    color: c.ink,
  },
  detail: {
    ...text.small,
    color: c.muted,
  },
}));
