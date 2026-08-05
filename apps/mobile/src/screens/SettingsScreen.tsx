import { Alert, Platform, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../auth";
import { Button, Row, Screen, SectionHeader } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import {
  createThemedStyles,
  useAppearance,
  useColors,
  type Density,
  type ThemePreference,
} from "../theme";
import { text } from "../typography";

const APP_VERSION = "0.1.0";

/** `1,8 GB` — what the read-through cache is holding. */
function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function SettingsScreen() {
  const styles = useStyles();
  const colors = useColors();
  const navigation = useNavigation();
  const appearance = useAppearance();
  const auth = useAuth();
  const offline = useOfflineArchive();
  const { t } = useI18n();

  /** A flat 17px glyph in `dim`, not a 36px coloured tile. */
  const glyph = (name: string) => (
    <MaterialCommunityIcons name={name as never} size={17} color={colors.dim} />
  );

  function labelForLanguage(language: "en" | "de") {
    return language === "de" ? t("settings.german") : t("settings.english");
  }

  function labelForAppearance(preference: ThemePreference) {
    if (preference === "light") return t("settings.appearanceLight");
    if (preference === "dark") return t("settings.appearanceDark");
    return t("settings.appearanceSystem");
  }

  function labelForDensity(density: Density) {
    return density === "compact" ? t("settings.densityCompact") : t("settings.densityStandard");
  }

  function handleSelectAppearance() {
    // Android's Alert renders at most three buttons, and three options plus a
    // cancel is four. There the back gesture dismisses instead.
    const choices = [
      { text: t("settings.appearanceSystem"), onPress: () => appearance.setPreference("system") },
      { text: t("settings.appearanceLight"), onPress: () => appearance.setPreference("light") },
      { text: t("settings.appearanceDark"), onPress: () => appearance.setPreference("dark") },
    ];
    Alert.alert(
      t("settings.appearance"),
      t("settings.selectAppearance"),
      Platform.OS === "android"
        ? choices
        : [...choices, { text: t("settings.cancel"), style: "cancel" as const }],
      { cancelable: true },
    );
  }

  function handleSelectDensity() {
    Alert.alert(t("settings.density"), t("settings.selectDensity"), [
      { text: t("settings.densityStandard"), onPress: () => appearance.setDensity("standard") },
      { text: t("settings.densityCompact"), onPress: () => appearance.setDensity("compact") },
      { text: t("settings.cancel"), style: "cancel" },
    ]);
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

    const save = (language: "en" | "de") =>
      void auth
        .updatePreferences({ ...basePreferences, [key]: language })
        .catch((error) =>
          Alert.alert(
            t("settings.failedToSave"),
            error instanceof Error ? error.message : t("settings.failedToSave"),
          ),
        );

    Alert.alert(title, t("settings.selectLanguage"), [
      { text: t("settings.english"), onPress: () => save("en") },
      { text: t("settings.german"), onPress: () => save("de") },
      { text: t("settings.cancel"), style: "cancel" },
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

  const initials = (auth.user?.displayName ?? "OK")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Screen
      title={t("settings.title")}
      onBack={() => navigation.goBack()}
      padded={false}
    >
      {/* Account */}
      <Row
        minHeight={74}
        leading={
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "OK"}</Text>
          </View>
        }
        title={auth.user?.displayName ?? t("settings.userFallback")}
        meta={auth.user?.email ?? ""}
        metaMono
      />

      <SectionHeader label={t("settings.language")} />
      <Row
        minHeight={50}
        leading={glyph("translate")}
        title={t("settings.surface")}
        value={labelForLanguage(auth.user?.preferences.uiLanguage ?? "en")}
        chevron
        onPress={() => handleSelectPreference("uiLanguage", t("settings.uiLanguage"))}
      />
      <Row
        minHeight={50}
        leading={glyph("text-recognition")}
        title={t("settings.documentsOcr")}
        value={labelForLanguage(auth.user?.preferences.aiProcessingLanguage ?? "en")}
        chevron
        onPress={() =>
          handleSelectPreference("aiProcessingLanguage", t("settings.aiProcessingLanguage"))
        }
      />
      <Row
        minHeight={50}
        leading={glyph("message-outline")}
        title={t("settings.chat")}
        value={labelForLanguage(auth.user?.preferences.aiChatLanguage ?? "en")}
        chevron
        onPress={() => handleSelectPreference("aiChatLanguage", t("settings.aiChatLanguage"))}
      />

      <SectionHeader label={t("settings.display")} />
      <Row
        minHeight={50}
        leading={glyph("weather-night")}
        title={t("settings.appearance")}
        value={labelForAppearance(appearance.preference)}
        valueTone="green"
        chevron
        onPress={handleSelectAppearance}
      />
      <Row
        minHeight={50}
        leading={glyph("format-line-spacing")}
        title={t("settings.density")}
        value={labelForDensity(appearance.density)}
        chevron
        onPress={handleSelectDensity}
      />

      <SectionHeader label={t("settings.archive")} />
      <Row
        minHeight={50}
        leading={glyph("server-network")}
        title={t("settings.server")}
        value={auth.apiUrl || t("settings.notConnected")}
      />
      <Row
        minHeight={50}
        leading={glyph("database-outline")}
        title={t("settings.offlineAvailable")}
        value={`${offline.cacheSummary.documentCount} · ${formatBytes(offline.cacheSummary.fileStorageBytes)}`}
        chevron
        onPress={() => navigation.navigate("OfflineArchive" as never)}
      />

      <SectionHeader label={t("settings.info")} />
      <Row
        minHeight={50}
        leading={glyph("information-outline")}
        title={t("settings.version")}
        value={APP_VERSION}
      />

      <View style={styles.footer}>
        <Button label={t("settings.logOut")} variant="danger" onPress={handleLogout} />
        <Text style={styles.footerText}>
          {`${t("settings.mobileFooter")} ${APP_VERSION}`}
        </Text>
      </View>
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  avatar: {
    height: 44,
    width: 44,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: c.accentSoft,
  },
  avatarText: {
    ...text.bodyStrong,
    fontSize: 15,
    color: c.accentSoftInk,
  },
  footer: {
    padding: 16,
    gap: 14,
  },
  footerText: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    color: c.faint,
    textAlign: "center",
  },
}));
