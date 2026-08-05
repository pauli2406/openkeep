import { useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Button, Row, Screen } from "../components/ui";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";

/** `1,8 GB` — the same figure the offline screen and Settings show. */
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
 * First run (#118). Two fields, one action, and the offline copy as a row
 * rather than a red warning. Cloudflare Access sits behind a disclosure,
 * because almost nobody needs it.
 */
export function AuthScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();

  const [apiUrl, setApiUrl] = useState(auth.apiUrl || "http://localhost:3000");
  const [apiToken, setApiToken] = useState("");
  const [revealToken, setRevealToken] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [cfAccessClientId, setCfAccessClientId] = useState("");
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [tokenError, setTokenError] = useState("");

  const cachedCount = offline.cacheSummary.documentCount;

  async function handleSubmit() {
    setUrlError("");
    setTokenError("");
    setBusy(true);
    try {
      if (!apiToken.trim()) {
        setTokenError(t("auth.errorApiTokenRequired"));
        return;
      }
      await auth.connect({ apiUrl, apiToken, cfAccessClientId, cfAccessClientSecret });
    } catch (value) {
      const message = value instanceof Error ? value.message : t("auth.errorGeneric");
      // The error goes under the field it is about.
      if (/api token|bearer token|401|unauthorized|unknown token|invalid token|malformed/i.test(message)) {
        setTokenError(t("auth.errorInvalidToken"));
      } else if (/reach|health check|network|timed out|connection/i.test(message)) {
        setUrlError(t("auth.errorConnection"));
      } else {
        setUrlError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenOffline() {
    const opened = await auth.openOfflineCopy();
    if (!opened) {
      setUrlError(t("auth.offlineOpenFailed"));
    }
  }

  return (
    <Screen title={t("auth.title")} padded={false}>
      <View style={styles.intro}>
        <Image source={require("../../assets/icon.png")} style={styles.logo} />
        <Text style={styles.heading}>{t("auth.connectTitle")}</Text>
        <Text style={styles.lede}>{t("auth.whereToken")}</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={styles.label}>{t("auth.serverUrl")}</Text>
          <TextInput
            value={apiUrl}
            onChangeText={setApiUrl}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://archive.example.com"
            placeholderTextColor={colors.dim}
            style={styles.input}
          />
          {urlError ? <Text style={styles.error}>{urlError}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>{t("auth.apiToken")}</Text>
          <View style={styles.inputRow}>
            <TextInput
              value={apiToken}
              onChangeText={setApiToken}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!revealToken}
              placeholder={t("auth.apiTokenPlaceholder")}
              placeholderTextColor={colors.dim}
              style={styles.tokenInput}
            />
            <Pressable onPress={() => setRevealToken((current) => !current)} hitSlop={10}>
              <Text style={styles.reveal}>{revealToken ? t("auth.hide") : t("auth.reveal")}</Text>
            </Pressable>
          </View>
          {tokenError ? <Text style={styles.error}>{tokenError}</Text> : null}
        </View>

        <Button
          label={t("auth.connectArchive")}
          onPress={() => void handleSubmit()}
          loading={busy}
        />
      </View>

      {/* Almost nobody needs this, so it stays folded away */}
      <Row
        minHeight={50}
        leading={
          <MaterialCommunityIcons
            name={cfOpen ? "chevron-down" : "chevron-right"}
            size={18}
            color={colors.dim}
          />
        }
        title={t("auth.cloudflare")}
        value={t("auth.optional")}
        onPress={() => setCfOpen((current) => !current)}
      />
      {cfOpen ? (
        <View style={styles.form}>
          <Text style={styles.lede}>{t("auth.cloudflareHint")}</Text>
          <View style={styles.field}>
            <Text style={styles.label}>{t("auth.cfClientId")}</Text>
            <TextInput
              value={cfAccessClientId}
              onChangeText={setCfAccessClientId}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="xxxxxxxx.access"
              placeholderTextColor={colors.dim}
              style={styles.input}
            />
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>{t("auth.cfClientSecret")}</Text>
            <TextInput
              value={cfAccessClientSecret}
              onChangeText={setCfAccessClientSecret}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholderTextColor={colors.dim}
              style={styles.input}
            />
          </View>
        </View>
      ) : null}

      {/* The working case, as a row — not a red warning */}
      {cachedCount > 0 ? (
        <Row
          leading={<MaterialCommunityIcons name="database-outline" size={18} color={colors.dim} />}
          title={t("auth.openOfflineCopy")}
          meta={`${cachedCount} ${t("auth.offlineCopyMeta")} · ${formatBytes(offline.cacheSummary.fileStorageBytes)}`}
          metaMono
          chevron
          onPress={() => void handleOpenOffline()}
        />
      ) : auth.apiUrl ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>{t("auth.offlineSnapshotRequired")}</Text>
        </View>
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  intro: {
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 22,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
  },
  heading: {
    ...text.screenTitle,
    color: c.ink,
    textAlign: "center",
  },
  lede: {
    ...text.meta,
    color: c.dim,
    textAlign: "center",
    maxWidth: 300,
  },
  form: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    gap: 14,
  },
  field: {
    gap: 6,
  },
  label: {
    ...text.meta,
    color: c.muted,
  },
  input: {
    ...text.body,
    height: 44,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: 9,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 12,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: 9,
    backgroundColor: c.panel,
    paddingHorizontal: 12,
  },
  tokenInput: {
    ...text.amount,
    flex: 1,
    minWidth: 0,
    color: c.ink,
    padding: 0,
  },
  reveal: {
    ...text.smallStrong,
    color: c.accent,
  },
  error: {
    ...text.small,
    color: c.red,
  },
  note: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  noteText: {
    ...text.small,
    color: c.dim,
    textAlign: "center",
  },
}));
