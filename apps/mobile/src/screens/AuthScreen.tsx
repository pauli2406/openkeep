import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { AuthRequestError, useAuth } from "../auth";
import { Button, Panel, Row } from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles, radii, useColors } from "../theme";
import { fonts, text } from "../typography";
import { AuthFrame } from "./AuthFrame";
import { FormField, errorText, formatBytes } from "./settings/shared";
import { SetupScreen } from "./SetupScreen";

type Mode = "password" | "token" | "twoFactor" | "setup";

function looksLikeConnectionProblem(message: string) {
  return /reach|health check|network|timed out|connection/i.test(message);
}

/**
 * Connecting to an archive. A phone, unlike a browser on the same origin, has to
 * be told which server first, so the URL leads; then the web's sign-in form and its
 * two-factor step. An API token stays available as the secondary way in, and the
 * offline copy as a row, not a red warning.
 */
export function AuthScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();

  const [mode, setMode] = useState<Mode>(auth.isCompletingSetup ? "setup" : "password");
  const [apiUrl, setApiUrl] = useState(auth.apiUrl || "http://localhost:3000");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [revealToken, setRevealToken] = useState(false);
  const [cfOpen, setCfOpen] = useState(false);
  const [cfAccessClientId, setCfAccessClientId] = useState("");
  const [cfAccessClientSecret, setCfAccessClientSecret] = useState("");
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [formError, setFormError] = useState("");

  const connection = { apiUrl, cfAccessClientId, cfAccessClientSecret };
  const cachedCount = offline.cacheSummary.documentCount;

  function clearErrors() {
    setUrlError("");
    setFormError("");
  }

  function validateUrl() {
    if (apiUrl.trim()) return true;
    setUrlError(t("auth.errorServerUrlRequired"));
    return false;
  }

  /** The error goes under the field it is about. */
  function reportCredentialFailure(value: unknown, refused: string) {
    const message = errorText(value, t("login.failed"));
    if (value instanceof AuthRequestError) {
      if (value.status === 429) setFormError(t("login.tooManyAttempts"));
      else if (value.status === 400 || value.status === 401) setFormError(refused);
      else setFormError(message);
    } else if (looksLikeConnectionProblem(message)) {
      setUrlError(t("auth.errorConnection"));
    } else {
      setFormError(message);
    }
  }

  async function handleSignIn() {
    clearErrors();
    if (!validateUrl()) return;
    if (!email.trim() || !password) {
      setFormError(t("login.credentialsRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await auth.login({ ...connection, email, password });
      if (result.requiresTwoFactor) {
        setTwoFactorToken(result.twoFactorToken);
        setCode("");
        setUseRecoveryCode(false);
        setMode("twoFactor");
      }
    } catch (value) {
      reportCredentialFailure(value, t("login.invalidCredentials"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!twoFactorToken) return;
    clearErrors();
    if (!code.trim()) {
      setFormError(t("login.codeRequired"));
      return;
    }
    setBusy(true);
    try {
      await auth.completeTwoFactorLogin({ ...connection, twoFactorToken, code });
    } catch (value) {
      // There is no server field on this step, so a connection failure is said here.
      const message = errorText(value, t("login.invalidCode"));
      if (!(value instanceof AuthRequestError) && looksLikeConnectionProblem(message)) {
        setFormError(t("auth.errorConnection"));
      } else {
        reportCredentialFailure(value, t("login.invalidCode"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleConnectToken() {
    clearErrors();
    if (!validateUrl()) return;
    if (!apiToken.trim()) {
      setFormError(t("auth.errorApiTokenRequired"));
      return;
    }
    setBusy(true);
    try {
      await auth.connect({ apiUrl, apiToken, cfAccessClientId, cfAccessClientSecret });
    } catch (value) {
      const message = value instanceof Error ? value.message : t("auth.errorGeneric");
      if (/api token|bearer token|401|unauthorized|unknown token|invalid token|malformed/i.test(message)) {
        setFormError(t("auth.errorInvalidToken"));
      } else if (looksLikeConnectionProblem(message)) {
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

  if (mode === "setup") {
    return (
      <SetupScreen
        connection={connection}
        onBack={() => {
          clearErrors();
          setMode("password");
        }}
      />
    );
  }

  if (mode === "twoFactor") {
    return (
      <AuthFrame
        title={t("login.twoFactorTitle")}
        subtitle={useRecoveryCode ? t("login.recoverySubtitle") : t("login.twoFactorSubtitle")}
      >
        <FormField
          label={useRecoveryCode ? t("login.recoveryLabel") : t("login.codeLabel")}
          value={code}
          onChangeText={setCode}
          placeholder={useRecoveryCode ? "xxxx-xxxx" : "123456"}
          keyboardType={useRecoveryCode ? "default" : "number-pad"}
          maxLength={useRecoveryCode ? 20 : 6}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          autoFocus
          returnKeyType="go"
          onSubmitEditing={() => void handleVerify()}
          mono
          error={formError || undefined}
        />
        <Button label={t("login.verify")} loading={busy} onPress={() => void handleVerify()} />
        <View style={styles.secondary}>
          <Button
            variant="ghost"
            label={useRecoveryCode ? t("login.useTotp") : t("login.useRecovery")}
            onPress={() => {
              setUseRecoveryCode((current) => !current);
              setCode("");
              clearErrors();
            }}
          />
          <Button
            variant="ghost"
            icon="arrow-left"
            label={t("login.back")}
            onPress={() => {
              setTwoFactorToken(null);
              setCode("");
              clearErrors();
              setMode("password");
            }}
          />
        </View>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      title={mode === "token" ? t("auth.connectTitle") : t("login.signIn")}
      subtitle={mode === "token" ? t("login.tokenSubtitle") : t("login.subtitle")}
      footer={
        mode === "password" ? (
          <Text style={styles.footer}>
            {t("login.needSetup")}{" "}
            <Text
              accessibilityRole="link"
              style={styles.footerLink}
              onPress={() => {
                clearErrors();
                if (validateUrl()) setMode("setup");
              }}
            >
              {t("login.goToSetup")}
            </Text>
          </Text>
        ) : undefined
      }
    >
      <FormField
        label={t("auth.serverUrl")}
        value={apiUrl}
        onChangeText={setApiUrl}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="https://archive.example.com"
        textContentType="URL"
        error={urlError || undefined}
      />

      {mode === "password" ? (
        <>
          <FormField
            label={t("login.email")}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
          />
          <FormField
            label={t("login.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void handleSignIn()}
            error={formError || undefined}
          />
          <Button
            label={busy ? t("login.signingIn") : t("login.signIn")}
            loading={busy}
            onPress={() => void handleSignIn()}
          />
        </>
      ) : (
        <>
          <FormField
            label={t("auth.apiToken")}
            value={apiToken}
            onChangeText={setApiToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!revealToken}
            placeholder={t("auth.apiTokenPlaceholder")}
            mono
            error={formError || undefined}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => setRevealToken((current) => !current)}
            hitSlop={10}
            style={styles.reveal}
          >
            <Text style={styles.revealText}>{revealToken ? t("auth.hide") : t("auth.reveal")}</Text>
          </Pressable>
          <Button
            label={t("auth.connectArchive")}
            loading={busy}
            onPress={() => void handleConnectToken()}
          />
        </>
      )}

      <Button
        variant="ghost"
        label={mode === "password" ? t("login.useToken") : t("login.usePassword")}
        onPress={() => {
          clearErrors();
          setMode(mode === "password" ? "token" : "password");
        }}
      />

      {/* Almost nobody needs this, so it stays folded away */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: cfOpen }}
        onPress={() => setCfOpen((current) => !current)}
        style={styles.disclosure}
      >
        <MaterialCommunityIcons
          name={cfOpen ? "chevron-down" : "chevron-right"}
          size={18}
          color={colors.muted}
        />
        <Text style={styles.disclosureText}>{t("auth.cloudflare")}</Text>
        <Text style={styles.disclosureMeta}>{t("auth.optional")}</Text>
      </Pressable>
      {cfOpen ? (
        <View style={styles.cf}>
          <Text style={styles.cfHint}>{t("auth.cloudflareHint")}</Text>
          <FormField
            label={t("auth.cfClientId")}
            value={cfAccessClientId}
            onChangeText={setCfAccessClientId}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="xxxxxxxx.access"
          />
          <FormField
            label={t("auth.cfClientSecret")}
            value={cfAccessClientSecret}
            onChangeText={setCfAccessClientSecret}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>
      ) : null}

      {/* Cached rows are not enough: without a stored user there is no session to
          restore, and the row would lead nowhere. */}
      {cachedCount > 0 && auth.hasRestorableSession ? (
        <Panel style={styles.offlinePanel}>
          <Row
            leading={<MaterialCommunityIcons name="database-outline" size={18} color={colors.muted} />}
            title={t("auth.openOfflineCopy")}
            meta={`${cachedCount} ${t("auth.offlineCopyMeta")} · ${formatBytes(offline.cacheSummary.fileStorageBytes)}`}
            metaMono
            chevron
            onPress={() => void handleOpenOffline()}
          />
        </Panel>
      ) : auth.apiUrl ? (
        <Text style={styles.note}>{t("auth.offlineSnapshotRequired")}</Text>
      ) : null}
    </AuthFrame>
  );
}

const useStyles = createThemedStyles((c) => ({
  secondary: {
    gap: 2,
  },
  footer: {
    ...text.body,
    textAlign: "center",
    color: c.muted,
  },
  footerLink: {
    fontFamily: fonts.sans.medium,
    color: c.accent,
  },
  reveal: {
    alignSelf: "flex-end",
    marginTop: -6,
    minHeight: 24,
  },
  revealText: {
    ...text.smallStrong,
    color: c.accent,
  },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
  },
  disclosureText: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  disclosureMeta: {
    ...text.meta,
    color: c.muted,
  },
  cf: {
    gap: 12,
    padding: 14,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
  },
  cfHint: {
    ...text.meta,
    color: c.muted,
  },
  offlinePanel: {
    overflow: "hidden",
  },
  note: {
    ...text.small,
    textAlign: "center",
    color: c.muted,
  },
}));
