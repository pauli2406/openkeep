import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import { titleForDocument, type ArchiveDocument } from "../../lib";
import type { TabKey } from "./shared";

/** Back, title, `correspondent · type`, the confidence pill, share, overflow. */
export function DetailBar({
  document,
  offlineReadOnly,
  onBack,
  onShare,
  onMenu,
}: {
  document: ArchiveDocument | undefined;
  offlineReadOnly: boolean;
  onBack: () => void;
  onShare: () => void;
  onMenu: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();

  const confidence = document?.confidence ?? null;
  const tone =
    confidence === null ? null : confidence >= 0.8 ? "ok" : confidence >= 0.5 ? "warn" : "bad";

  return (
    <View style={styles.bar}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.back}>
        <MaterialCommunityIcons name="chevron-left" size={22} color={colors.accent} />
      </Pressable>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {document ? titleForDocument(document) : t("documentDetail.doc")}
        </Text>
        {document ? (
          <Text style={styles.meta} numberOfLines={1}>
            {`${document.correspondent?.name ?? t("documents.unfiled")}${document.documentType?.name ? ` · ${document.documentType.name}` : ""}`}
          </Text>
        ) : null}
      </View>
      {tone ? (
        <View
          style={[
            styles.pill,
            tone === "ok" ? styles.pillOk : tone === "warn" ? styles.pillWarn : styles.pillBad,
          ]}
        >
          <Text
            style={[
              styles.pillText,
              tone === "ok" ? styles.inkOk : tone === "warn" ? styles.inkWarn : styles.inkBad,
            ]}
          >
            {`${Math.round((confidence ?? 0) * 100)} %`}
          </Text>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("documentDetail.overview.shareOriginal")}
        onPress={onShare}
        disabled={offlineReadOnly}
        hitSlop={12}
      >
        <MaterialCommunityIcons
          name="share-variant-outline"
          size={18}
          color={offlineReadOnly ? colors.faint : colors.muted}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("documentDetail.moreActions")}
        onPress={onMenu}
        hitSlop={12}
      >
        <MaterialCommunityIcons name="dots-vertical" size={18} color={colors.muted} />
      </Pressable>
    </View>
  );
}

/** `Dokument · Details · Fragen · Verlauf`. */
export function DetailTabs({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "document", label: t("documentDetail.tab.document") },
    { key: "details", label: t("documentDetail.tab.details") },
    { key: "questions", label: t("documentDetail.tab.questions") },
    { key: "history", label: t("documentDetail.tab.history") },
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, active ? styles.tabActive : null]}
          >
            <Text style={[styles.tabText, active ? styles.tabTextActive : null]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    height: 46,
    flexShrink: 0,
    paddingLeft: 6,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  back: {
    padding: 4,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...text.rowTitle,
    fontSize: 14,
    color: c.ink,
  },
  meta: {
    ...text.small,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 1,
    color: c.faint,
  },
  pill: {
    flexShrink: 0,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pillOk: {
    backgroundColor: c.greenSoft,
  },
  pillWarn: {
    backgroundColor: c.amberSoft,
  },
  pillBad: {
    backgroundColor: c.redSoft,
  },
  pillText: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
  },
  inkOk: {
    color: c.green,
  },
  inkWarn: {
    color: c.amber,
  },
  inkBad: {
    color: c.red,
  },
  tabBar: {
    flexDirection: "row",
    gap: 2,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  tab: {
    flex: 1,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  tabActive: {
    backgroundColor: c.accentSoft,
  },
  tabText: {
    ...text.meta,
    color: c.dim,
  },
  tabTextActive: {
    ...text.metaStrong,
    color: c.accentSoftInk,
  },
}));
