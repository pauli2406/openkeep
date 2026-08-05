/**
 * The OpenKeep palette — one source, two clients (#124).
 *
 * Plain data with no dependencies. `apps/mobile` imports it directly and
 * `apps/web` generates its `--ok-*` custom properties from it, so a colour
 * changes in one place and both clients follow.
 *
 * Light is the base theme and dark is a full peer, not an inversion.
 */

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

export type ThemeName = "light" | "dark";

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

export type Palette = typeof light;

const dark: Palette = {
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

export const palettes: Record<ThemeName, Palette> = { light, dark };

/** Radii top out at 10. The pill value is for filter chips only. */
export const radii = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 10,
  pill: 999,
} as const;
