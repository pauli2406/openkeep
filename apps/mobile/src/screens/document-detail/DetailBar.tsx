import { Pressable, ScrollView, Text, View } from "react-native";
import { Skeleton } from "../../components/layout";
import { Button, Pill } from "../../components/ui";
import { isDocumentProcessing } from "../../document-processing";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import { titleForDocument, type ArchiveDocument } from "../../lib";
import { DocumentStatusPill, IconButton, ProcessingLine } from "./parts";
import type { TabKey } from "./shared";

/**
 * The bar across the top: what this document is, where it stands, the one thing
 * to do next, and everything else behind the menu. It wraps onto a second line at
 * phone width, as the web's does.
 */
export function DetailHeader({
  document,
  offlineReadOnly,
  canDownload,
  resolving,
  onBack,
  onResolve,
  onDownload,
  onMenu,
}: {
  document: ArchiveDocument;
  offlineReadOnly: boolean;
  canDownload: boolean;
  resolving: boolean;
  onBack: () => void;
  onResolve: () => void;
  onDownload: () => void;
  onMenu: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const reviewOpen = document.reviewStatus === "pending";
  const subtitle = [document.correspondent?.name, document.documentType?.name]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <IconButton icon="arrow-left" label={t("documentDetail.back")} onPress={onBack} size={36} />
        <View style={styles.titleText}>
          <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
            {titleForDocument(document)}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.actionRow}>
        <View style={styles.badges}>
          <DocumentStatusPill document={document} />
          {reviewOpen ? <Pill tone="warn" label={t("documentDetail.needsReview")} /> : null}
        </View>
        <View style={styles.actions}>
          {reviewOpen ? (
            <Button
              label={t("documentDetail.resolveReview")}
              icon="check"
              size="sm"
              disabled={offlineReadOnly}
              loading={resolving}
              onPress={onResolve}
            />
          ) : (
            <Button
              label={t("documentDetail.download")}
              icon="download"
              size="sm"
              disabled={!canDownload}
              onPress={onDownload}
            />
          )}
          <IconButton
            icon="dots-horizontal"
            label={t("documentDetail.moreActions")}
            onPress={onMenu}
            outlined
            size={38}
          />
        </View>
      </View>

      {isDocumentProcessing(document) ? <ProcessingLine /> : null}
    </View>
  );
}

/** What the bar looks like before the document has arrived. */
export function DetailHeaderSkeleton({ onBack }: { onBack: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View style={styles.header} accessibilityState={{ busy: true }}>
      <View style={styles.titleRow}>
        <IconButton icon="arrow-left" label={t("documentDetail.back")} onPress={onBack} size={36} />
        <View style={styles.skeletonText}>
          <Skeleton style={styles.skeletonTitle} />
          <Skeleton style={styles.skeletonSubtitle} />
        </View>
      </View>
    </View>
  );
}

/** Fields · Intelligence · Q&A · OCR Text · History. Scrolls sideways when German runs long. */
export function InspectorTabs({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "fields", label: t("documentDetail.fields") },
    { key: "intelligence", label: t("documentDetail.intelligence") },
    { key: "qa", label: t("documentDetail.qa") },
    { key: "text", label: t("documentDetail.ocrText") },
    { key: "history", label: t("documentDetail.history") },
  ];

  return (
    <View style={styles.tabBar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.tabList}
        accessibilityRole="tablist"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(tab.key)}
              style={styles.tab}
            >
              <Text style={[styles.tabText, active ? styles.tabTextActive : null]} numberOfLines={1}>
                {tab.label}
              </Text>
              {active ? <View style={styles.tabRule} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  header: {
    gap: 10,
    flexShrink: 0,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.panel,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titleText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...text.barTitle,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: c.ink,
  },
  subtitle: {
    ...text.small,
    color: c.muted,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    flexGrow: 1,
    gap: 6,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  skeletonText: {
    flex: 1,
    gap: 6,
  },
  skeletonTitle: {
    width: 200,
    maxWidth: "100%",
    height: 16,
  },
  skeletonSubtitle: {
    width: 140,
    maxWidth: "100%",
    height: 12,
  },
  tabBar: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.panel,
  },
  tabList: {
    flexGrow: 1,
    gap: 2,
    paddingHorizontal: 8,
  },
  tab: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  tabText: {
    ...text.body,
    fontSize: 13,
    color: c.muted,
  },
  tabTextActive: {
    ...text.bodyStrong,
    fontSize: 13,
    color: c.accent,
  },
  tabRule: {
    position: "absolute",
    left: 4,
    right: 4,
    bottom: 0,
    height: 2,
    borderRadius: radii.pill,
    backgroundColor: c.accent,
  },
}));
