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
import { useMemo } from "react";
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from "react-native";

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

/**
 * The active theme. #104 follows the OS; #108 replaces this with a persisted
 * light / dark / system context and keeps the same signature.
 */
export function useThemeName(): ThemeName {
  return useColorScheme() === "dark" ? "dark" : "light";
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
