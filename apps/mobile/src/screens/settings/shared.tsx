/**
 * The vocabulary of the Settings and Profile screens: the web client's
 * `components/settings/shared.tsx`, in React Native.
 */
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import { Pressable, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../../auth";
import { IconTile, Skeleton } from "../../components/layout";
import { Button, Panel } from "../../components/ui";
import { useI18n } from "../../i18n";
import { useOfflineArchive } from "../../offline-archive";
import { createThemedStyles, radii, useColors } from "../../theme";
import { fonts, tabular, text } from "../../typography";

/** The app's one definition of "the server cannot be reached right now". */
export function useIsOffline() {
  const offline = useOfflineArchive();
  const auth = useAuth();
  return offline.shouldUseCache || auth.isOfflineSession;
}

/** Fills `{name}` placeholders. `t()` itself takes only a key. */
export function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (out, [key, value]) => out.split(`{${key}}`).join(String(value)),
    template,
  );
}

export function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** `objectStorage` → `Object Storage`. */
export function labelize(field: string) {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatDateTime(value: string | null | undefined, language: "en" | "de") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

export function formatDay(value: string | null | undefined, language: "en" | "de") {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(date);
  } catch {
    return value;
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** The heading of one settings destination, under the page title. */
export function SettingsHeading({ title, description }: { title: string; description?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.heading}>
      <Text style={styles.headingTitle} accessibilityRole="header">
        {title}
      </Text>
      {description ? <Text style={styles.headingBody}>{description}</Text> : null}
    </View>
  );
}

/** A settings section: a card with a title row, a body and an optional footer. */
export function SectionCard({
  icon,
  title,
  description,
  action,
  footer,
  children,
}: {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Panel>
      <View style={[styles.cardHead, children || footer ? styles.cardHeadRule : null]}>
        <View style={[styles.cardHeadMain, description ? null : styles.cardHeadCentered]}>
          {icon ? (
            <IconTile>
              <MaterialCommunityIcons name={icon as never} size={18} color={colors.accentSoftInk} />
            </IconTile>
          ) : null}
          <View style={styles.cardHeadText}>
            <Text style={styles.cardTitle} accessibilityRole="header">
              {title}
            </Text>
            {description ? <Text style={styles.cardDescription}>{description}</Text> : null}
          </View>
        </View>
        {action ? <View style={styles.cardAction}>{action}</View> : null}
      </View>
      {children ? <View style={styles.cardBody}>{children}</View> : null}
      {footer ? <View style={styles.cardFooter}>{footer}</View> : null}
    </Panel>
  );
}

/** A label above its control: the phone layout of the web's setting row. */
export function SettingBlock({
  label,
  description,
  children,
  last = false,
}: {
  label: string;
  description?: string;
  children: ReactNode;
  last?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.settingBlock, last ? null : styles.settingBlockRule]}>
      <Text style={styles.settingLabel}>{label}</Text>
      {description ? <Text style={styles.settingDescription}>{description}</Text> : null}
      <View style={styles.settingControl}>{children}</View>
    </View>
  );
}

/** A small heading inside a card. */
export function SubHeading({ children, right }: { children: string; right?: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.subHeading}>
      <Text style={styles.subHeadingText} accessibilityRole="header">
        {children}
      </Text>
      {right}
    </View>
  );
}

export type StatusTone = "ok" | "warn" | "bad" | "muted" | "brand";

export function StatusDot({ tone }: { tone: StatusTone }) {
  const styles = useStyles();
  const toneStyle = {
    ok: styles.dotOk,
    warn: styles.dotWarn,
    bad: styles.dotBad,
    muted: styles.dotMuted,
    brand: styles.dotBrand,
  }[tone];
  return <View style={[styles.statusDot, toneStyle]} />;
}

