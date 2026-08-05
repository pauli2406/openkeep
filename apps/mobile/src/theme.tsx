/**
 * OpenKeep mobile theming (#104, shared in #124)
 *
 * The palette itself now lives in `@openkeep/tokens`, which the web client
 * generates its `--ok-*` properties from — so a colour changes in one place and
 * both clients follow. This module is what turns it into React Native styles.
 *
 * Colours are read through `useColors()` / `createThemedStyles()` so a theme
 * change re-renders. A module-level `import { colors }` cannot do that, which is
 * why the old flat export is gone.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Appearance as RNAppearance,
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { palettes, radii, type Palette, type ThemeName } from "@openkeep/tokens";

/** Re-exported so screens keep importing colours and radii from one place. */
export { palettes, radii };
export type { ThemeName };
export type Colors = Palette;

/** What the user chose. `system` follows the OS. */
export type ThemePreference = ThemeName | "system";

const PREFERENCE_KEY = "openkeep.appearance";
const DENSITY_KEY = "openkeep.density";

/** `compact` takes ~15% off every row height. */
export type Density = "standard" | "compact";

export const DENSITY_SCALE: Record<Density, number> = {
  standard: 1,
  compact: 0.85,
};

type Appearance = {
  /** What the user chose. */
  preference: ThemePreference;
  /** What that resolves to right now. */
  theme: ThemeName;
  setPreference: (preference: ThemePreference) => void;
  density: Density;
  setDensity: (density: Density) => void;
  /** False until the stored preference has been read, to avoid a light flash. */
  isReady: boolean;
};

const AppearanceContext = createContext<Appearance>({
  preference: "system",
  theme: "light",
  setPreference: () => {},
  density: "standard",
  setDensity: () => {},
  isReady: true,
});

function isPreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setStoredPreference] = useState<ThemePreference>("system");
  const [density, setStoredDensity] = useState<Density>("standard");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([AsyncStorage.getItem(PREFERENCE_KEY), AsyncStorage.getItem(DENSITY_KEY)])
      .then(([storedTheme, storedDensity]) => {
        if (cancelled) {
          return;
        }
        if (isPreference(storedTheme)) {
          setStoredPreference(storedTheme);
        }
        if (storedDensity === "compact" || storedDensity === "standard") {
          setStoredDensity(storedDensity);
        }
      })
      .catch(() => {
        // an unreadable preference is not worth failing a launch over
      })
      .finally(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setStoredPreference(next);
    void AsyncStorage.setItem(PREFERENCE_KEY, next).catch(() => {});
  }, []);

  const setDensity = useCallback((next: Density) => {
    setStoredDensity(next);
    void AsyncStorage.setItem(DENSITY_KEY, next).catch(() => {});
  }, []);

  /**
   * React styles are not the whole app: alerts, keyboards and pickers are native
   * and follow the OS unless told otherwise. `setColorScheme(null)` hands them
   * back to the system, which is what `system` means.
   */
  useEffect(() => {
    if (!isReady) {
      return;
    }
    // Not every platform has the setter, and a missing one must not take the app
    // down on mount.
    if (typeof RNAppearance.setColorScheme !== "function") {
      return;
    }
    RNAppearance.setColorScheme(preference === "system" ? null : preference);
  }, [preference, isReady]);

  const value = useMemo<Appearance>(() => {
    const resolved: ThemeName =
      preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
    return { preference, theme: resolved, setPreference, density, setDensity, isReady };
  }, [preference, system, setPreference, density, setDensity, isReady]);

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): Appearance {
  return useContext(AppearanceContext);
}

export function useThemeName(): ThemeName {
  return useContext(AppearanceContext).theme;
}

export function useColors(): Colors {
  return palettes[useThemeName()];
}

type Style = ViewStyle | TextStyle | ImageStyle;

/**
 * Turns a style factory into a hook. The result is built once per theme and
 * cached, so a themed stylesheet costs the same as a module-level one.
 *
 *   const useStyles = createThemedStyles((c) => ({ row: { color: c.ink } }));
 *   …
 *   const styles = useStyles();
 */
export function createThemedStyles<T extends Record<string, Style>>(
  factory: (c: Colors) => T,
): () => T {
  const cache = {} as Record<ThemeName, T>;

  return function useThemedStyles(): T {
    const theme = useThemeName();
    return useMemo(() => {
      if (!cache[theme]) {
        cache[theme] = StyleSheet.create(factory(palettes[theme])) as T;
      }
      return cache[theme];
    }, [theme]);
  };
}
