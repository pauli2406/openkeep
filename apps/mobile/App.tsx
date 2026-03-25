import "react-native-gesture-handler";
import { useMemo, useState } from "react";
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
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { DocumentDetailScreen } from "./src/screens/DocumentDetailScreen";
import { DocumentsScreen } from "./src/screens/DocumentsScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { ScanScreen } from "./src/screens/ScanScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { AuthScreen } from "./src/screens/AuthScreen";
import { colors, shadow } from "./src/theme";

export type AppStackParamList = {
  Home: undefined;
  DocumentDetail: { documentId: string; title?: string };
  Review: undefined;
  Scan: undefined;
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
        <Tabs.Screen name="Dashboard" component={DashboardScreen} />
        <Tabs.Screen name="Documents" component={DocumentsScreen} />
        <Tabs.Screen name="Search" component={SearchScreen} />
        <Tabs.Screen name="Settings" component={SettingsScreen} />
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

  if (auth.isLoading) {
    return (
      <SafeAreaView style={styles.loadingRoot}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingTitle}>Loading OpenKeep</Text>
        <Text style={styles.loadingText}>Restoring your mobile archive session.</Text>
      </SafeAreaView>
    );
  }

  if (!auth.isAuthenticated) {
    return <AuthScreen />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="Home" component={HomeTabs} options={{ headerShown: false }} />
      <Stack.Screen
        name="DocumentDetail"
        component={DocumentDetailScreen}
        options={({ route }) => ({
          title: route.params.title ?? "Document",
        })}
      />
      <Stack.Screen
        name="Review"
        component={ReviewScreen}
        options={{ title: "Review queue" }}
      />
      <Stack.Screen
        name="Scan"
        component={ScanScreen}
        options={{ title: "Scan & upload" }}
      />
    </Stack.Navigator>
  );
}

function Root() {
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
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <NavigationContainer theme={theme}>
              <StatusBar style="dark" />
              <AppNavigator />
            </NavigationContainer>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
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