/** A soft pill with a dot: the one way these screens say how something is doing. */
export function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  const styles = useStyles();
  const box = {
    ok: styles.badgeOk,
    warn: styles.badgeWarn,
    bad: styles.badgeBad,
    muted: styles.badgeMuted,
    brand: styles.badgeBrand,
  }[tone];
  const ink = {
    ok: styles.inkOk,
    warn: styles.inkWarn,
    bad: styles.inkBad,
    muted: styles.inkMuted,
    brand: styles.inkBrand,
  }[tone];
  const dot = {
    ok: styles.dotOk,
    warn: styles.dotWarn,
    bad: styles.dotBad,
    muted: styles.dotMuted,
    brand: styles.dotBrand,
  }[tone];
  // Sentence case by hand: `capitalize` would give "Not Configured".
  const sentence = label.charAt(0).toUpperCase() + label.slice(1);
  return (
    <View style={[styles.badge, box]}>
      <View style={[styles.badgeDot, dot]} />
      <Text style={[styles.badgeText, ink]} numberOfLines={1}>
        {sentence}
      </Text>
    </View>
  );
}

/** A number with a label. `tone` tints it when the number wants attention. */
export function StatTile({
  label,
  value,
  note,
  tone = "default",
  loading = false,
}: {
  label: string;
  value: string | number;
  note?: string | null;
  tone?: "default" | "brand" | "warning" | "danger";
  loading?: boolean;
}) {
  const styles = useStyles();
  const box =
    tone === "brand"
      ? styles.tileBrand
      : tone === "warning"
        ? styles.tileWarning
        : tone === "danger"
          ? styles.tileDanger
          : null;
  const ink =
    tone === "brand"
      ? styles.inkBrand
      : tone === "warning"
        ? styles.inkWarn
        : tone === "danger"
          ? styles.inkBad
          : styles.inkDefault;
  return (
    <View style={[styles.tile, box]}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      {loading ? (
        <Skeleton style={styles.tileSkeleton} />
      ) : (
        <Text style={[styles.tileValue, ink]} numberOfLines={1}>
          {value}
        </Text>
      )}
      {note ? (
        <Text style={styles.tileNote} numberOfLines={1}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/** Two tiles a row, the same as the web at phone width. */
export function TileGrid({ children }: { children: ReactNode[] }) {
  const styles = useStyles();
  const rows: ReactNode[][] = [];
  children.forEach((child, index) => {
    if (index % 2 === 0) rows.push([]);
    rows[rows.length - 1].push(child);
  });
  return (
    <View style={styles.grid}>
      {rows.map((row, index) => (
        <View key={index} style={styles.gridRow}>
          {row.map((child, cell) => (
            <View key={cell} style={styles.gridCell}>
              {child}
            </View>
          ))}
          {row.length === 1 ? <View style={styles.gridCell} /> : null}
        </View>
      ))}
    </View>
  );
}

/** Placeholder rows for a list that is on its way. */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View accessibilityLabel={t("common.comingSoon")} style={styles.skeletonStack}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} style={styles.skeletonRow} />
      ))}
    </View>
  );
}

/** A failure inside a card, with a way out. */
export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View accessibilityRole="alert" style={styles.inlineError}>
      <Text style={styles.inlineErrorText}>{message}</Text>
      {onRetry ? (
        <Button label={t("common.retry")} variant="secondary" size="sm" onPress={onRetry} />
      ) : null}
    </View>
  );
}

