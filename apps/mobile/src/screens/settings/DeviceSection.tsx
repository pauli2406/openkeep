import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import Constants from "expo-constants";
import type { AppStackParamList } from "../../../App";
import { useAuth } from "../../auth";
import { Segmented } from "../../components/layout";
import { useI18n } from "../../i18n";
import { useOfflineArchive } from "../../offline-archive";
import { createThemedStyles, useAppearance, useColors, type Density, type ThemePreference } from "../../theme";
import { text } from "../../typography";
import { SectionCard, SettingBlock, formatBytes } from "./shared";

/**
 * Read from the config the binary was built with, not written here: a hardcoded
 * copy drifts the moment a release bumps `version` in `app.config.js`, and it did.
 */
const APP_VERSION = Constants.expoConfig?.version ?? "—";

/** What only a phone has: its own look, and what stays on it. Works offline. */
export function DeviceSection() {
  const styles = useStyles();
  const colors = useColors();
  const appearance = useAppearance();
  const auth = useAuth();
  const offline = useOfflineArchive();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const { t } = useI18n();

  const glyph = (name: string) => (
    <MaterialCommunityIcons name={name as never} size={17} color={colors.muted} />
  );

  return (
    <>
      <SectionCard
        icon="palette-outline"
        title={t("settings.display")}
        description={t("settings.selectAppearance")}
      >
        <SettingBlock label={t("settings.appearance")}>
          <Segmented<ThemePreference>
            value={appearance.preference}
            onChange={(value) => appearance.setPreference(value)}
            options={[
              { value: "system", label: t("settings.appearanceSystem") },
              { value: "light", label: t("settings.appearanceLight") },
              { value: "dark", label: t("settings.appearanceDark") },
            ]}
          />
        </SettingBlock>
        <SettingBlock label={t("settings.density")} description={t("settings.selectDensity")} last>
          <Segmented<Density>
            value={appearance.density}
            onChange={(value) => appearance.setDensity(value)}
            options={[
              { value: "standard", label: t("settings.densityStandard") },
              { value: "compact", label: t("settings.densityCompact") },
            ]}
          />
        </SettingBlock>
      </SectionCard>

      <SectionCard
        icon="cellphone"
        title={t("settings.thisDevice")}
        description={t("settings.thisDeviceDescription")}
      >
        <View style={styles.rows}>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate("OfflineArchive")}
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
          >
            {glyph("database-outline")}
            <Text style={styles.rowLabel} numberOfLines={1}>
              {t("settings.offlineAvailable")}
            </Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {`${offline.cacheSummary.documentCount} · ${formatBytes(offline.cacheSummary.fileStorageBytes)}`}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.dim} />
          </Pressable>
          <View style={[styles.row, styles.rowRule]}>
            {glyph("server-network")}
            <Text style={styles.rowLabel} numberOfLines={1}>
              {t("settings.server")}
            </Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {auth.apiUrl || t("settings.notConnected")}
            </Text>
          </View>
          <View style={[styles.row, styles.rowRule]}>
            {glyph("information-outline")}
            <Text style={styles.rowLabel} numberOfLines={1}>
              {t("settings.version")}
            </Text>
            <Text style={styles.rowValue} numberOfLines={1}>
              {APP_VERSION}
            </Text>
          </View>
        </View>
      </SectionCard>
    </>
  );
}

const useStyles = createThemedStyles((c) => ({
  rows: {
    marginHorizontal: -16,
    marginVertical: -16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  rowPressed: {
    backgroundColor: c.bar,
  },
  rowRule: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  rowLabel: {
    ...text.rowTitle,
    flexShrink: 0,
    color: c.ink,
  },
  rowValue: {
    ...text.amount,
    flex: 1,
    minWidth: 0,
    textAlign: "right",
    color: c.muted,
  },
}));
