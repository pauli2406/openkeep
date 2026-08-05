import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, type RenderOptions } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import type { ReactElement, ReactNode } from "react";
import { I18nProvider } from "../i18n";
import { ThemeProvider, type Density, type ThemeName } from "../theme";

/**
 * The provider stack a primitive needs, with the appearance seeded through the
 * store the app reads it from — so the test exercises the same path a launch
 * does rather than a shortcut around it.
 */
export async function renderThemed(
  ui: ReactElement,
  {
    theme = "light" as ThemeName,
    density = "standard" as Density,
    language = "en" as const,
    ...options
  } = {} as {
    theme?: ThemeName;
    density?: Density;
    language?: "en" | "de";
  } & RenderOptions,
) {
  await AsyncStorage.clear();
  await AsyncStorage.setItem("openkeep.appearance", theme);
  await AsyncStorage.setItem("openkeep.density", density);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 393, height: 852 },
          insets: { top: 59, left: 0, right: 0, bottom: 34 },
        }}
      >
        <ThemeProvider>
          <I18nProvider language={language}>{children}</I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    );
  }

  // `render` is async in this version of the library: it mounts and flushes
  // effects, which is what lets the provider's stored appearance land before the
  // first assertion. A test asserting a dark colour would otherwise be asserting
  // the light one.
  return await render(ui, { wrapper: Wrapper, ...options });
}

/**
 * The resolved style of a node. `StyleSheet.flatten` is what React Native itself
 * uses, so registered stylesheet entries and nested arrays resolve the same way
 * they do on a device.
 */
export function styleOf(node: { props: { style?: unknown } }): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style as never) ?? {}) as Record<string, unknown>;
}

/** 393pt is the design width; a device this size is what the tickets specified. */
export const DEVICE = { width: 393, height: 852 } as const;
