import "react-native-gesture-handler";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer, DefaultTheme, useNavigation } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
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
import { colors, shadow } from "./src/theme";

export type AppStackParamList = {
  Home: undefined;
  DocumentDetail: { documentId: string; title?: string };
  Review: undefined;
  Scan: undefined;
  Correspondents: undefined;
  CorrespondentDossier: { slug: string; name: string };
};

export type HomeTabParamList = {
  Dashboard: undefined;
  Documents: undefined;
  Search: undefined;
  Settings: undefined;
};

const queryClient = new QueryClient();
const Stack = createNativeStackNavigator<AppStackParamList>();
const Tabs = createBottomTabNavigator<HomeTabParamList>();

function HomeTabs() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [activeTab, setActiveTab] = useState<keyof HomeTabParamList>("Dashboard");
  const { t } = useI18n();

  const showFab = activeTab !== "Settings";

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
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: [
            styles.tabBar,
            {
              height: 62 + insets.bottom,
              paddingBottom: Math.max(insets.bottom, 10),
            },
          ],
          tabBarLabelStyle: styles.tabBarLabel,
          tabBarIcon: ({ color, size }) => {
            const iconMap: Record<keyof HomeTabParamList, string> = {
              Dashboard: "view-dashboard-outline",
              Documents: "file-document-outline",
              Search: "text-box-search-outline",
              Settings: "cog-outline",
            };

            return (
              <MaterialCommunityIcons
                name={iconMap[route.name] as never}
                size={size}
                color={color}
              />
            );
          },
        })}
      >
        <Tabs.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ title: t("tabs.dashboard"), tabBarLabel: t("tabs.dashboard") }}
        />
        <Tabs.Screen
          name="Documents"
          component={DocumentsScreen}
          options={{ title: t("tabs.documents"), tabBarLabel: t("tabs.documents") }}
        />
        <Tabs.Screen
          name="Search"
          component={SearchScreen}
          options={{ title: t("tabs.search"), tabBarLabel: t("tabs.search") }}
        />
        <Tabs.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: t("tabs.settings"), tabBarLabel: t("tabs.settings") }}
        />
      </Tabs.Navigator>

      {showFab ? (
        <Pressable
          onPress={() => navigation.navigate("Scan")}
          style={({ pressed }) => [
            styles.fab,
            { bottom: 62 + insets.bottom + 14 },
            pressed ? styles.fabPressed : null,
          ]}
        >
          <MaterialCommunityIcons name="camera-document" size={26} color="#fff" />
        </Pressable>
      ) : null}
    </View>
  );
}

function AppNavigator() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();

  const hasOfflineSnapshot = Boolean(
    offline.summary && (
      offline.summary.lastSyncedAt ||
      offline.summary.documentCount > 0 ||
      offline.summary.dashboard ||
      offline.summary.facets
    ),
  );

  if (auth.isLoading || !offline.isReady) {
    return (
      <SafeAreaView style={styles.loadingRoot}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingTitle}>{t("app.loadingTitle")}</Text>
        <Text style={styles.loadingText}>{t("app.loadingText")}</Text>
      </SafeAreaView>
    );
  }

  const canEnterApp = auth.isAuthenticated && (!auth.isOfflineSession || hasOfflineSnapshot);

  if (!canEnterApp) {
    return (
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
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
      <AutoSyncManager />
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerBackButtonDisplayMode: "minimal",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />
        <Stack.Screen
          name="DocumentDetail"
          component={DocumentDetailScreen}
          options={{ title: "" }}
        />
        <Stack.Screen
          name="Review"
          component={ReviewScreen}
          options={{ title: t("screens.reviewQueue") }}
        />
        <Stack.Screen
          name="Scan"
          component={ScanScreen}
          options={{ title: t("screens.scanUpload") }}
        />
        <Stack.Screen
          name="Correspondents"
          component={CorrespondentsScreen}
          options={{ title: t("screens.correspondents") }}
        />
        <Stack.Screen
          name="CorrespondentDossier"
          component={CorrespondentDossierScreen}
          options={({ route }) => ({
            title: route.params.name,
          })}
        />
      </Stack.Navigator>
    </>
  );
}

function AutoSyncManager() {
  const auth = useAuth();
  const offline = useOfflineArchive();
  const wasConnectedRef = useRef(offline.isConnected);
  const lastAutoSyncAtRef = useRef<string | null>(null);

  useEffect(() => {
    const justReconnected = !wasConnectedRef.current && offline.isConnected;
    wasConnectedRef.current = offline.isConnected;

    if (!auth.isAuthenticated || !offline.isReady || !offline.isConnected || !auth.apiUrl || offline.isSyncing || !offline.summary || !justReconnected) {
      return;
    }

    if (lastAutoSyncAtRef.current === offline.summary.lastSyncedAt) {
      return;
    }

    lastAutoSyncAtRef.current = offline.summary.lastSyncedAt;
    void Promise.resolve()
      .then(async () => {
        if (auth.isOfflineSession) {
          const revalidated = await auth.revalidateSession();
          if (!revalidated) {
            throw new Error("Session could not be revalidated");
          }
        }

        return offline.checkArchiveReachability(auth.probeServer, auth.apiUrl);
      })
      .then((isReachable) => {
        if (!isReachable) {
          throw new Error("Archive unreachable");
        }
        return offline.syncArchive(auth.authFetch);
      })
      .catch(() => {
        lastAutoSyncAtRef.current = null;
      });
  }, [
    auth.apiUrl,
    auth.authFetch,
    auth.isAuthenticated,
    auth.isOfflineSession,
    auth.probeServer,
    auth.revalidateSession,
    offline.checkArchiveReachability,
    offline.isConnected,
    offline.isReady,
    offline.isSyncing,
    offline.summary,
    offline.syncArchive,
  ]);

  return null;
}

function Root() {
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
  const auth = useAuth();
  const theme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: colors.background,
        card: colors.surface,
        primary: colors.primary,
        text: colors.text,
        border: colors.border,
        notification: colors.primary,
      },
    }),
    [],
  );

  return (
    <I18nProvider language={auth.user?.preferences.uiLanguage}>
      <OfflineArchiveProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="dark" />
          <AppNavigator />
        </NavigationContainer>
      </OfflineArchiveProvider>
    </I18nProvider>
  );
}

export default Root;

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  loadingRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    gap: 12,
    padding: 24,
  },
  loadingTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
  },
  loadingText: {
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
  },
  tabBar: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    height: 72,
    paddingBottom: 10,
    paddingTop: 10,
  },
  tabBarLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  fab: {
    position: "absolute",
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    ...shadow,
    shadowOpacity: 0.2,
  },
  fabPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.94 }],
  },
});
