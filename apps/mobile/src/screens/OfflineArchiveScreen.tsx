import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../auth";
import { Button, Pill, Row, Screen, SectionHeader } from "../components/ui";
import { useI18n } from "../i18n";
import { formatShortDate, parseArchiveDate } from "../lib";
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
          void offline.clearCachedDocuments().catch((error) =>
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
    <Screen title={t("offline.title")} onBack={() => navigation.goBack()} padded={false}>
      {/* Connection — a statement, not a switch */}
      <Row
        minHeight={74}
        leading={
          <View style={[styles.badge, usingCopy ? styles.badgeOffline : styles.badgeOnline]}>
            <MaterialCommunityIcons
              name={usingCopy ? "wifi-off" : "wifi"}
              size={19}
              color={usingCopy ? colors.amber : colors.green}
            />
          </View>
        }
        title={usingCopy ? t("offline.disconnected") : t("offline.connected")}
        meta={usingCopy ? t("offline.usingCopy") : t("offline.autoSwitch")}
        titleNumberOfLines={1}
      />

      {/* Exactly what CacheSummary exposes */}
      <View style={styles.statStrip}>
        {stats.map((stat, index) => (
          <View
            key={stat.label}
            style={[styles.statCell, index < stats.length - 1 ? styles.statCellDivided : null]}
          >
            <Text style={styles.statValue} numberOfLines={1}>
              {stat.value}
            </Text>
            <Text style={styles.statLabel} numberOfLines={1}>
              {stat.label}
            </Text>
          </View>
        ))}
      </View>

      {offline.quarantinedCount > 0 ? (
        <Text style={styles.repairNote}>{t("offline.repaired")}</Text>
      ) : null}


      {auth.isOfflineSession ? (
        <View style={styles.limitRow}>
          <Button
            label={t("offline.retry")}
            loading={retrying}
            disabled={retrying}
            onPress={() => {
              setRetrying(true);
              void auth.retryOfflineSession().finally(() => setRetrying(false));
            }}
          />
        </View>
      ) : null}

      {offline.cacheDisabledReason ? (
        <Text style={styles.disabledNote}>
          {`${t("offline.disabled")} (${offline.cacheDisabledReason})`}
        </Text>
      ) : null}

      <SectionHeader label={t("offline.limitTitle")} />
      <View style={styles.limitRow}>
        {OFFLINE_CACHE_LIMIT_CHOICES.map((choice) => {
          const active = choice === offline.maxBytes;
          return (
            <Pressable
              key={choice}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => void offline.setMaxBytes(choice)}
              style={[styles.chip, active ? styles.chipActive : styles.chipIdle]}
            >
              <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                {formatBytes(choice)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.repairNote}>{t("offline.limitBody")}</Text>

      <SectionHeader label={t("offline.perDocument")} />
      {parts.map((part) => (
        <Row
          key={part.title}
          leading={
            <MaterialCommunityIcons name={part.icon as never} size={17} color={colors.dim} />
          }
          title={part.title}
          meta={part.body}
        />
      ))}

      {/* No full download, and no setting that pretends there is one */}
      <View style={styles.callout}>
        <MaterialCommunityIcons name="information-outline" size={16} color={colors.accentSoftInk} />
        <Text style={styles.calloutText}>{t("offline.callout")}</Text>
      </View>

      {/* Only the answers need the server; searching the local copy does not */}
      <Row
        leading={<MaterialCommunityIcons name="flag-off-outline" size={17} color={colors.dim} />}
        title={t("offline.chatAndSearch")}
        meta={t("offline.chatAndSearchBody")}
        accessory={<Pill label={t("offline.onlineOnly")} tone="outline" />}
      />
      <Row
        leading={<MaterialCommunityIcons name="magnify" size={17} color={colors.dim} />}
        title={t("offline.cachedSearch")}
        meta={t("offline.cachedSearchBody")}
      />

      <View style={styles.footer}>
        <Button label={t("offline.deleteCopy")} variant="danger" onPress={confirmClear} />
        <Text style={styles.footerNote}>{t("offline.deleteNote")}</Text>
      </View>
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  chip: {
    flexShrink: 0,
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    minHeight: 44,
    justifyContent: "center",
  },
  chipIdle: {
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  chipActive: {
    backgroundColor: c.accentFill,
  },
  chipText: {
    ...text.meta,
    color: c.muted,
  },
  chipTextActive: {
    ...text.metaStrong,
    color: c.accentFillInk,
  },
  limitRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  disabledNote: {
    ...text.small,
    color: c.muted,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  repairNote: {
    ...text.small,
    color: c.muted,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  badge: {
    height: 44,
    width: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
  },
  badgeOnline: {
    backgroundColor: c.greenSoft,
  },
  badgeOffline: {
    backgroundColor: c.amberSoft,
  },
  statStrip: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  statCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 3,
  },
  statCellDivided: {
    borderRightWidth: 1,
    borderRightColor: c.borderSoft,
  },
  statValue: {
    ...text.statValue,
    color: c.ink,
  },
  statLabel: {
    ...text.small,
    color: c.faint,
  },
  callout: {
    flexDirection: "row",
    gap: 10,
    margin: 16,
    borderRadius: radii.xl,
    backgroundColor: c.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  calloutText: {
    ...text.meta,
    flex: 1,
    color: c.accentSoftInk,
  },
  footer: {
    padding: 16,
    gap: 10,
  },
  footerNote: {
    ...text.small,
    color: c.faint,
    textAlign: "center",
  },
}));
