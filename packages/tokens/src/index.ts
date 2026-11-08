/**
 * The mobile palette, generated from the web theme so both clients show the
 * same colours. Change `apps/web/src/theme.css`, then run `pnpm tokens:generate`.
 */
import { dark, light } from "./palette.generated";

export type ThemeName = "light" | "dark";
export type Palette = typeof light;
export type Gradient = Palette["gradient"][keyof Palette["gradient"]];

export const palettes: Record<ThemeName, Palette> = { light, dark };

/** The same radius scale as the web theme's `--radius`. */
export const radii = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;