/** A secret shown once: highlighted, monospaced and one press from the clipboard. */
export function SecretBlock({ value, copyable = true }: { value: string; copyable?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.secret}>
      <Text selectable style={styles.secretText}>
        {value}
      </Text>
      {copyable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={copied ? t("twoFactor.copied") : t("settings.copy")}
          hitSlop={8}
          onPress={() => {
            void Clipboard.setStringAsync(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          style={styles.secretCopy}
        >
          <MaterialCommunityIcons
            name={copied ? "check" : "content-copy"}
            size={16}
            color={copied ? colors.green : colors.ink}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The warning that goes with a one-time reveal. */
export function ShownOnceNote({ children }: { children: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.shownOnce}>
      <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.amber} />
      <Text style={styles.shownOnceText}>{children}</Text>
    </View>
  );
}

/** A labelled input with its error under it, never a toast. */
export function FormField({
  label,
  error,
  mono = false,
  style,
  ...input
}: {
  label: string;
  error?: string;
  mono?: boolean;
  style?: StyleProp<ViewStyle>;
} & Omit<ComponentProps<typeof TextInput>, "style">) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.dim}
        style={[styles.input, mono ? styles.inputMono : null, error ? styles.inputError : null]}
        {...input}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.fieldError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Group label plus value, the small facts under a source's head. */
export function Fact({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <Text style={styles.fact}>
      {label}: <Text style={styles.factValue}>{value}</Text>
    </Text>
  );
}

const useStyles = createThemedStyles((c) => ({
  heading: {
    gap: 2,
  },
  headingTitle: {
    fontFamily: fonts.sans.semibold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: c.ink,
  },
  headingBody: {
    ...text.body,
    color: c.muted,
  },
  cardHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cardHeadRule: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  cardHeadMain: {
    flex: 1,
    flexBasis: 200,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    minWidth: 0,
  },
  cardHeadCentered: {
    alignItems: "center",
  },
  cardHeadText: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  cardDescription: {
    ...text.body,
    marginTop: 2,
    color: c.muted,
  },
  cardAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  cardBody: {
    padding: 16,
    gap: 14,
  },
  cardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    backgroundColor: c.bar,
  },
  settingBlock: {
    paddingBottom: 14,
    gap: 2,
  },
  settingBlockRule: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  settingLabel: {
    ...text.bodyStrong,
    color: c.ink,
  },
  settingDescription: {
    ...text.meta,
    color: c.muted,
  },
  settingControl: {
    marginTop: 10,
  },
  subHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  subHeadingText: {
    ...text.sectionLabel,
    color: c.muted,
  },
  statusDot: {
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: radii.pill,
  },
  dotOk: { backgroundColor: c.green },
  dotWarn: { backgroundColor: c.amber },
  dotBad: { backgroundColor: c.red },
  dotMuted: { backgroundColor: c.dim },
  dotBrand: { backgroundColor: c.accent },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
  },
  badgeOk: { backgroundColor: c.greenSoft },
  badgeWarn: { backgroundColor: c.amberSoft },
  badgeBad: { backgroundColor: c.redSoft },
  badgeMuted: { backgroundColor: c.bar },
  badgeBrand: { backgroundColor: c.accentSoft },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
  },
  badgeText: {
    ...text.smallStrong,
  },
  inkDefault: { color: c.ink },
  inkOk: { color: c.green },
  inkWarn: { color: c.amber },
  inkBad: { color: c.red },
  inkMuted: { color: c.muted },
  inkBrand: { color: c.accentSoftInk },
  tile: {
    minWidth: 0,
    padding: 14,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
  },
  tileBrand: {
    borderColor: "transparent",
    backgroundColor: c.accentSoft,
  },
  tileWarning: {
    borderColor: "transparent",
    backgroundColor: c.amberSoft,
  },
  tileDanger: {
    borderColor: "transparent",
    backgroundColor: c.redSoft,
  },
  tileLabel: {
    ...text.small,
    color: c.muted,
  },
  tileValue: {
    fontFamily: fonts.sans.semibold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5,
    marginTop: 2,
    ...tabular,
  },
  tileNote: {
    ...text.small,
    marginTop: 2,
    color: c.muted,
  },
  tileSkeleton: {
    width: 48,
    height: 26,
    marginTop: 4,
  },
  grid: {
    gap: 10,
  },
  gridRow: {
    flexDirection: "row",
    gap: 10,
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  skeletonStack: {
    gap: 10,
  },
  skeletonRow: {
    height: 40,
    borderRadius: radii.lg,
  },
  inlineError: {
    gap: 10,
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: c.redSoft,
    alignItems: "flex-start",
  },
  inlineErrorText: {
    ...text.body,
    color: c.red,
  },
  secret: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.accent,
    backgroundColor: c.accentSoft,
  },
  secretText: {
    ...text.mono,
    flex: 1,
    minWidth: 0,
    alignSelf: "center",
    color: c.accentSoftInk,
  },
  secretCopy: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
  },
  shownOnce: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.lg,
    backgroundColor: c.amberSoft,
  },
  shownOnceText: {
    ...text.body,
    flex: 1,
    color: c.amber,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    ...text.metaStrong,
    color: c.ink,
  },
  input: {
    ...text.body,
    height: 44,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 12,
  },
  inputMono: {
    fontFamily: fonts.mono.regular,
    fontSize: 13,
  },
  inputError: {
    borderColor: c.red,
  },
  fieldError: {
    ...text.body,
    color: c.red,
  },
  fact: {
    ...text.small,
    color: c.muted,
  },
  factValue: {
    ...text.numeric,
    color: c.muted,
  },
}));
