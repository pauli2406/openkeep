import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../auth";
import { Chip, IconTile } from "../components/layout";
import { Button, Panel, Pill, Screen, SectionHeader } from "../components/ui";
import { useI18n } from "../i18n";
import { formatShortDate, parseArchiveDate } from "../lib";
import { clearLocalHistory } from "../local-history";
import { useOfflineArchive } from "../offline-archive";
import { OFFLINE_CACHE_LIMIT_CHOICES } from "../offline-metadata-store";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";

/**
 * The read-through cache, on its own screen (#116).
 *
 * Caching is lazy: `cacheOpenedDocument` persists a document when it is opened
 * and `shouldUseCache = !isConnected` switches over on its own. There is no
 * opt-in toggle, no Wi-Fi auto-download and no retention setting — the provider
 * deletes those legacy keys on boot — so nothing here offers one. The three
 * numbers are exactly what `CacheSummary` exposes; no free-space figure exists.
 */
export function OfflineArchiveScreen() {
  const styles = useStyles();
  const colors = useColors();
  const navigation = useNavigation();
  const offline = useOfflineArchive();
  const auth = useAuth();
  const [retrying, setRetrying] = useState(false);
  const { t } = useI18n();

  // A session restored offline reads the local copy even when the device itself
  // has internet, which NetInfo alone cannot tell. Every other screen decides
  // the same way.
  const usingCopy = offline.shouldUseCache || auth.isOfflineSession;

  function formatBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  }

  /**
   * When a document was last written to the cache, read from the rows rather
   * than stamped when the app counted them. A clock time alone would be a poor
   * answer for a copy last written days ago, so anything but today is shown as
   * a date.
   */
  function formatLastWritten(value: string | null) {
    if (!value || offline.cacheSummary.documentCount === 0) {
      return t("offline.never");
    }
    const date = parseArchiveDate(value);
    if (!date) {
      return t("offline.never");
    }
    const now = new Date();
    const sameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    return sameDay
      ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : formatShortDate(value);
  }

  function confirmClear() {
    Alert.alert(t("settings.clearCacheTitle"), t("offline.deleteNote"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("offline.deleteCopy"),
        style: "destructive",
        onPress: () =>
          void Promise.all([offline.clearCachedDocuments(), clearLocalHistory()]).catch((error) =>
            Alert.alert(
              t("settings.clearCacheFailed"),
              error instanceof Error ? error.message : t("settings.clearCacheFailed"),
            ),
          ),
      },
    ]);
  }

  const parts = [
    {
      icon: "format-list-bulleted",
      title: t("offline.metadata"),
      body: t("offline.metadataBody"),
    },
    {
      icon: "file-document-outline",
      title: t("offline.original"),
      body: t("offline.originalBody"),
    },
    { icon: "text-recognition", title: t("offline.text"), body: t("offline.textBody") },
    { icon: "history", title: t("offline.history"), body: t("offline.historyBody") },
  ];

  const stats = [
    { label: t("offline.statDocuments"), value: String(offline.cacheSummary.documentCount) },
    { label: t("offline.statUsed"), value: formatBytes(offline.cacheSummary.fileStorageBytes) },
    { label: t("offline.statWritten"), value: formatLastWritten(offline.cacheSummary.lastCachedAt) },
  ];

  return (
    <Screen
      title={t("offline.title")}
      onBack={() => navigation.goBack()}
    >
      {/* Connection — a statement, not a switch */}
      <Panel padded>
        <View style={styles.connection}>
          <View style={[styles.badge, usingCopy ? styles.badgeOffline : styles.badgeOnline]}>
            <MaterialCommunityIcons
              name={usingCopy ? "wifi-off" : "wifi"}
              size={19}
              color={usingCopy ? colors.amber : colors.green}
            />
          </View>
          <View style={styles.connectionText}>
            <Text style={styles.connectionTitle}>
              {usingCopy ? t("offline.disconnected") : t("offline.connected")}
            </Text>
            <Text style={styles.connectionBody}>
              {usingCopy ? t("offline.usingCopy") : t("offline.autoSwitch")}
            </Text>
          </View>
        </View>
        {auth.isOfflineSession ? (
          <Button
            label={t("offline.retry")}
            loading={retrying}
            disabled={retrying}
            onPress={() => {
              setRetrying(true);
              void auth.retryOfflineSession().finally(() => setRetrying(false));
            }}
          />
        ) : null}
      </Panel>

      {/* Exactly what CacheSummary exposes */}
      <View style={styles.stats}>
        {stats.map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <Text style={styles.statLabel} numberOfLines={1}>
              {stat.label}
            </Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
              {stat.value}
            </Text>
          </View>
        ))}
      </View>

      {offline.cacheDisabledReason ? (
        <Text style={styles.disabledNote}>
          {`${t("offline.disabled")} (${offline.cacheDisabledReason})`}
        </Text>
      ) : null}

      {offline.quarantinedCount > 0 ? (
        <Text style={styles.note}>{t("offline.repaired")}</Text>
      ) : null}

      <Panel padded>
        <Text style={styles.cardTitle} accessibilityRole="header">
          {t("offline.limitTitle")}
        </Text>
        <View style={styles.limits}>
          {OFFLINE_CACHE_LIMIT_CHOICES.map((choice) => (
            <Chip
              key={choice}
              label={formatBytes(choice)}
              active={choice === offline.maxBytes}
              onPress={() => void offline.setMaxBytes(choice)}
            />
          ))}
        </View>
        <Text style={styles.cardNote}>{t("offline.limitBody")}</Text>
      </Panel>

      <View>
        <SectionHeader label={t("offline.perDocument")} />
        <Panel>
          {parts.map((part, index) => (
            <View key={part.title} style={[styles.part, index > 0 ? styles.partRule : null]}>
              <IconTile size="sm">
                <MaterialCommunityIcons
                  name={part.icon as never}
                  size={15}
                  color={colors.accentSoftInk}
                />
              </IconTile>
              <View style={styles.partText}>
                <Text style={styles.partTitle}>{part.title}</Text>
                <Text style={styles.partBody}>{part.body}</Text>
              </View>
            </View>
          ))}
        </Panel>
      </View>

      {/* No full download, and no setting that pretends there is one */}
      <View style={styles.callout}>
        <MaterialCommunityIcons name="information-outline" size={16} color={colors.accentSoftInk} />
        <Text style={styles.calloutText}>{t("offline.callout")}</Text>
      </View>

      {/* Only the answers need the server; searching the local copy does not */}
      <Panel>
        <View style={styles.part}>
          <IconTile size="sm">
            <MaterialCommunityIcons name="flag-off-outline" size={15} color={colors.accentSoftInk} />
          </IconTile>
          <View style={styles.partText}>
            <Text style={styles.partTitle}>{t("offline.chatAndSearch")}</Text>
            <Text style={styles.partBody}>{t("offline.chatAndSearchBody")}</Text>
          </View>
          <Pill label={t("offline.onlineOnly")} tone="outline" />
        </View>
        <View style={[styles.part, styles.partRule]}>
          <IconTile size="sm">
            <MaterialCommunityIcons name="magnify" size={15} color={colors.accentSoftInk} />
          </IconTile>
          <View style={styles.partText}>
            <Text style={styles.partTitle}>{t("offline.cachedSearch")}</Text>
            <Text style={styles.partBody}>{t("offline.cachedSearchBody")}</Text>
          </View>
        </View>
      </Panel>

      <View style={styles.footer}>
        <Button label={t("offline.deleteCopy")} variant="danger" onPress={confirmClear} />
        <Text style={styles.note}>{t("offline.deleteNote")}</Text>
      </View>
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  connection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  connectionText: {
    flex: 1,
    minWidth: 0,
  },
  connectionTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  connectionBody: {
    ...text.meta,
    marginTop: 2,
    color: c.muted,
  },
  badge: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.lg,
  },
  badgeOnline: {
    backgroundColor: c.greenSoft,
  },
  badgeOffline: {
    backgroundColor: c.amberSoft,
  },
  stats: {
    flexDirection: "row",
    gap: 10,
  },
  stat: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
  },
  statLabel: {
    ...text.small,
    color: c.muted,
  },
  statValue: {
    ...text.barTitle,
    marginTop: 4,
    color: c.ink,
  },
  note: {
    ...text.small,
    textAlign: "center",
    color: c.muted,
  },
  disabledNote: {
    ...text.meta,
    padding: 12,
    borderRadius: radii.xl,
    backgroundColor: c.amberSoft,
    color: c.amber,
  },
  cardTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  cardNote: {
    ...text.meta,
    color: c.muted,
  },
  limits: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  part: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  partRule: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  partText: {
    flex: 1,
    minWidth: 0,
  },
  partTitle: {
    ...text.rowTitle,
    color: c.ink,
  },
  partBody: {
    ...text.meta,
    marginTop: 2,
    color: c.muted,
  },
  callout: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderRadius: radii.xl,
    backgroundColor: c.accentSoft,
  },
  calloutText: {
    ...text.meta,
    flex: 1,
    color: c.accentSoftInk,
  },
  footer: {
    gap: 10,
  },
}));
