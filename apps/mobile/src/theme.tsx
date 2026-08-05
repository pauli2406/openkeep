/**
 * OpenKeep mobile design tokens (#104)
 *
 * The values are taken verbatim from `apps/web/src/index.css` — the web and the
 * mobile client share one palette and must not drift. Light is the base theme,
 * dark is a full peer rather than an inversion.
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

export type ThemeName = "light" | "dark";

/** The categorical ramp (`--ok-cat-1…8`) for tag and document-type dots. */
export type CategoricalRamp = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

const light = {
  /* surfaces */
  app: "#fcfcfb",
  bar: "#f7f8f7",
  panel: "#ffffff",
  raised: "#f2f4f2",
  sunken: "#eceeec",

  /* borders */
  border: "#e3e6e3",
  borderSoft: "#eef0ee",
  borderStrong: "#d6dad7",

  /* text */
  ink: "#26302a",
  muted: "#5b615c",
  dim: "#8b9089",
  faint: "#9aa09a",

  /* accent (green) */
  accent: "#14544d",
  accentSoft: "#e7edea",
  accentSoftInk: "#14544d",
  accentFill: "#14544d",
  accentFillInk: "#ffffff",

  /* amber — "needs attention" */
  amber: "#8a5a19",
  amberSoft: "#fdf1e3",

  /* red — overdue and failed */
  red: "#a8462f",
  redSoft: "#fdeeea",

  /* status green, distinct from the accent: "done" / "ok" */
  green: "#4a7d5a",
  greenSoft: "#e8f0ea",

  /* A scan is a scan: the page surface stays light in both themes. */
  paper: "#ffffff",
  paperInk: "#26302a",
  paperBorder: "#e3e6e3",

  /* citation / search highlight drawn on `paper` */
  highlight: "#fdf1e3",
  highlightRule: "#8a5a19",

  /* modal scrim */
  overlay: "rgba(20, 26, 24, 0.45)",

  cat: [
    "#14544d",
    "#2f6f9e",
    "#7a5ba6",
    "#4a7d5a",
    "#8a6a2f",
    "#a8462f",
    "#8a2d55",
    "#6b716c",
  ] as CategoricalRamp,
};

export type Colors = typeof light;

const dark: Colors = {
  app: "#0f1214",
  bar: "#14181a",
  panel: "#161a1c",
  raised: "#1b2023",
  sunken: "#0b0e0f",

  border: "#252b2e",
  borderSoft: "#1e2325",
  borderStrong: "#2c3336",

  ink: "#e6e9e7",
  muted: "#a7afa9",
  dim: "#8b938d",
  faint: "#7d857f",

  accent: "#5fb3a3",
  accentSoft: "#16302c",
  accentSoftInk: "#7fc9b8",
  accentFill: "#1c6b60",
  accentFillInk: "#f2fbf8",

  amber: "#d9ae6a",
  amberSoft: "#2e2415",

  red: "#dd8d78",
  redSoft: "#331d1a",

  green: "#7fb98d",
  greenSoft: "#16301c",

  /* the paper stays light; only its frame darkens */
  paper: "#e9ebe9",
  paperInk: "#26302a",
  paperBorder: "#2c3336",

  highlight: "#f3e4c8",
  highlightRule: "#8a5a19",

  overlay: "rgba(0, 0, 0, 0.6)",

  cat: [
    "#5fb3a3",
    "#6ea8d8",
    "#b095db",
    "#7fb98d",
    "#d9ae6a",
    "#dd8d78",
    "#d187a8",
    "#9aa39c",
  ] as CategoricalRamp,
};

export const palettes: Record<ThemeName, Colors> = { light, dark };

/** Radii top out at 10. The pill value is for filter chips only. */
export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  pill: 999,
} as const;

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
