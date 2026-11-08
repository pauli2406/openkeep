import { useState } from "react";
import { Image, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  disableTwoFactor,
  enableTwoFactor,
  startTwoFactorSetup,
  type TwoFactorSetup,
} from "../../api/account";
import { useAuth } from "../../auth";
import { BottomSheet } from "../../components/layout";
import { Button } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import {
  FormField,
  InlineError,
  SecretBlock,
  SectionCard,
  ShownOnceNote,
  StatusBadge,
  SubHeading,
  errorText,
} from "./shared";

/** Two-factor enrolment, with its one-time recovery codes, and turning it off. */
export function TwoFactorSection() {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const enabled = auth.user?.twoFactorEnabled ?? false;

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function startEnrollment() {
    setError("");
    setBusy(true);
    try {
      setSetup(await startTwoFactorSetup(auth.authFetch, t("twoFactor.requestFailed")));
      setRecoveryCodes(null);
      setCode("");
      setEnrollOpen(true);
    } catch (value) {
      setError(errorText(value, t("twoFactor.startFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnable() {
    if (!setup) return;
    setError("");
    setBusy(true);
    try {
      const codes = await enableTwoFactor(
        auth.authFetch,
        { enrollmentToken: setup.enrollmentToken, code: code.trim() },
        t("twoFactor.requestFailed"),
      );
      // The codes first: they are shown once, and a failed re-read must not lose them.
      setRecoveryCodes(codes);
      setCode("");
      await auth.refreshUser().catch(() => undefined);
    } catch (value) {
      setError(errorText(value, t("twoFactor.invalidCode")));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDisable() {
    setError("");
    setBusy(true);
    try {
      await disableTwoFactor(
        auth.authFetch,
        { password, code: disableCode.trim() },
        t("twoFactor.requestFailed"),
      );
      await auth.refreshUser().catch(() => undefined);
      closeDisable();
    } catch (value) {
      setError(errorText(value, t("twoFactor.disableFailed")));
    } finally {
      setBusy(false);
    }
  }

  function closeEnroll() {
    setEnrollOpen(false);
    setSetup(null);
    setRecoveryCodes(null);
    setCode("");
    setCopied(false);
    setError("");
  }

  function closeDisable() {
    setDisableOpen(false);
    setPassword("");
    setDisableCode("");
    setError("");
  }

  const codeValid = /^\d{6}$/.test(code.trim());

  return (
    <SectionCard
      icon={enabled ? "shield-check-outline" : "shield-off-outline"}
      title={t("twoFactor.title")}
      description={t("twoFactor.description")}
    >
      <View style={styles.status}>
        <StatusBadge
          tone={enabled ? "ok" : "muted"}
          label={enabled ? t("twoFactor.enabled") : t("twoFactor.disabled")}
        />
        <Text style={styles.hint}>
          {enabled ? t("twoFactor.enabledHint") : t("twoFactor.disabledHint")}
        </Text>
      </View>
      {!enrollOpen && !disableOpen && error ? <InlineError message={error} /> : null}
      {enabled ? (
        <Button
          variant="secondary"
          label={t("twoFactor.disable")}
          onPress={() => {
            setError("");
            setDisableOpen(true);
          }}
        />
      ) : (
        <Button label={t("twoFactor.enable")} loading={busy} onPress={() => void startEnrollment()} />
      )}

      <BottomSheet
        visible={enrollOpen}
        onClose={closeEnroll}
        title={recoveryCodes ? t("twoFactor.recoveryTitle") : t("twoFactor.setupTitle")}
        footer={
          recoveryCodes ? (
            <>
              <View style={styles.footerButton}>
                <Button
                  variant="secondary"
                  icon={copied ? "check" : "content-copy"}
                  label={copied ? t("twoFactor.copied") : t("twoFactor.copyCodes")}
                  onPress={() => {
                    void Clipboard.setStringAsync(recoveryCodes.join("\n"));
                    setCopied(true);
                  }}
                />
              </View>
              <View style={styles.footerButton}>
                <Button label={t("settings.done")} onPress={closeEnroll} />
              </View>
            </>
          ) : (
            <View style={styles.footerButton}>
              <Button
                label={t("twoFactor.confirmEnable")}
                disabled={!codeValid}
                loading={busy}
                onPress={() => void confirmEnable()}
              />
            </View>
          )
        }
      >
        {recoveryCodes ? (
          <>
            <Text style={styles.body}>{t("twoFactor.recoveryDescription")}</Text>
            <View style={styles.codes}>
              {recoveryCodes.map((recovery) => (
                <Text key={recovery} selectable style={styles.code}>
                  {recovery}
                </Text>
              ))}
            </View>
            <ShownOnceNote>{t("twoFactor.recoveryOnce")}</ShownOnceNote>
          </>
        ) : setup ? (
          <>
            <Text style={styles.body}>{t("twoFactor.setupDescription")}</Text>
            {/* A data URL from the server. It stays on paper in dark mode, because
                scanners need the contrast. */}
            <View style={styles.qrFrame}>
              <Image
                accessibilityLabel={t("twoFactor.qrAlt")}
                source={{ uri: setup.qrDataUrl }}
                style={styles.qr}
                resizeMode="contain"
              />
            </View>
            <SubHeading>{t("twoFactor.manualSecret")}</SubHeading>
            <SecretBlock value={setup.secret} />
            <FormField
              label={t("twoFactor.codeLabel")}
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              error={error || undefined}
            />
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet
        visible={disableOpen}
        onClose={closeDisable}
        title={t("twoFactor.disableTitle")}
        footer={
          <View style={styles.footerButton}>
            <Button
              variant="danger"
              label={t("twoFactor.disable")}
              disabled={!password || disableCode.trim().length < 6}
              loading={busy}
              onPress={() => void confirmDisable()}
            />
          </View>
        }
      >
        <Text style={styles.body}>{t("twoFactor.disableDescription")}</Text>
        <FormField
          label={t("twoFactor.password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
        />
        <FormField
          label={t("twoFactor.authCode")}
          value={disableCode}
          onChangeText={setDisableCode}
          placeholder="123456"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          error={error || undefined}
        />
      </BottomSheet>
    </SectionCard>
  );
}

const useStyles = createThemedStyles((c) => ({
  status: {
    gap: 8,
    alignItems: "flex-start",
  },
  hint: {
    ...text.body,
    color: c.muted,
  },
  body: {
    ...text.body,
    color: c.muted,
  },
  footerButton: {
    flex: 1,
  },
  qrFrame: {
    alignSelf: "center",
    padding: 8,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.paperBorder,
    backgroundColor: c.paper,
  },
  qr: {
    width: 180,
    height: 180,
  },
  codes: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.accent,
    backgroundColor: c.accentSoft,
  },
  code: {
    ...text.mono,
    width: "47%",
    color: c.accentSoftInk,
  },
}));
