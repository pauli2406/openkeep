import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { Card, Screen } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles, useColors } from "../theme";

const APP_VERSION = "0.1.0";

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
  const colors = useColors();
  const rowStyles = useRowStyles();
  const inner = (
    <View style={rowStyles.row}>
      <View style={[rowStyles.iconWrap, tone === "danger" ? rowStyles.iconWrapDanger : null]}>
        <MaterialCommunityIcons
          name={icon as never}
          size={18}
          color={tone === "danger" ? colors.red : colors.accent}
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

const useRowStyles = createThemedStyles((c) => ({
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
    backgroundColor: c.accentSoft,
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
    color: c.ink,
  },
  labelDanger: {
    color: c.red,
  },
  value: {
    fontSize: 13,
    color: c.muted,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.75,
  },
}));

function Divider() {
  const dividerStyles = useDividerStyles();
  return <View style={dividerStyles.line} />;
}

const useDividerStyles = createThemedStyles((c) => ({
  line: {
    height: 1,
    backgroundColor: c.border,
    marginLeft: 50,
  },
}));

function SectionLabel({ label }: { label: string }) {
  const sectionStyles = useSectionStyles();
  return <Text style={sectionStyles.label}>{label}</Text>;
}

const useSectionStyles = createThemedStyles((c) => ({
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: c.muted,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: -6,
  },
}));

export function SettingsScreen() {
  const colors = useColors();
  const styles = useStyles();
  const auth = useAuth();
  const offline = useOfflineArchive();
  const { t } = useI18n();

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

  function formatBytes(bytes: number) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function handleClearCache() {
    Alert.alert(t("settings.clearCacheTitle"), t("settings.clearCacheText"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.clearCache"),
        style: "destructive",
        onPress: () => void offline.clearCachedDocuments().catch((error) => {
          Alert.alert(
            t("settings.clearCacheFailed"),
            error instanceof Error ? error.message : t("settings.clearCacheFailed"),
          );
        }),
      },
    ]);
  }

  function handleLogout() {
    Alert.alert(t("settings.logOutConfirmTitle"), t("settings.logOutConfirmText"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.logOut"),
        style: "destructive",
        onPress: () => void offline.clearCachedDocuments().finally(() => auth.logout()),
      },
    ]);
  }

  return (
    <Screen title={t("settings.title")} subtitle={t("settings.subtitle")} showEyebrow>
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
          icon="database-outline"
          label={t("settings.cachedDocuments")}
          value={`${offline.cacheSummary.documentCount} ${t("settings.documentsCached")} · ${formatBytes(offline.cacheSummary.fileStorageBytes)}`}
        />
        <Divider />
        <SettingsRow
          icon="trash-can-outline"
          label={t("settings.clearCache")}
          value={t("settings.clearCacheHint")}
          onPress={handleClearCache}
          tone="danger"
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
          <MaterialCommunityIcons name="logout" size={18} color={colors.red} />
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

const useStyles = createThemedStyles((c) => ({
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
  },
  logoutButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "800",
    color: c.red,
    letterSpacing: 0.1,
  },
  footer: {
    alignItems: "center",
    paddingVertical: 12,
    gap: 4,
  },
  footerText: {
    color: c.muted,
    fontSize: 12,
    lineHeight: 17,
  },
}));
