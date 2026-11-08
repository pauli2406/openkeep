#!/usr/bin/env node
/**
 * Generates the mobile palette from the web theme, so both clients show the
 * same colours from one source.
 *
 * `apps/web/src/theme.css` is the source of truth. React Native understands
 * neither `oklch()` nor CSS gradients, so this converts them to hex stops and
 * writes `packages/tokens/src/palette.generated.ts`. Run with `--check` to fail
 * when the checked-in file is stale; that is what `check.mjs` does.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE = resolve(root, "apps/web/src/theme.css");
const OUT = resolve(root, "packages/tokens/src/palette.generated.ts");

/** Palette key on mobile → custom property in the web theme. */
const KEYS = {
  app: "background",
  bar: "muted",
  panel: "card",
  raised: "secondary",
  sunken: "stage",
  border: "border",
  borderSoft: "border",
  borderStrong: "input",
  ink: "foreground",
  muted: "muted-foreground",
  dim: "muted-foreground",
  faint: "muted-foreground",
  accent: "brand",
  accentSoft: "brand-soft",
  accentSoftInk: "brand-soft-foreground",
  accentFill: "primary",
  accentFillInk: "primary-foreground",
  amber: "warning",
  amberSoft: "warning-soft",
  red: "danger",
  redSoft: "danger-soft",
  green: "success",
  greenSoft: "success-soft",
  info: "info",
  infoSoft: "info-soft",
  paper: "paper",
  paperInk: "paper-foreground",
  paperBorder: "paper-border",
  highlight: "highlight",
  highlightInk: "highlight-foreground",
  highlightRule: "brand",
  overlay: "overlay",
  destructive: "destructive",
  sidebarInk: "sidebar-foreground",
  sidebarMuted: "sidebar-muted",
  sidebarActive: "sidebar-primary",
  sidebarActiveInk: "sidebar-primary-foreground",
  sidebarHover: "sidebar-accent",
  sidebarHoverInk: "sidebar-accent-foreground",
  sidebarBorder: "sidebar-border",
};

const GRADIENTS = {
  chrome: "gradient-chrome",
  brand: "gradient-brand",
  action: "gradient-action",
  wash: "gradient-wash",
};

/** A shadow is a tint plus geometry on mobile, so only the tint is shared. */
const SHADOW = { light: "oklch(0.3 0.08 262)", dark: "oklch(0 0 0)" };

/** The white-on-gradient values the web spells as `bg-white/12` and friends. */
const ON_GRADIENT = {
  light: {
    onGradient: "oklch(1 0 0)",
    onGradientMuted: "oklch(1 0 0 / 0.85)",
    tile: "oklch(1 0 0 / 0.12)",
    tileActive: "oklch(1 0 0)",
    tileActiveInk: "oklch(0.49 0.2 260)",
  },
  dark: {
    onGradient: "oklch(1 0 0)",
    onGradientMuted: "oklch(1 0 0 / 0.85)",
    tile: "oklch(1 0 0 / 0.12)",
    tileActive: "oklch(1 0 0 / 0.2)",
    tileActiveInk: "oklch(1 0 0)",
  },
};

function declarations(css) {
  const vars = {};
  for (const [, name, value] of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    vars[name] = value.replace(/\s+/g, " ").trim();
  }
  return vars;
}

function blocks(css) {
  const light = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  const dark = /\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/.exec(css);
  if (!light || !dark) throw new Error(`no theme blocks in ${SOURCE}`);
  const lightVars = declarations(light[1]);
  return { light: lightVars, dark: { ...lightVars, ...declarations(dark[1]) } };
}

const OKLCH = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/;

/** Björn Ottosson's OKLab → linear sRGB matrices. */
function oklchToRgb(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
  return linear.map((channel) => {
    const clamped = Math.min(1, Math.max(0, channel));
    const encoded =
      clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255);
  });
}

function toColour(value) {
  const match = OKLCH.exec(value);
  if (!match) throw new Error(`not an oklch colour: ${value}`);
  const [r, g, b] = oklchToRgb(Number(match[1]), Number(match[2]), Number(match[3]));
  if (match[4] !== undefined) return `rgba(${r}, ${g}, ${b}, ${Number(match[4])})`;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function toGradient(value) {
  const angle = /linear-gradient\(\s*([\d.]+)deg/.exec(value);
  if (!angle) throw new Error(`not a linear gradient: ${value}`);
  const stops = [...value.matchAll(/(oklch\([^)]*\))(?:\s+([\d.]+)%)?/g)];
  return {
    angle: Number(angle[1]),
    colors: stops.map((stop) => toColour(stop[1])),
    locations: stops.map((stop, index) =>
      stop[2] !== undefined ? Number(stop[2]) / 100 : index / Math.max(1, stops.length - 1),
    ),
  };
}

function palette(vars, scheme) {
  const out = {};
  for (const [key, name] of Object.entries(KEYS)) {
    if (!vars[name]) throw new Error(`--${name} is missing from the ${scheme} theme`);
    out[key] = toColour(vars[name]);
  }
  out.shadow = toColour(SHADOW[scheme]);
  for (const [key, value] of Object.entries(ON_GRADIENT[scheme])) {
    out[key] = toColour(value);
  }
  out.cat = Array.from({ length: 8 }, (_, index) => toColour(vars[`chart-${index + 1}`]));
  out.gradient = Object.fromEntries(
    Object.entries(GRADIENTS).map(([key, name]) => [key, toGradient(vars[name])]),
  );
  return out;
}

const themes = blocks(readFileSync(SOURCE, "utf8"));
const generated = [
  "/* Generated by scripts/tokens/generate.mjs from apps/web/src/theme.css. Do not edit. */",
  "",
  `export const light = ${JSON.stringify(palette(themes.light, "light"), null, 2)};`,
  "",
  `export const dark = ${JSON.stringify(palette(themes.dark, "dark"), null, 2)};`,
  "",
].join("\n");

if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== generated) {
    console.error(
      "packages/tokens/src/palette.generated.ts is out of step with apps/web/src/theme.css. " +
        "Run `pnpm tokens:generate`.",
    );
    process.exit(1);
  }
} else {
  writeFileSync(OUT, generated);
  console.log(`wrote ${OUT}`);
}
