/**
 * OpenKeep mobile type scale (#105)
 *
 * Public Sans for text, IBM Plex Mono for every number, date, amount, count,
 * confidence value and identifier. The values come from
 * `design/mobile/prototype/openkeep-mobile.dc.html`.
 *
 * React Native picks a face by `fontFamily`, so each weight is a separate
 * bundled file and nothing in the app sets `fontWeight`. 600 is the heaviest
 * weight the UI uses; `sans.bold` exists for the wordmark and the avatar
 * monogram in the app bar.
 */
import type { TextStyle } from "react-native";

export const fonts = {
  sans: {
    regular: "PublicSans-Regular",
    medium: "PublicSans-Medium",
    semibold: "PublicSans-SemiBold",
    bold: "PublicSans-Bold",
  },
  mono: {
    regular: "IBMPlexMono-Regular",
    medium: "IBMPlexMono-Medium",
    semibold: "IBMPlexMono-SemiBold",
  },
} as const;

/** What `useFonts` needs. Keys are the names `fontFamily` refers to. */
export const fontAssets = {
  [fonts.sans.regular]: require("../assets/fonts/PublicSans-Regular.ttf"),
  [fonts.sans.medium]: require("../assets/fonts/PublicSans-Medium.ttf"),
  [fonts.sans.semibold]: require("../assets/fonts/PublicSans-SemiBold.ttf"),
  [fonts.sans.bold]: require("../assets/fonts/PublicSans-Bold.ttf"),
  [fonts.mono.regular]: require("../assets/fonts/IBMPlexMono-Regular.ttf"),
  [fonts.mono.medium]: require("../assets/fonts/IBMPlexMono-Medium.ttf"),
  [fonts.mono.semibold]: require("../assets/fonts/IBMPlexMono-SemiBold.ttf"),
};

/** Numbers line up in a column. Spread onto any mono style that shows digits. */
export const tabular = {
  fontVariant: ["tabular-nums"],
} satisfies TextStyle;

export const text = {
  /** Screen and sheet titles. Was 32px/800. */
  screenTitle: {
    fontFamily: fonts.sans.semibold,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  /** The app-bar title, one step below a screen title. */
  barTitle: {
    fontFamily: fonts.sans.semibold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.16,
  },
  /** The strip above a group of rows. Mono, uppercase, wide. */
  sectionLabel: {
    fontFamily: fonts.mono.medium,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  /** The first line of a row. */
  rowTitle: {
    fontFamily: fonts.sans.medium,
    fontSize: 14.5,
    lineHeight: 20,
  },
  body: {
    fontFamily: fonts.sans.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyStrong: {
    fontFamily: fonts.sans.semibold,
    fontSize: 14,
    lineHeight: 20,
  },
  /** The second line of a row, and table metadata. */
  meta: {
    fontFamily: fonts.sans.regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  metaStrong: {
    fontFamily: fonts.sans.semibold,
    fontSize: 12.5,
    lineHeight: 17,
  },
  small: {
    fontFamily: fonts.sans.regular,
    fontSize: 11.5,
    lineHeight: 16,
  },
  smallStrong: {
    fontFamily: fonts.sans.semibold,
    fontSize: 11.5,
    lineHeight: 16,
  },

  /* ── numeric ── every number, date, amount, count and identifier ── */

  /** The big number in the Today strip. */
  statValue: {
    fontFamily: fonts.mono.semibold,
    fontSize: 20,
    lineHeight: 25,
    letterSpacing: -0.4,
    ...tabular,
  },
  /** A row's trailing amount. */
  amount: {
    fontFamily: fonts.mono.semibold,
    fontSize: 13.5,
    lineHeight: 18,
    ...tabular,
  },
  /** Dates, counts, positions, percentages, IDs. */
  numeric: {
    fontFamily: fonts.mono.regular,
    fontSize: 11.5,
    lineHeight: 16,
    ...tabular,
  },
  numericStrong: {
    fontFamily: fonts.mono.medium,
    fontSize: 11.5,
    lineHeight: 16,
    ...tabular,
  },
  /** Metadata-sized numerics, e.g. "12 Dokumente · 3 offen". */
  numericMeta: {
    fontFamily: fonts.mono.regular,
    fontSize: 12.5,
    lineHeight: 17,
    ...tabular,
  },
} satisfies Record<string, TextStyle>;
