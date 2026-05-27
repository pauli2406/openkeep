import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button, Card, Field, Screen } from "../components/ui";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import { colors } from "../theme";

export function AuthScreen() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const [apiUrl, setApiUrl] = useState(auth.apiUrl || "http://localhost:3000");
  const [apiToken, setApiToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasCachedDocuments = offline.cacheSummary.documentCount > 0;

  async function handleSubmit() {
    setError("");
    setBusy(true);
    try {
      if (!apiToken.trim()) {
        throw new Error(t("auth.errorApiTokenRequired"));
      }
      await auth.connect({ apiUrl, apiToken });
    } catch (value) {
      if (value instanceof Error) {
        if (value.message === t("auth.errorApiTokenRequired")) {
          setError(value.message);
        } else if (/api token|bearer token|401|unauthorized|unknown token|invalid token|malformed/i.test(value.message)) {
          setError(t("auth.errorInvalidToken"));
        } else if (/reach|health check|network|timed out|connection/i.test(value.message)) {
          setError(t("auth.errorConnection"));
        } else {
          setError(value.message);
        }
      } else {
        setError(t("auth.errorGeneric"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title={t("auth.title")}
      subtitle={t("auth.subtitle")}
      contentContainerStyle={styles.content}
      headerVariant="compact"
    >
      <Card>
        <View style={styles.introRow}>
          <View style={styles.introBadge}>
            <Text style={styles.introBadgeText}>{t("auth.connectBadge")}</Text>
          </View>
          <Text style={styles.introText}>{t("auth.connectIntro")}</Text>
          {!hasCachedDocuments && auth.apiUrl ? (
            <Text style={styles.error}>{t("auth.offlineSnapshotRequired")}</Text>
          ) : null}
        </View>

        <Field
          label={t("auth.serverUrl")}
          value={apiUrl}
          onChangeText={setApiUrl}
          keyboardType="url"
          autoCapitalize="none"
          placeholder="https://archive.example.com"
        />

        <Field
          label={t("auth.apiToken")}
          value={apiToken}
          onChangeText={setApiToken}
          autoCapitalize="none"
          secureTextEntry
          placeholder={t("auth.apiTokenPlaceholder")}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={t("auth.connectArchive")}
          onPress={handleSubmit}
          loading={busy}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
  },
  introRow: {
    gap: 10,
  },
  introBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  introBadgeText: {
    color: colors.primaryDeep,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  introText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
  },
  error: {
    color: colors.danger,
    fontWeight: "600",
    lineHeight: 20,
    backgroundColor: "#f8e2de",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
});
