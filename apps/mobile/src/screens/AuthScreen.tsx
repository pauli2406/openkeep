import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button, Card, Field, Screen } from "../components/ui";
import { useAuth } from "../auth";
import { colors } from "../theme";

type Mode = "login" | "setup";

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [apiUrl, setApiUrl] = useState(auth.apiUrl || "http://localhost:3000");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    setError("");
    setBusy(true);
    try {
      if (mode === "setup") {
        if (password.length < 12) {
          throw new Error("Password must be at least 12 characters.");
        }
        if (password !== confirmPassword) {
          throw new Error("Passwords do not match.");
        }
        await auth.setup({ apiUrl, displayName, email, password });
      } else {
        await auth.login({ apiUrl, email, password });
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="Archive in your pocket"
      subtitle="Point the app at your OpenKeep server, then sign in or create the initial owner account."
      contentContainerStyle={styles.content}
      headerVariant="compact"
    >
      <Card>
        <View style={styles.introRow}>
          <View style={styles.introBadge}>
            <Text style={styles.introBadgeText}>{mode === "setup" ? "First-time setup" : "Secure sign-in"}</Text>
          </View>
          <Text style={styles.introText}>
            {mode === "setup"
              ? "Create the owner account that will manage this archive."
              : "Use the same server URL and account credentials as your OpenKeep workspace."}
          </Text>
        </View>

        <View style={styles.segmentWrap}>
          {(["login", "setup"] as const).map((value) => (
            <Pressable
              key={value}
              onPress={() => setMode(value)}
              style={({ pressed }) => [
                styles.segment,
                mode === value ? styles.segmentActive : null,
                pressed ? styles.segmentPressed : null,
              ]}
            >
              <Text style={[styles.segmentText, mode === value ? styles.segmentTextActive : null]}>
                {value === "login" ? "Sign in" : "Setup"}
              </Text>
            </Pressable>
          ))}
        </View>

        <Field
          label="Server URL"
          value={apiUrl}
          onChangeText={setApiUrl}
          keyboardType="url"
          autoCapitalize="none"
          placeholder="https://archive.example.com"
        />

        {mode === "setup" ? (
          <Field label="Display name" value={displayName} onChangeText={setDisplayName} />
        ) : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder={mode === "setup" ? "Minimum 12 characters" : "Your account password"}
        />
        {mode === "setup" ? (
          <Field
            label="Confirm password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          label={mode === "setup" ? "Create owner account" : "Sign in"}
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
  segmentWrap: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 20,
    padding: 5,
    gap: 6,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  segmentActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.accent,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  segmentPressed: {
    opacity: 0.94,
  },
  segmentText: {
    color: colors.muted,
    fontWeight: "700",
    fontSize: 15,
  },
  segmentTextActive: {
    color: colors.text,
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
