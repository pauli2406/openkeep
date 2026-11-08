import { useEffect, useState } from "react";
import { Switch, Text, View } from "react-native";
import { useAuth } from "../../auth";
import { Segmented } from "../../components/layout";
import { Button } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, useColors } from "../../theme";
import { text } from "../../typography";
import { SectionCard, SettingBlock, errorText, useIsOffline } from "./shared";

type LanguageField = "uiLanguage" | "aiProcessingLanguage" | "aiChatLanguage";
type Language = "en" | "de";

/** Language preferences and the email digest, saved together as on the web. */
export function LanguageSection() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useIsOffline();
  const saved = auth.user?.preferences;
  const [draft, setDraft] = useState({
    uiLanguage: (saved?.uiLanguage ?? "en") as Language,
    aiProcessingLanguage: (saved?.aiProcessingLanguage ?? "en") as Language,
    aiChatLanguage: (saved?.aiChatLanguage ?? "en") as Language,
    emailDigestEnabled: saved?.emailDigestEnabled ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; message: string } | null>(null);

  useEffect(() => {
    if (saved) {
      setDraft({
        uiLanguage: saved.uiLanguage,
        aiProcessingLanguage: saved.aiProcessingLanguage,
        aiChatLanguage: saved.aiChatLanguage,
        emailDigestEnabled: saved.emailDigestEnabled ?? false,
      });
    }
  }, [saved]);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      await auth.updatePreferences(draft);
      setStatus({ tone: "ok", message: t("settings.preferencesSaved") });
    } catch (error) {
      setStatus({ tone: "bad", message: errorText(error, t("settings.preferencesSaveFailed")) });
    } finally {
      setSaving(false);
    }
  }

  const languageOptions: Array<{ value: Language; label: string }> = [
    { value: "en", label: t("settings.english") },
    { value: "de", label: t("settings.german") },
  ];
  const rows: Array<{ field: LanguageField; label: string; hint: string }> = [
    {
      field: "uiLanguage",
      label: t("settings.uiLanguage"),
      hint: t("settings.uiLanguageHint"),
    },
    {
      field: "aiProcessingLanguage",
      label: t("settings.aiProcessingLanguage"),
      hint: t("settings.aiProcessingLanguageHint"),
    },
    {
      field: "aiChatLanguage",
      label: t("settings.aiChatLanguage"),
      hint: t("settings.aiChatLanguageHint"),
    },
  ];

  return (
    <SectionCard
      icon="translate"
      title={t("settings.languagePreferences")}
      description={t("settings.languagePreferencesDescription")}
      footer={
        offline ? (
          <Text style={styles.offlineNote}>{t("settings.preferencesOffline")}</Text>
        ) : (
          <>
            <Button
              label={saving ? t("settings.saving") : t("settings.savePreferences")}
              loading={saving}
              onPress={() => void handleSave()}
            />
            {status ? (
              <Text
                accessibilityRole={status.tone === "bad" ? "alert" : undefined}
                style={[styles.status, status.tone === "bad" ? styles.statusBad : styles.statusOk]}
              >
                {status.message}
              </Text>
            ) : null}
          </>
        )
      }
    >
      {rows.map((row) => (
        <SettingBlock key={row.field} label={row.label} description={row.hint}>
          {/* Dimmed rather than removed: reading these offline is still useful. */}
          <View
            pointerEvents={offline ? "none" : "auto"}
            style={offline ? styles.readOnly : undefined}
            accessibilityState={{ disabled: offline }}
          >
            <Segmented
              value={draft[row.field]}
              onChange={(value) => setDraft((current) => ({ ...current, [row.field]: value }))}
              options={languageOptions}
            />
          </View>
        </SettingBlock>
      ))}
      <View style={styles.digest}>
        <View style={styles.digestText}>
          <Text style={styles.digestLabel}>{t("settings.emailDigest")}</Text>
          <Text style={styles.digestHint}>{t("settings.emailDigestDescription")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("settings.emailDigest")}
          disabled={offline}
          value={draft.emailDigestEnabled}
          onValueChange={(value) =>
            setDraft((current) => ({ ...current, emailDigestEnabled: value }))
          }
          trackColor={{ false: colors.borderStrong, true: colors.accentFill }}
          thumbColor={colors.onGradient}
        />
      </View>
    </SectionCard>
  );
}

const useStyles = createThemedStyles((c) => ({
  readOnly: {
    opacity: 0.55,
  },
  digest: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  digestText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  digestLabel: {
    ...text.bodyStrong,
    color: c.ink,
  },
  digestHint: {
    ...text.meta,
    color: c.muted,
  },
  status: {
    ...text.body,
    flexShrink: 1,
  },
  statusOk: {
    color: c.green,
  },
  statusBad: {
    color: c.red,
  },
  offlineNote: {
    ...text.body,
    flex: 1,
    color: c.muted,
  },
}));
