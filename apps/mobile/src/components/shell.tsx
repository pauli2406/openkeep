import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Animated,
  BackHandler,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { AppStackParamList, HomeTabParamList } from "../../App";
import { useAuth } from "../auth";
import { useDashboardInsights } from "../hooks/useDashboardInsights";
import { useI18n } from "../i18n";
import { createThemedStyles, radii, useAppearance, useColors } from "../theme";
import { fonts, text } from "../typography";
import { Gradient } from "./layout";
import { SHELL_HEADER_HEIGHT, ShellContext, useShell } from "./shell-context";

export { useInShell, useShell } from "./shell-context";

export function ShellProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<keyof HomeTabParamList>("Today");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [omnibarOpen, setOmnibarOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const openOmnibar = useCallback(() => setOmnibarOpen(true), []);
  const closeOmnibar = useCallback(() => setOmnibarOpen(false), []);

  const value = useMemo(
    () => ({
      active,
      setActive,
      drawerOpen,
      openDrawer,
      closeDrawer,
      omnibarOpen,
      openOmnibar,
      closeOmnibar,
    }),
    [active, drawerOpen, openDrawer, closeDrawer, omnibarOpen, openOmnibar, closeOmnibar],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

function initialsOf(name: string) {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

/** The workspace header: the web client's at phone width. */
export function AppHeader() {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const shell = useShell();
  const appearance = useAppearance();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const isDark = appearance.theme === "dark";

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("shell.openMenu")}
        onPress={shell.openDrawer}
        hitSlop={8}
        style={styles.iconButton}
      >
        <MaterialCommunityIcons name="dock-left" size={20} color={colors.muted} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("shell.search")}
        onPress={shell.openOmnibar}
        style={styles.search}
      >
        <MaterialCommunityIcons name="magnify" size={17} color={colors.muted} />
        <Text style={styles.searchText} numberOfLines={1}>
          {t("shell.search")}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("shell.toggleTheme")}
        onPress={() => appearance.setPreference(isDark ? "light" : "dark")}
        hitSlop={8}
        style={styles.iconButton}
      >
        <MaterialCommunityIcons
          name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
          size={18}
          color={colors.muted}
        />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("screens.scanUpload")}
        onPress={() => navigation.navigate("Scan")}
        hitSlop={4}
      >
        <Gradient name="action" borderRadius={radii.lg} style={styles.importButton}>
          <MaterialCommunityIcons name="tray-arrow-up" size={18} color={colors.accentFillInk} />
        </Gradient>
      </Pressable>
    </View>
  );
}

const DRAWER_WIDTH = 288;

