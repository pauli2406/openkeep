import "react-native-gesture-handler";
import { useMemo } from "react";
import { ActivityIndicator, Text } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { AuthProvider, useAuth } from "./src/auth";
import { I18nProvider, useI18n } from "./src/i18n";
import { SelectionModeProvider } from "./src/selection-mode";
import { OfflineArchiveProvider, useOfflineArchive } from "./src/offline-archive";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { DocumentDetailScreen } from "./src/screens/DocumentDetailScreen";
import { DocumentsScreen } from "./src/screens/DocumentsScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { OfflineArchiveScreen } from "./src/screens/OfflineArchiveScreen";
import { ProfileScreen } from "./src/screens/ProfileScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { TaxesScreen } from "./src/screens/TaxesScreen";
import { AppDrawer, AppHeader, ShellProvider, useShell } from "./src/components/shell";
import { Omnibar } from "./src/components/Omnibar";
import { CorrespondentDossierScreen } from "./src/screens/CorrespondentDossierScreen";
import { CorrespondentsScreen } from "./src/screens/CorrespondentsScreen";
import { AuthScreen } from "./src/screens/AuthScreen";
import { createThemedStyles, ThemeProvider, useAppearance, useColors } from "./src/theme";
import { fontAssets } from "./src/typography";

export type AppStackParamList = {
  Home: undefined;
  DocumentDetail: {
    documentId: string;
    title?: string;
    /** A chat citation: open on the page it is on and highlight it. (#122) */
    citation?: { page: number | null; quote: string };
  };
  Scan: undefined;
  OfflineArchive: undefined;
  Correspondents: undefined;
  CorrespondentDossier: { slug: string; name: string };
};

/**
 * The primary destinations, the same as the web client's sidebar. A tab navigator
 * keeps each one mounted while you move around; its bar is hidden, because the
 * drawer is what navigates.
 */
export type HomeTabParamList = {
  Today: undefined;
  Documents: undefined;
  Review: undefined;
  Taxes: undefined;
  Chat: undefined;
  Settings: undefined;
  Profile: undefined;
};

const queryClient = new QueryClient();
const Stack = createNativeStackNavigator<AppStackParamList>();
const Tabs = createBottomTabNavigator<HomeTabParamList>();

function HomeNavigator() {
  const styles = useStyles();
  const shell = useShell();

  return (
    <SafeAreaView edges={["top"]} style={styles.shell}>
      <AppHeader />
      <Tabs.Navigator
        tabBar={() => null}
        screenListeners={{
          state: (e) => {
            const state = (e.data as { state: { index: number; routeNames: string[] } }).state;
            if (state) {
              shell.setActive(state.routeNames[state.index] as keyof HomeTabParamList);
            }
          },
        }}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="Today" component={DashboardScreen} />
        <Tabs.Screen name="Documents" component={DocumentsScreen} />
        <Tabs.Screen name="Review" component={ReviewScreen} />
        <Tabs.Screen name="Taxes" component={TaxesScreen} />
        <Tabs.Screen name="Chat" component={SearchScreen} />
        <Tabs.Screen name="Settings" component={SettingsScreen} />
        <Tabs.Screen name="Profile" component={ProfileScreen} />
      </Tabs.Navigator>
    </SafeAreaView>
  );
}

function HomeTabs() {
  return (
    <ShellProvider>
      <HomeNavigator />
      <AppDrawer />
      <Omnibar />
    </ShellProvider>
  );
}

function AppNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const appearance = useAppearance();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();

  const hasCachedDocuments = offline.cacheSummary.documentCount > 0;

  // The type scale is only right once the bundled faces are registered, so the
  // splash keeps the app behind the same gate that already waits on auth.
  if (!fontsLoaded || !appearance.isReady || auth.isLoading || !offline.isReady) {
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
          // The screen brings its own bar and its own safe-area inset; the native
          // header would sit above both as an empty strip.
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="OfflineArchive"
          component={OfflineArchiveScreen}
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
  // The provider is outermost: everything below it, including the loading
  // screen, reads its colours from the resolved theme.
  return (
    <ThemeProvider>
      <AppTree />
    </ThemeProvider>
  );
}

function AppTree() {
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
  const appearance = useAppearance();
  const auth = useAuth();
  const [fontsLoaded] = useFonts(fontAssets);
  const isDark = appearance.theme === "dark";
  const theme = useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: colors.app,
        card: colors.panel,
        primary: colors.accent,
        text: colors.ink,
        border: colors.border,
        notification: colors.accent,
      },
    };
  }, [colors, isDark]);

  return (
    <I18nProvider language={auth.user?.preferences.uiLanguage}>
      <OfflineArchiveProvider>
        <SelectionModeProvider>
          <NavigationContainer theme={theme}>
            <StatusBar style={isDark ? "light" : "dark"} />
            <AppNavigator fontsLoaded={fontsLoaded} />
          </NavigationContainer>
        </SelectionModeProvider>
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
  shell: {
    flex: 1,
    backgroundColor: c.app,
  },
}));
