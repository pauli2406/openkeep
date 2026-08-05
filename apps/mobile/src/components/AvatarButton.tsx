import { Pressable, Text } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { createThemedStyles, radii } from "../theme";
import { fonts } from "../typography";
import type { AppStackParamList } from "../../App";

function initialsFor(name: string | undefined) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "OK";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Settings is no longer a tab; it is reached from the avatar in the app bar,
 * as on web. (#107)
 */
export function AvatarButton() {
  const styles = useStyles();
  const auth = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={auth.user?.displayName ?? "Settings"}
      onPress={() => navigation.navigate("Settings")}
      hitSlop={10}
      style={({ pressed }) => [styles.avatar, pressed ? styles.avatarPressed : null]}
    >
      <Text style={styles.initials}>{initialsFor(auth.user?.displayName)}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles((c) => ({
  avatar: {
    height: 28,
    width: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: c.accentSoft,
  },
  avatarPressed: {
    opacity: 0.8,
  },
  initials: {
    fontFamily: fonts.sans.bold,
    fontSize: 10.5,
    lineHeight: 14,
    color: c.accentSoftInk,
  },
}));
