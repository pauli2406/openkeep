import { useEffect } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { Card, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import { colors, shadow } from "../theme";

const APP_VERSION = "0.1.0";

function formatStorage(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  tone = "default",
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  tone?: "default" | "danger";
}) {
  const inner = (
    <View style={rowStyles.row}>
      <View style={[rowStyles.iconWrap, tone === "danger" ? rowStyles.iconWrapDanger : null]}>
        <MaterialCommunityIcons
          name={icon as never}
          size={18}
          color={tone === "danger" ? colors.danger : colors.primary}
        />
      </View>
      <View style={rowStyles.textWrap}>
        <Text style={[rowStyles.label, tone === "danger" ? rowStyles.labelDanger : null]}>
          {label}
        </Text>
        {value ? (
          <Text numberOfLines={1} style={rowStyles.value}>
            {value}
          </Text>
        ) : null}
      </View>
      {onPress ? (
        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed ? rowStyles.pressed : null]}
      >
        {inner}
      </Pressable>
    );
  }

  return inner;
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 2,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapDanger: {
    backgroundColor: "#f4d9d6",
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
  },
  labelDanger: {
    color: colors.danger,
  },
  value: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.75,
  },
});

function Divider() {
  return <View style={dividerStyles.line} />;
}

const dividerStyles = StyleSheet.create({
  line: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 50,
  },
});

function SectionLabel({ label }: { label: string }) {
  return <Text style={sectionStyles.label}>{label}</Text>;
}

const sectionStyles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: -6,
  },
});

