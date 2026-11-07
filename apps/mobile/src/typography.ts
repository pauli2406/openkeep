/**
 * OpenKeep mobile type scale, the same one as the web client.
 *
 * Geist for everything; numbers use its tabular figures so columns line up. Geist
 * Mono is only for literal machine values: checksums, tokens, identifiers.
 *
 * React Native picks a face by `fontFamily`, so each weight is a separate bundled
 * file and nothing in the app sets `fontWeight`.
 */
import type { TextStyle } from "react-native";

export const fonts = {
  sans: {
    regular: "Geist-Regular",
    medium: "Geist-Medium",
    semibold: "Geist-SemiBold",
    bold: "Geist-Bold",
  },
  mono: {
    regular: "GeistMono-Regular",
    medium: "GeistMono-Medium",
    semibold: "GeistMono-SemiBold",
  },
} as const;

/** What `useFonts` needs. Keys are the names `fontFamily` refers to. */
export const fontAssets = {
  [fonts.sans.regular]: require("../assets/fonts/Geist-Regular.ttf"),
  [fonts.sans.medium]: require("../assets/fonts/Geist-Medium.ttf"),
  [fonts.sans.semibold]: require("../assets/fonts/Geist-SemiBold.ttf"),
  [fonts.sans.bold]: require("../assets/fonts/Geist-Bold.ttf"),
  [fonts.mono.regular]: require("../assets/fonts/GeistMono-Regular.ttf"),
  [fonts.mono.medium]: require("../assets/fonts/GeistMono-Medium.ttf"),
  [fonts.mono.semibold]: require("../assets/fonts/GeistMono-SemiBold.ttf"),
};

/** Numbers line up in a column. Spread onto any mono style that shows digits. */
export const tabular = {
  fontVariant: ["tabular-nums"],
} satisfies TextStyle;

export const text = {
  /** The title of a page (web: `text-2xl font-semibold tracking-tight`). */
  screenTitle: {
    fontFamily: fonts.sans.semibold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  /** A stack screen's bar title and a card's heading. */
  barTitle: {
    fontFamily: fonts.sans.semibold,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  /** The label above a group of rows (web: `text-xs font-medium text-muted-foreground`). */
  sectionLabel: {
    fontFamily: fonts.sans.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  /** The first line of a row. */
  rowTitle: {
    fontFamily: fonts.sans.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyStrong: {
    fontFamily: fonts.sans.medium,
    fontSize: 14,
    lineHeight: 20,
  },
  /** The second line of a row, and table metadata. */
  meta: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  metaStrong: {
    fontFamily: fonts.sans.medium,
    fontSize: 12,
    lineHeight: 16,
  },
  small: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  smallStrong: {
    fontFamily: fonts.sans.medium,
    fontSize: 12,
    lineHeight: 16,
  },

  /* ── numeric ── tabular figures, in the text face ── */

  /** The big number on a tile. */
  statValue: {
    fontFamily: fonts.sans.semibold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    ...tabular,
  },
  /** A row's trailing amount. */
  amount: {
    fontFamily: fonts.sans.medium,
    fontSize: 14,
    lineHeight: 20,
    ...tabular,
  },
  /** Dates, counts, positions, percentages. */
  numeric: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
    ...tabular,
  },
  numericStrong: {
    fontFamily: fonts.sans.medium,
    fontSize: 12,
    lineHeight: 16,
    ...tabular,
  },
  numericMeta: {
    fontFamily: fonts.sans.regular,
    fontSize: 12,
    lineHeight: 16,
    ...tabular,
  },
  /** Literal machine values only: a checksum, a token, an identifier. */
  mono: {
    fontFamily: fonts.mono.regular,
    fontSize: 12,
    lineHeight: 18,
  },
} satisfies Record<string, TextStyle>;
