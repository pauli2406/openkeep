import "react-native-gesture-handler";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer, DefaultTheme, useNavigation } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/auth";
import { I18nProvider, useI18n } from "./src/i18n";
import { OfflineArchiveProvider, useOfflineArchive } from "./src/offline-archive";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { DocumentDetailScreen } from "./src/screens/DocumentDetailScreen";
import { DocumentsScreen } from "./src/screens/DocumentsScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { CorrespondentDossierScreen } from "./src/screens/CorrespondentDossierScreen";
import { CorrespondentsScreen } from "./src/screens/CorrespondentsScreen";
import { AuthScreen } from "./src/screens/AuthScreen";
import { createThemedStyles, radii, useColors } from "./src/theme";
import { fontAssets, fonts, text } from "./src/typography";
import { useDashboardInsights } from "./src/hooks/useDashboardInsights";

export type AppStackParamList = {
  Home: undefined;
  DocumentDetail: { documentId: string; title?: string };
  Scan: undefined;
  Settings: undefined;
  Correspondents: undefined;
  CorrespondentDossier: { slug: string; name: string };
};

/** Review is a tab, not a stack screen — it is the daily job. */
export type HomeTabParamList = {
  Today: undefined;
  Documents: undefined;
  Review: undefined;
  Chat: undefined;
};

const TAB_ICONS: Record<keyof HomeTabParamList, string> = {
  Today: "view-list-outline",
  Documents: "file-multiple-outline",
  Review: "check-circle-outline",
  Chat: "message-outline",
};

/** Without the bottom inset. */
const TAB_BAR_HEIGHT = 54;

const queryClient = new QueryClient();
const Stack = createNativeStackNavigator<AppStackParamList>();
const Tabs = createBottomTabNavigator<HomeTabParamList>();

function HomeTabs() {
  const colors = useColors();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [activeTab, setActiveTab] = useState<keyof HomeTabParamList>("Today");
  const { t } = useI18n();
  const insights = useDashboardInsights();

  const pendingReview = insights.data?.stats.pendingReview ?? 0;
  const totalDocuments = insights.data?.stats.totalDocuments ?? 0;

  // The FAB sits above the tab bar everywhere except Review, where confirm and
  // skip are the two primary actions and nothing may compete with them.
  const showFab = activeTab !== "Review";

  return (
    <View style={styles.flex}>
      <Tabs.Navigator
        screenListeners={{
          state: (e) => {
            const state = (e.data as { state: { index: number; routeNames: string[] } }).state;
            if (state) {
              setActiveTab(state.routeNames[state.index] as keyof HomeTabParamList);
            }
          },
        }}
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.faint,
          tabBarStyle: [
            styles.tabBar,
            {
              height: TAB_BAR_HEIGHT + insets.bottom,
              paddingBottom: insets.bottom,
            },
          ],
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons
              name={TAB_ICONS[route.name] as never}
              size={21}
              color={color}
            />
          ),
        })}
      >
        <Tabs.Screen
          name="Today"
          component={DashboardScreen}
          options={{ title: t("tabs.today"), tabBarLabel: t("tabs.today") }}
        />
        <Tabs.Screen
          name="Documents"
          component={DocumentsScreen}
          options={{
            title: t("tabs.documents"),
            tabBarLabel: t("tabs.documents"),
            tabBarBadge: totalDocuments > 0 ? totalDocuments : undefined,
            tabBarBadgeStyle: styles.countBadge,
          }}
        />
        <Tabs.Screen
          name="Review"
          component={ReviewScreen}
          options={{
            title: t("tabs.review"),
            tabBarLabel: t("tabs.review"),
            // A dot, not a number: the count is already the first Today stat.
            tabBarBadge: pendingReview > 0 ? "" : undefined,
            tabBarBadgeStyle: styles.dotBadge,
          }}
        />
        <Tabs.Screen
          name="Chat"
          component={SearchScreen}
          options={{ title: t("tabs.chat"), tabBarLabel: t("tabs.chat") }}
        />
      </Tabs.Navigator>

      {showFab ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("screens.scanUpload")}
          onPress={() => navigation.navigate("Scan")}
          style={({ pressed }) => [
            styles.fab,
            { bottom: TAB_BAR_HEIGHT + insets.bottom + 12 },
            pressed ? styles.fabPressed : null,
          ]}
        >
          <MaterialCommunityIcons name="line-scan" size={23} color={colors.accentFillInk} />
        </Pressable>
      ) : null}
    </View>
  );
}

function AppNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();

  const hasCachedDocuments = offline.cacheSummary.documentCount > 0;

  // The type scale is only right once the bundled faces are registered, so the
  // splash keeps the app behind the same gate that already waits on auth.
  if (!fontsLoaded || auth.isLoading || !offline.isReady) {
    return (
      <SafeAreaView style={styles.loadingRoot}>
        <ActivityIndicator size="large" color={colors.accent} />
        <Text style={styles.loadingTitle}>{t("app.loadingTitle")}</Text>
        <Text style={styles.loadingText}>{t("app.loadingText")}</Text>
      </SafeAreaView>
    );
  }

  const canEnterApp = auth.isAuthenticated && (!auth.isOfflineSession || hasCachedDocuments);

  if (!canEnterApp) {
    return (
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.panel },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.app },
        }}
      >
        <Stack.Screen
          name="Home"
          component={AuthScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    );
  }

  return (
    <>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.panel },
          headerTintColor: colors.ink,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.app },
        }}
      >
        <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="DocumentDetail"
          component={DocumentDetailScreen}
          options={{ title: "" }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Scan"
          component={ScanScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Correspondents"
          component={CorrespondentsScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="CorrespondentDossier"
          component={CorrespondentDossierScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </>
  );
}

function Root() {
  const styles = useStyles();
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AppShell />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function AppShell() {
  const colors = useColors();
  const auth = useAuth();
  const [fontsLoaded] = useFonts(fontAssets);
  const theme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: colors.app,
        card: colors.panel,
        primary: colors.accent,
        text: colors.ink,
        border: colors.border,
        notification: colors.accent,
      },
    }),
    [colors],
  );

  return (
    <I18nProvider language={auth.user?.preferences.uiLanguage}>
      <OfflineArchiveProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="dark" />
          <AppNavigator fontsLoaded={fontsLoaded} />
        </NavigationContainer>
      </OfflineArchiveProvider>
    </I18nProvider>
  );
}

export default Root;

const useStyles = createThemedStyles((c) => ({
  flex: {
    flex: 1,
  },
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.app,
    gap: 12,
    padding: 24,
  },
  // This screen is what shows *while* `useFonts` is still resolving, so it must
  // not name a bundled face — React Native raises "fontFamily is not a system
  // font and has not been loaded" for an unregistered family.
  loadingTitle: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: c.ink,
  },
  loadingText: {
    fontSize: 12.5,
    lineHeight: 17,
    color: c.muted,
    textAlign: "center",
  },
  tabBar: {
    backgroundColor: c.bar,
    borderTopWidth: 1,
    borderTopColor: c.border,
    paddingTop: 6,
  },
  tabBarLabel: {
    fontFamily: fonts.sans.medium,
    fontSize: 10,
    lineHeight: 14,
  },
  countBadge: {
    ...text.numeric,
    fontSize: 9.5,
    lineHeight: 13,
    minWidth: 16,
    height: 14,
    borderRadius: radii.sm,
    backgroundColor: c.raised,
    color: c.dim,
  },
  dotBadge: {
    minWidth: 7,
    width: 7,
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: c.amber,
  },
  fab: {
    position: "absolute",
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: c.accentFill,
    alignItems: "center",
    justifyContent: "center",
  },
  fabPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.94 }],
  },
}));