export function SettingsScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();

  useEffect(() => {
    if (!auth.apiUrl || !offline.isConnected || !offline.isReady) {
      return;
    }

    void offline.checkArchiveReachability(auth.probeServer, auth.apiUrl);
  }, [auth.apiUrl, auth.probeServer, offline.checkArchiveReachability, offline.isConnected, offline.isReady]);

  const reachabilityLabel =
    offline.archiveReachability === "reachable"
      ? t("settings.reachability.reachable")
      : offline.archiveReachability === "unreachable"
        ? t("settings.reachability.unreachable")
        : offline.archiveReachability === "checking"
          ? t("settings.reachability.checking")
          : t("settings.reachability.unknown");

  const reachabilityValue = offline.lastReachabilityCheckedAt
    ? `${reachabilityLabel} - ${new Date(offline.lastReachabilityCheckedAt).toLocaleTimeString()}`
    : reachabilityLabel;

  async function handleSync(forceFull = false) {
    try {
      const result = await offline.syncArchive(auth.authFetch, { forceFull });
      Alert.alert(
        forceFull
          ? t("settings.syncRefreshedTitle")
          : t("settings.syncUpdatedTitle"),
        `${result.syncedDocuments} refreshed, ${result.reusedDocuments} unchanged, ${result.removedDocuments} removed. Cached ${result.documentCount} documents${result.failedDocuments > 0 ? `, ${result.failedDocuments} kept from the previous snapshot` : ""}.`,
      );
    } catch (error) {
      Alert.alert(
        t("settings.syncFailedTitle"),
        error instanceof Error
          ? error.message
          : t("settings.syncFailedBody"),
      );
    }
  }

  function labelForLanguage(language: "en" | "de") {
    return language === "de" ? t("settings.german") : t("settings.english");
  }

  function handleSelectPreference(
    key: "uiLanguage" | "aiProcessingLanguage" | "aiChatLanguage",
    title: string,
  ) {
    const basePreferences = auth.user?.preferences ?? {
      uiLanguage: "en",
      aiProcessingLanguage: "en",
      aiChatLanguage: "en",
    };

    Alert.alert(title, t("settings.selectLanguage"), [
      {
        text: t("settings.english"),
        onPress: () =>
          void auth.updatePreferences({
            ...basePreferences,
            [key]: "en",
          }).catch((error) => {
            Alert.alert(
              t("settings.failedToSave"),
              error instanceof Error ? error.message : t("settings.failedToSave"),
            );
          }),
      },
      {
        text: t("settings.german"),
        onPress: () =>
          void auth.updatePreferences({
            ...basePreferences,
            [key]: "de",
          }).catch((error) => {
            Alert.alert(
              t("settings.failedToSave"),
              error instanceof Error ? error.message : t("settings.failedToSave"),
            );
          }),
      },
      { text: t("settings.cancel"), style: "cancel" },
    ]);
  }

  function handleLogout() {
    Alert.alert(t("settings.logOutConfirmTitle"), t("settings.logOutConfirmText"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.logOut"),
        style: "destructive",
        onPress: () => void auth.logout(),
      },
    ]);
  }

  return (
    <Screen title={t("settings.title")} subtitle={t("settings.subtitle")}>
      {/* Account */}
      <SectionLabel label={t("settings.account")} />
      <Card>
        <SettingsRow
          icon="account-circle-outline"
          label={auth.user?.displayName ?? t("settings.userFallback")}
          value={auth.user?.email}
        />
        {auth.user?.isOwner ? (
          <>
            <Divider />
            <SettingsRow icon="shield-check-outline" label={t("settings.ownerAccount")} />
          </>
        ) : null}
      </Card>

      <SectionLabel label={t("settings.languagePreferences")} />
      <Card>
        <SettingsRow
          icon="translate"
          label={t("settings.uiLanguage")}
          value={labelForLanguage(auth.user?.preferences.uiLanguage ?? "en")}
          onPress={() => handleSelectPreference("uiLanguage", t("settings.uiLanguage"))}
        />
        <Divider />
        <SettingsRow
          icon="brain"
          label={t("settings.aiProcessingLanguage")}
          value={labelForLanguage(auth.user?.preferences.aiProcessingLanguage ?? "en")}
          onPress={() =>
            handleSelectPreference("aiProcessingLanguage", t("settings.aiProcessingLanguage"))
          }
        />
        <Divider />
        <SettingsRow
          icon="message-text-outline"
          label={t("settings.aiChatLanguage")}
          value={labelForLanguage(auth.user?.preferences.aiChatLanguage ?? "en")}
          onPress={() => handleSelectPreference("aiChatLanguage", t("settings.aiChatLanguage"))}
        />
      </Card>

      {/* Archive connection */}
      <SectionLabel label={t("settings.archive")} />
      <Card>
        <SettingsRow
          icon="server-network"
          label={t("settings.connectedArchive")}
          value={auth.apiUrl || t("settings.notConnected")}
        />
        <Divider />
        <SettingsRow
          icon={offline.shouldUseOffline ? "archive-lock-outline" : "archive-outline"}
          label={t("settings.offlineArchiveMode")}
          value={offline.isOfflineModeEnabled ? t("settings.enabled") : offline.isConnected ? t("settings.readyWhenNeeded") : t("settings.usingLocalArchive")}
          onPress={() => void offline.setOfflineModeEnabled(!offline.isOfflineModeEnabled)}
        />
        <Divider />
        <SettingsRow
          icon={offline.archiveReachability === "reachable" ? "lan-connect" : offline.archiveReachability === "checking" ? "lan-pending" : "lan-disconnect"}
          label={t("settings.archiveStatus")}
          value={reachabilityValue}
          onPress={auth.apiUrl && offline.isConnected ? () => void offline.checkArchiveReachability(auth.probeServer, auth.apiUrl) : undefined}
        />
      </Card>

      <SectionLabel label={t("settings.offlineArchive")} />
      <Card>
        <SettingsRow
          icon="database-arrow-down-outline"
          label={t("settings.syncLocalArchive")}
          value={offline.isSyncing ? (offline.syncProgress ? `${offline.syncProgress.completed}/${offline.syncProgress.total}` : t("settings.running")) : t("settings.syncLocalArchiveHint")}
          onPress={offline.isConnected ? () => void handleSync() : undefined}
        />
        <Divider />
        <SettingsRow
          icon="database-refresh-outline"
          label={t("settings.forceFullResync")}
          value={t("settings.forceFullResyncHint")}
          onPress={offline.isConnected ? () => void handleSync(true) : undefined}
        />
        <Divider />
        <SettingsRow
          icon="file-cabinet-outline"
          label={t("settings.cachedDocuments")}
          value={offline.summary ? String(offline.summary.documentCount) : "0"}
        />
        <Divider />
        <SettingsRow
          icon="harddisk"
          label={t("settings.localStorage")}
          value={offline.summary ? formatStorage(offline.summary.storageBytes) : "0 B"}
        />
        <Divider />
        <SettingsRow
          icon="clock-outline"
          label={t("settings.lastSync")}
          value={offline.summary?.lastSyncedAt ? new Date(offline.summary.lastSyncedAt).toLocaleString() : t("settings.never")}
        />
      </Card>

      {/* About */}
      <SectionLabel label={t("settings.about")} />
      <Card>
        <SettingsRow icon="information-outline" label={t("settings.version")} value={APP_VERSION} />
        <Divider />
        <SettingsRow icon="bookshelf" label="OpenKeep" value={t("settings.productTagline")} />
      </Card>

      {/* Log out */}
      <View style={styles.logoutSection}>
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [
            styles.logoutButton,
            pressed ? styles.logoutButtonPressed : null,
          ]}
        >
          <MaterialCommunityIcons name="logout" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>{t("settings.logOut")}</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{`${t("settings.mobileFooter")} ${APP_VERSION}`}</Text>
        <Text style={styles.footerText}>{t("settings.footerTagline")}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoutSection: {
    marginTop: 4,
  },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 54,
    borderRadius: 18,
    backgroundColor: "#f4d9d6",
    ...shadow,
    shadowOpacity: 0.06,
  },
  logoutButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.danger,
    letterSpacing: 0.1,
  },
  footer: {
    alignItems: "center",
    paddingVertical: 12,
    gap: 4,
  },
  footerText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
});