/** The web client's sidebar, as it opens on a phone. */
export function AppDrawer() {
  const styles = useStyles();
  const { t } = useI18n();
  const auth = useAuth();
  const shell = useShell();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const insights = useDashboardInsights();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [mounted, setMounted] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (shell.drawerOpen) setMounted(true);
    // Only the visual-regression build runs on web, and its pinned clock would
    // freeze a timed animation at its first frame.
    if (Platform.OS === "web") {
      progress.setValue(shell.drawerOpen ? 1 : 0);
      if (!shell.drawerOpen) setMounted(false);
      return;
    }
    Animated.timing(progress, {
      toValue: shell.drawerOpen ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !shell.drawerOpen) setMounted(false);
    });
  }, [shell.drawerOpen, progress]);

  // The drawer is an overlay rather than a modal, so Android's back button would
  // otherwise act on the screen behind it.
  useEffect(() => {
    if (!shell.drawerOpen) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      shell.closeDrawer();
      return true;
    });
    return () => subscription.remove();
  }, [shell.drawerOpen, shell.closeDrawer]);

  if (!mounted) return null;

  const drawerWidth = Math.min(DRAWER_WIDTH, width - 48);
  const go = (route: keyof HomeTabParamList) => {
    shell.closeDrawer();
    navigation.navigate("Home", { screen: route } as never);
  };

  const main: Array<{
    route: keyof HomeTabParamList;
    label: string;
    icon: string;
    count?: number;
  }> = [
    { route: "Today", label: t("tabs.today"), icon: "weather-sunset-up" },
    {
      route: "Documents",
      label: t("tabs.documents"),
      icon: "file-multiple-outline",
      count: insights.data?.stats.totalDocuments,
    },
    {
      route: "Review",
      label: t("tabs.review"),
      icon: "clipboard-check-outline",
      count: insights.data?.stats.pendingReview,
    },
    { route: "Taxes", label: t("tabs.taxes"), icon: "bank-outline" },
    { route: "Chat", label: t("tabs.chat"), icon: "message-text-outline" },
  ];

  const item = (entry: (typeof main)[number]) => (
    <DrawerItem
      key={entry.route}
      label={entry.label}
      icon={entry.icon}
      count={entry.count}
      active={shell.active === entry.route}
      onPress={() => go(entry.route)}
    />
  );

  const displayName = auth.user?.displayName ?? auth.user?.email ?? "?";

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("shell.closeMenu")}
          style={StyleSheet.absoluteFill}
          onPress={shell.closeDrawer}
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          {
            width: drawerWidth,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-drawerWidth, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Gradient
          name="chrome"
          style={[
            styles.drawerFill,
            { paddingTop: insets.top + 14, paddingBottom: Math.max(insets.bottom, 14) },
          ]}
        >
          <View style={styles.brand}>
            <Image source={require("../../assets/icon.png")} style={styles.brandMark} />
            <Text style={styles.brandText}>OpenKeep</Text>
          </View>
          <View style={styles.drawerGroup}>{main.map(item)}</View>
          <View style={styles.drawerFooter}>
            <DrawerItem
              label={t("tabs.settings")}
              icon="cog-outline"
              active={shell.active === "Settings"}
              onPress={() => go("Settings")}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("tabs.profile")}
              onPress={() => go("Profile")}
              style={[styles.account, shell.active === "Profile" ? styles.accountActive : null]}
            >
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(displayName)}</Text>
              </View>
              <View style={styles.accountText}>
                <Text style={styles.accountName} numberOfLines={1}>
                  {displayName}
                </Text>
                {auth.user?.email && auth.user.email !== displayName ? (
                  <Text style={styles.accountMail} numberOfLines={1}>
                    {auth.user.email}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          </View>
        </Gradient>
      </Animated.View>
    </View>
  );
}

function DrawerItem({
  label,
  icon,
  count,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count ? `${label} ${count}` : label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.item,
        pressed && !active ? styles.itemPressed : null,
        active ? styles.itemActive : null,
      ]}
    >
      <MaterialCommunityIcons
        name={icon as never}
        size={18}
        color={active ? colors.sidebarActiveInk : colors.sidebarInk}
      />
      <Text style={[styles.itemText, active ? styles.itemTextActive : null]} numberOfLines={1}>
        {label}
      </Text>
      {count ? (
        <Text style={[styles.itemCount, active ? styles.itemTextActive : null]}>
          {count.toLocaleString()}
        </Text>
      ) : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((c) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: SHELL_HEADER_HEIGHT,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.app,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.bar,
  },
  searchText: {
    ...text.body,
    flex: 1,
    color: c.muted,
  },
  importButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: c.overlay,
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  drawerFill: {
    flex: 1,
    paddingHorizontal: 12,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 18,
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
  },
  brandText: {
    ...text.barTitle,
    color: c.sidebarHoverInk,
  },
  drawerGroup: {
    gap: 4,
  },
  drawerFooter: {
    marginTop: "auto",
    gap: 4,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    paddingHorizontal: 10,
    borderRadius: radii.lg,
  },
  itemPressed: {
    backgroundColor: c.sidebarHover,
  },
  itemActive: {
    backgroundColor: c.sidebarActive,
  },
  itemText: {
    ...text.body,
    flex: 1,
    color: c.sidebarInk,
  },
  itemTextActive: {
    fontFamily: fonts.sans.medium,
    color: c.sidebarActiveInk,
  },
  itemCount: {
    ...text.numeric,
    color: c.sidebarMuted,
  },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    marginTop: 4,
    paddingHorizontal: 8,
    borderRadius: radii.lg,
  },
  accountActive: {
    backgroundColor: c.sidebarHover,
  },
  avatar: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: c.sidebarHover,
  },
  avatarText: {
    ...text.smallStrong,
    color: c.sidebarHoverInk,
  },
  accountText: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    ...text.bodyStrong,
    color: c.sidebarHoverInk,
  },
  accountMail: {
    ...text.small,
    color: c.sidebarMuted,
  },
}));
