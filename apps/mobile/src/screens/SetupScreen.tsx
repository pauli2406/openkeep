import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { AuthRequestError, useAuth, type ServerConnection } from "../auth";
import { IconTile, Segmented } from "../components/layout";
import { Button } from "../components/ui";
import { useI18n } from "../i18n";
import { createThemedStyles, radii, useColors } from "../theme";
import { fonts, text } from "../typography";
import { AuthFrame } from "./AuthFrame";
import { FormField, errorText, fill } from "./settings/shared";

type DocLanguage = "en" | "de";

function Steps({ current }: { current: number }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const labels = [t("setup.stepAccount"), t("setup.stepLanguage"), t("setup.stepFolder")];
  return (
    <View accessibilityLabel={`${current} / ${labels.length}`} style={styles.steps}>
      {labels.map((label, index) => {
        const number = index + 1;
        const done = number < current;
        const active = number === current;
        return (
          <View
            key={label}
            style={[styles.step, number < labels.length ? styles.stepGrow : null]}
          >
            <View
              style={[
                styles.stepMark,
                done ? styles.stepDone : active ? styles.stepActive : styles.stepTodo,
              ]}
            >
              {done ? (
                <MaterialCommunityIcons name="check" size={13} color={colors.accentSoftInk} />
              ) : (
                <Text style={[styles.stepNumber, active ? styles.stepNumberActive : null]}>
                  {number}
                </Text>
              )}
            </View>
            <Text style={[styles.stepLabel, active ? styles.stepLabelActive : null]} numberOfLines={1}>
              {label}
            </Text>
            {number < labels.length ? <View style={styles.stepRule} /> : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * The first-run wizard: the owner account, the language documents are read in,
 * and where the watch folder is configured.
 *
 * Creating the owner starts the session, which would normally put the app on
 * screen; `AuthProvider` holds that back until `finishSetup`, so the other two
 * steps can still be seen. If this screen is ever remounted in between, it picks
 * up after the account step, because the account now exists.
 */
export function SetupScreen({
  connection,
  onBack,
}: {
  connection: ServerConnection;
  onBack: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t, language } = useI18n();
  const [step, setStep] = useState(auth.isCompletingSetup ? 2 : 1);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [docLanguage, setDocLanguage] = useState<DocLanguage>("de");
  const [error, setError] = useState("");
  const [ownerExists, setOwnerExists] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleCreateOwner() {
    setError("");
    setOwnerExists(false);
    if (!displayName.trim() || !email.trim()) {
      setError(t("setup.errorRequired"));
      return;
    }
    if (password.length < 12) {
      setError(t("setup.errorPasswordLength"));
      return;
    }
    if (password !== confirm) {
      setError(t("setup.errorPasswordsMatch"));
      return;
    }
    setBusy(true);
    try {
      await auth.setupOwner({ ...connection, email, password, displayName });
      setStep(2);
    } catch (value) {
      if (value instanceof AuthRequestError && /owner already exists/i.test(value.message)) {
        setOwnerExists(true);
        setError(t("setup.ownerExists"));
      } else if (/reach|health check|network|timed out|connection/i.test(errorText(value, ""))) {
        setError(t("auth.errorConnection"));
      } else {
        setError(errorText(value, t("setup.failed")));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveLanguage() {
    setBusy(true);
    setError("");
    try {
      await auth.updatePreferences({
        uiLanguage: language,
        aiProcessingLanguage: docLanguage,
        aiChatLanguage: docLanguage,
      });
      setStep(3);
    } catch (value) {
      setError(errorText(value, t("setup.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  if (step === 2) {
    return (
      <AuthFrame title={t("setup.step2Title")} subtitle={t("setup.step2Subtitle")} top={<Steps current={2} />}>
        <View style={styles.field}>
          <Text style={styles.label}>{t("setup.languageLabel")}</Text>
          <Segmented<DocLanguage>
            value={docLanguage}
            onChange={setDocLanguage}
            options={[
              { value: "de", label: "Deutsch" },
              { value: "en", label: "English" },
            ]}
          />
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
        </View>
        <Button label={t("setup.save")} loading={busy} onPress={() => void handleSaveLanguage()} />
        <Button variant="ghost" label={t("setup.skip")} onPress={() => setStep(3)} />
      </AuthFrame>
    );
  }

  if (step === 3) {
    return (
      <AuthFrame title={t("setup.step3Title")} subtitle={t("setup.step3Subtitle")} top={<Steps current={3} />}>
        <View style={styles.folderNote}>
          <IconTile>
            <MaterialCommunityIcons name="folder-sync-outline" size={18} color={colors.accentSoftInk} />
          </IconTile>
          <Text style={styles.folderText}>
            {t("setup.step3BodyBefore")}
            <Text style={styles.folderCode}>WATCH_FOLDER_PATH</Text>
            {t("setup.step3BodyAfter")}
          </Text>
        </View>
        <Button label={t("setup.done")} onPress={auth.finishSetup} />
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title={t("setup.step1Title")}
      subtitle={t("setup.step1Subtitle")}
      top={<Steps current={1} />}
      footer={
        <Text style={styles.footer}>
          {t("setup.alreadySetup")}{" "}
          <Text accessibilityRole="link" style={styles.footerLink} onPress={onBack}>
            {t("setup.signIn")}
          </Text>
        </Text>
      }
    >
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.server}>
        <MaterialCommunityIcons name="server-network" size={15} color={colors.muted} />
        <Text style={styles.serverText} numberOfLines={1}>
          {fill(t("setup.serverLabel"), { url: connection.apiUrl })}
        </Text>
      </Pressable>
      <FormField
        label={t("setup.displayName")}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder={t("setup.yourName")}
        autoComplete="name"
        textContentType="name"
      />
      <FormField
        label={t("setup.email")}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
      />
      <FormField
        label={t("setup.password")}
        value={password}
        onChangeText={setPassword}
        placeholder={t("setup.passwordMin")}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
      />
      <FormField
        label={t("setup.confirmPassword")}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void handleCreateOwner()}
        error={error || undefined}
      />
      <Button
        label={busy ? t("setup.creatingAccount") : t("setup.continue")}
        loading={busy}
        onPress={() => void handleCreateOwner()}
      />
      {ownerExists ? <Button variant="secondary" label={t("setup.signIn")} onPress={onBack} /> : null}
    </AuthFrame>
  );
}

const useStyles = createThemedStyles((c) => ({
  steps: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  stepGrow: {
    flex: 1,
  },
  stepMark: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
  },
  stepDone: {
    backgroundColor: c.accentSoft,
  },
  stepActive: {
    backgroundColor: c.accentFill,
  },
  stepTodo: {
    backgroundColor: c.bar,
  },
  stepNumber: {
    ...text.numericStrong,
    color: c.muted,
  },
  stepNumberActive: {
    color: c.accentFillInk,
  },
  stepLabel: {
    ...text.metaStrong,
    flexShrink: 1,
    color: c.muted,
  },
  stepLabelActive: {
    color: c.ink,
  },
  stepRule: {
    flex: 1,
    minWidth: 8,
    height: 1,
    backgroundColor: c.border,
  },
  field: {
    gap: 6,
  },
  label: {
    ...text.metaStrong,
    color: c.ink,
  },
  error: {
    ...text.body,
    color: c.red,
  },
  folderNote: {
    flexDirection: "row",
    gap: 14,
    padding: 16,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bar,
  },
  folderText: {
    ...text.body,
    flex: 1,
    minWidth: 0,
    color: c.muted,
  },
  folderCode: {
    fontFamily: fonts.mono.regular,
    fontSize: 13,
    color: c.ink,
  },
  footer: {
    ...text.body,
    textAlign: "center",
    color: c.muted,
  },
  footerLink: {
    ...text.bodyStrong,
    color: c.accent,
  },
  server: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
  },
  serverText: {
    ...text.meta,
    flex: 1,
    color: c.muted,
  },
}));
