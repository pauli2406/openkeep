import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "../auth";
import { Card, Screen } from "../components/ui";
import { colors, shadow } from "../theme";

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
  const inner = (
    <View style={rowStyles.row}>
      <View style={[rowStyles.iconWrap, tone === "danger" ? rowStyles.iconWrapDanger : null]}>
        <MaterialCommunityIcons
          name={icon as never}
          size={18}
          color={tone === "danger" ? colors.danger : colors.primary}
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

const rowStyles = StyleSheet.create({
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
    backgroundColor: colors.primarySoft,
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
    color: colors.text,
  },
  labelDanger: {
    color: colors.danger,
  },
  value: {
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.75,
  },
});

function Divider() {
  return <View style={dividerStyles.line} />;
}

const dividerStyles = StyleSheet.create({
  line: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 50,
  },
});

function SectionLabel({ label }: { label: string }) {
  return <Text style={sectionStyles.label}>{label}</Text>;
}

const sectionStyles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: -6,
  },
});

export function SettingsScreen() {
  const auth = useAuth();

  function handleLogout() {
    Alert.alert("Log out", "Are you sure you want to disconnect from this archive?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => void auth.logout(),
      },
    ]);
  }

  return (
    <Screen title="Settings" subtitle="Manage your archive connection and account.">
      {/* Account */}
      <SectionLabel label="Account" />
      <Card>
        <SettingsRow
          icon="account-circle-outline"
          label={auth.user?.displayName ?? "User"}
          value={auth.user?.email}
        />
        {auth.user?.isOwner ? (
          <>
            <Divider />
            <SettingsRow icon="shield-check-outline" label="Owner account" />
          </>
        ) : null}
      </Card>

      {/* Archive connection */}
      <SectionLabel label="Archive" />
      <Card>
        <SettingsRow
          icon="server-network"
          label="Connected archive"
          value={auth.apiUrl || "Not connected"}
        />
      </Card>

      {/* About */}
      <SectionLabel label="About" />
      <Card>
        <SettingsRow icon="information-outline" label="Version" value={APP_VERSION} />
        <Divider />
        <SettingsRow icon="bookshelf" label="OpenKeep" value="Personal document archive" />
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
          <MaterialCommunityIcons name="logout" size={18} color={colors.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>OpenKeep Mobile {APP_VERSION}</Text>
        <Text style={styles.footerText}>Your documents. Your archive. Your terms.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    ...shadow,
    shadowOpacity: 0.06,
  },
  logoutButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  logoutText: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.danger,
    letterSpacing: 0.1,
  },
  footer: {
    alignItems: "center",
    paddingVertical: 12,
    gap: 4,
  },
  footerText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
});
