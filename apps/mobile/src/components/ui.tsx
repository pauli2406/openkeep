import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useScrollToTop } from "@react-navigation/native";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "../i18n";
import { createThemedStyles, DENSITY_SCALE, radii, useAppearance, useColors } from "../theme";
import { text } from "../typography";

/**
 * A screen is an app bar plus a body. The bar is 46pt with the title on the
 * left and actions on the right; the giant title block is gone.
 *
 * `padded` is for screens whose body is cards or a form. Row lists run
 * edge to edge and pass `padded={false}`.
 */
export function Screen({
  title,
  titleMeta,
  children,
  scroll = true,
  right,
  leading,
  onBack,
  backIcon = "chevron-left",
  notice,
  contentContainerStyle,
  includeTopSafeArea = true,
  padded = true,
  footer,
}: {
  title: string;
  /** A mono sub-line under the bar title — Chat names the scope there. */
  titleMeta?: string;
  children: ReactNode;
  scroll?: boolean;
  right?: ReactNode;
  /** Sits left of the title — Today puts the logo mark there. */
  leading?: ReactNode;
  /**
   * A stack screen carries its back affordance in this bar. Every route that
   * renders a `Screen` has its native header switched off, so without this the
   * screen would be a dead end.
   */
  onBack?: () => void;
  /** `close` for a sheet-like screen such as the import draft. */
  backIcon?: "chevron-left" | "close";
  /** A full-bleed strip between the bar and the body — see `Notice`. */
  notice?: ReactNode;
  contentContainerStyle?: ViewStyle;
  includeTopSafeArea?: boolean;
  padded?: boolean;
  /**
   * Pinned below the body, outside the scroll area — an action bar that has to
   * stay reachable however far down the list the user is.
   */
  footer?: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);

  useScrollToTop(scrollRef);

  // A non-scrolling screen pins things to the bottom, so its body has to fill
  // the space rather than size to its children.
  const body = (
    <View
      style={[
        padded ? styles.contentPadded : styles.content,
        scroll ? null : styles.contentFlex,
        contentContainerStyle,
      ]}
    >
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={includeTopSafeArea ? ["top"] : []} style={styles.safeArea}>
      <View style={[styles.appBar, onBack ? styles.appBarWithBack : null]}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            onPress={onBack}
            hitSlop={12}
            style={({ pressed }) => [styles.backButton, pressed ? styles.backButtonPressed : null]}
          >
            <MaterialCommunityIcons
              name={backIcon}
              size={22}
              color={backIcon === "close" ? colors.ink : colors.accent}
            />
          </Pressable>
        ) : null}
        {leading}
        {titleMeta ? (
          <View style={styles.appBarTitleWrap}>
            <Text style={styles.appBarTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.appBarTitleMeta} numberOfLines={1}>
              {titleMeta}
            </Text>
          </View>
        ) : (
          <Text style={styles.appBarTitle} numberOfLines={1}>
            {title}
          </Text>
        )}
        {right ? <View style={styles.appBarActions}>{right}</View> : null}
      </View>
      {notice}
      <KeyboardAvoidingView
        style={styles.flexFill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
        ) : (
          body
        )}
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export type NoticeTone = "neutral" | "warn" | "bad";

/**
 * A one-line strip on the `bar` surface. Offline, read-only and queued all
 * announce themselves here rather than as a failed request. (#120)
 */
export function Notice({
  label,
  tone = "neutral",
  action,
  onAction,
}: {
  label: string;
  tone?: NoticeTone;
  action?: string;
  onAction?: () => void;
}) {
  const styles = useStyles();
  const boxMap: Record<NoticeTone, ViewStyle> = {
    neutral: styles.noticeNeutral,
    warn: styles.noticeWarn,
    bad: styles.noticeBad,
  };
  const dotMap: Record<NoticeTone, ViewStyle> = {
    neutral: styles.dotFaint,
    warn: styles.dotAmber,
    bad: styles.dotRed,
  };
  const textMap: Record<NoticeTone, TextStyle> = {
    neutral: styles.noticeTextNeutral,
    warn: styles.noticeTextWarn,
    bad: styles.noticeTextBad,
  };

  return (
    <View style={[styles.notice, boxMap[tone]]}>
      <View style={[styles.noticeDot, dotMap[tone]]} />
      <Text style={[styles.noticeText, textMap[tone]]} numberOfLines={2}>
        {label}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text style={styles.noticeAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A bordered surface. Borders, not shadows. */
export function Panel({
  children,
  style,
  padded = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
}) {
  const styles = useStyles();
  return <View style={[styles.panel, padded ? styles.panelPadded : null, style]}>{children}</View>;
}

/**
 * The strip above a group of rows: a mono uppercase label on the bar surface,
 * with an optional count on the right.
 */
export function SectionHeader({
  label,
  count,
  right,
}: {
  label: string;
  count?: string | number;
  right?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderLabel} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined ? <Text style={styles.sectionHeaderCount}>{count}</Text> : null}
      {right}
    </View>
  );
}

export type RowDot = "accent" | "amber" | "red" | "green" | "faint";

/**
 * The workhorse. Every list in the app is a stack of these: an optional
 * leading dot, a title with an optional meta line, and a trailing value or
 * chevron.
 */
export function Row({
  title,
  meta,
  dot,
  value,
  valueMeta,
  valueTone,
  leading,
  trailing,
  accessory,
  chevron,
  onPress,
  accessibilityActions,
  onAccessibilityAction,
  onLongPress,
  selected = false,
  minHeight,
  titleNumberOfLines = 1,
  metaMono = false,
  tone = "default",
  pulse = false,
}: {
  title: string;
  meta?: string;
  dot?: RowDot;
  /** Trailing amount or value. Mono, because it is always a number. */
  value?: string;
  /** A second, smaller trailing line: a date, a count. */
  valueMeta?: string;
  valueTone?: "ink" | "amber" | "red" | "green";
  /** Replaces the dot with an icon or avatar. */
  leading?: ReactNode;
  /** Replaces the value column entirely. */
  trailing?: ReactNode;
  /** Sits after the value column — a status pill, in the documents list. */
  accessory?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  /**
   * A gesture-free route to a swipe action, for VoiceOver / TalkBack / switch
   * control. Passed straight through to the pressable.
   */
  accessibilityActions?: Array<{ name: string; label?: string }>;
  onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
  /** Enters selection mode in the documents list. */
  onLongPress?: () => void;
  selected?: boolean;
  /** 56 is the default; the design uses 50 for settings and 66 for Today. */
  minHeight?: number;
  titleNumberOfLines?: number;
  /** The meta line is a size or a count, so set it in mono. */
  metaMono?: boolean;
  /** `bad` tints the row for a failed document. */
  tone?: "default" | "bad";
  /** A document still being processed breathes, so it reads as in flight. */
  pulse?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { density } = useAppearance();

  const dotStyles: Record<RowDot, ViewStyle> = {
    accent: styles.dotAccent,
    amber: styles.dotAmber,
    red: styles.dotRed,
    green: styles.dotGreen,
    faint: styles.dotFaint,
  };
  const valueTones: Record<"ink" | "amber" | "red" | "green", TextStyle> = {
    ink: styles.rowValueInk,
    amber: styles.rowValueAmber,
    red: styles.rowValueRed,
    green: styles.rowValueGreen,
  };

  const body = (
    <>
      {leading ??
        (dot ? (
          pulse ? (
            <PulsingDot style={dotStyles[dot]} />
          ) : (
            <View style={[styles.dot, dotStyles[dot]]} />
          )
        ) : null)}
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowTitle} numberOfLines={titleNumberOfLines}>
          {title}
        </Text>
        {meta ? (
          <Text style={[styles.rowMeta, metaMono ? styles.rowMetaMono : null]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing ??
        (value !== undefined || valueMeta !== undefined ? (
          <View style={styles.rowValueWrap}>
            {value !== undefined ? (
              <Text style={[styles.rowValue, valueTones[valueTone ?? "ink"]]} numberOfLines={1}>
                {value}
              </Text>
            ) : null}
            {valueMeta !== undefined ? (
              <Text style={styles.rowValueMeta} numberOfLines={1}>
                {valueMeta}
              </Text>
            ) : null}
          </View>
        ) : null)}
      {accessory}
      {chevron ? (
        <MaterialCommunityIcons name="chevron-right" size={18} color={colors.faint} />
      ) : null}
    </>
  );

  // Compact tightens the list but never past the 44pt tap-target floor.
  const scaled = Math.round((minHeight ?? 56) * DENSITY_SCALE[density]);
  const sizing = { minHeight: onPress ? Math.max(44, scaled) : scaled };
  const tinted = selected ? styles.rowSelected : tone === "bad" ? styles.rowBad : null;

  if (!onPress && !onLongPress) {
    return <View style={[styles.row, sizing, tinted]}>{body}</View>;
  }

  return (
    <Pressable
      // Without a role a screen reader reads the row as text and gives no hint
      // that it can be opened.
      accessibilityRole="button"
      onPress={onPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, sizing, tinted, pressed ? styles.rowPressed : null]}
    >
      {body}
    </Pressable>
  );
}

/** The dot on a row whose document is still being processed. */
export function PulsingDot({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[styles.dot, style, { opacity }]} />;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  loading,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger";
  size?: "md" | "sm";
  disabled?: boolean;
  loading?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();

  const boxMap = {
    primary: styles.primaryButton,
    secondary: styles.secondaryButton,
    danger: styles.dangerButton,
  };
  const textMap = {
    primary: styles.primaryButtonText,
    secondary: styles.secondaryButtonText,
    danger: styles.dangerButtonText,
  };
  // Each spinner matches its label, so a loading button stays legible.
  const spinnerMap = {
    primary: colors.accentFillInk,
    secondary: colors.ink,
    danger: colors.red,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      // A small button is 38pt tall because the design says so, which is under
      // the 44pt tap target. The slop makes the touch area 46 without changing
      // what is drawn.
      hitSlop={size === "sm" ? { top: 4, bottom: 4, left: 0, right: 0 } : undefined}
      style={({ pressed }) => [
        styles.button,
        size === "sm" ? styles.buttonSm : null,
        boxMap[variant],
        (disabled || loading) && styles.buttonDisabled,
        pressed && !(disabled || loading) ? styles.buttonPressed : null,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={spinnerMap[variant]} /> : null}
      <Text style={[styles.buttonText, textMap[variant]]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  multiline,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  keyboardType?: "default" | "email-address" | "numeric" | "url";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.dim}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
      />
    </View>
  );
}

export type PillTone = "soft" | "warn" | "bad" | "ok" | "outline";

export function Pill({ label, tone = "outline" }: { label: string; tone?: PillTone }) {
  const styles = useStyles();
  const boxMap: Record<PillTone, ViewStyle> = {
    soft: styles.pillSoft,
    warn: styles.pillWarn,
    bad: styles.pillBad,
    ok: styles.pillOk,
    outline: styles.pillOutline,
  };
  const textMap: Record<PillTone, TextStyle> = {
    soft: styles.pillTextSoft,
    warn: styles.pillTextWarn,
    bad: styles.pillTextBad,
    ok: styles.pillTextOk,
    outline: styles.pillTextOutline,
  };

  return (
    <View style={[styles.pill, boxMap[tone]]}>
      <Text style={[styles.pillText, textMap[tone]]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  action,
  onAction,
}: {
  title: string;
  body?: string;
  /** A way back — "show all" after a filter turned up nothing. */
  action?: string;
  onAction?: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={12} style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <Panel padded>
      <Text style={styles.errorTitle}>{t("common.attentionTitle")}</Text>
      <Text style={styles.errorBody}>{message}</Text>
      {onRetry ? (
        <Button label={t("common.retry")} variant="secondary" size="sm" onPress={onRetry} />
      ) : null}
    </Panel>
  );
}

/** A number and its label. Borderless — the strip around it draws the rules. */
export function Metric({
  label,
  value,
  tone = "ink",
  onPress,
}: {
  label: string;
  value: string | number;
  tone?: "ink" | "amber" | "red" | "green";
  onPress?: () => void;
}) {
  const styles = useStyles();
  const toneMap: Record<"ink" | "amber" | "red" | "green", TextStyle> = {
    ink: styles.metricValueInk,
    amber: styles.metricValueAmber,
    red: styles.metricValueRed,
    green: styles.metricValueGreen,
  };

  const content = (
    <>
      <Text style={[styles.metricValue, toneMap[tone]]}>{value}</Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.metric, pressed ? styles.metricPressed : null]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.metric}>{content}</View>;
}

const useStyles = createThemedStyles((c) => ({
  safeArea: {
    flex: 1,
    backgroundColor: c.app,
  },
  flexFill: {
    flex: 1,
  },
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 46,
    flexShrink: 0,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  appBarTitle: {
    ...text.barTitle,
    flex: 1,
    color: c.ink,
  },
  appBarWithBack: {
    paddingLeft: 6,
    paddingRight: 12,
    gap: 9,
  },
  backButton: {
    padding: 4,
  },
  backButtonPressed: {
    opacity: 0.7,
  },
  appBarTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  appBarTitleMeta: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 1,
    color: c.faint,
  },
  appBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  scrollContent: {
    flexGrow: 1,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  noticeNeutral: {
    backgroundColor: c.bar,
  },
  noticeWarn: {
    backgroundColor: c.amberSoft,
  },
  noticeBad: {
    backgroundColor: c.redSoft,
  },
  noticeDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: radii.pill,
  },
  noticeText: {
    ...text.small,
    flex: 1,
  },
  noticeTextNeutral: {
    color: c.dim,
  },
  noticeTextWarn: {
    color: c.amber,
  },
  noticeTextBad: {
    color: c.red,
  },
  noticeAction: {
    ...text.smallStrong,
    color: c.accent,
  },
  content: {
    paddingBottom: 16,
  },
  contentFlex: {
    flex: 1,
  },
  contentPadded: {
    padding: 16,
    gap: 16,
  },
  panel: {
    backgroundColor: c.panel,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
  },
  panelPadded: {
    padding: 14,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  sectionHeaderLabel: {
    ...text.sectionLabel,
    flex: 1,
    color: c.dim,
  },
  sectionHeaderCount: {
    ...text.numeric,
    color: c.faint,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  rowPressed: {
    backgroundColor: c.raised,
  },
  rowBad: {
    backgroundColor: c.redSoft,
  },
  rowSelected: {
    backgroundColor: c.accentSoft,
  },
  rowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    ...text.rowTitle,
    color: c.ink,
  },
  rowMeta: {
    ...text.meta,
    marginTop: 3,
    color: c.dim,
  },
  rowMetaMono: {
    ...text.numericMeta,
    marginTop: 3,
  },
  rowValueWrap: {
    // Shrinkable and capped, so a long value truncates instead of squeezing the
    // title off screen. A server URL is the case that found this.
    flexShrink: 1,
    maxWidth: "55%",
    alignItems: "flex-end",
  },
  rowValue: {
    ...text.amount,
  },
  rowValueInk: {
    color: c.ink,
  },
  rowValueAmber: {
    color: c.amber,
  },
  rowValueRed: {
    color: c.red,
  },
  rowValueGreen: {
    color: c.green,
  },
  rowValueMeta: {
    ...text.numeric,
    marginTop: 3,
    color: c.faint,
  },
  dot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: radii.pill,
  },
  dotAccent: {
    backgroundColor: c.accent,
  },
  dotAmber: {
    backgroundColor: c.amber,
  },
  dotRed: {
    backgroundColor: c.red,
  },
  dotGreen: {
    backgroundColor: c.green,
  },
  dotFaint: {
    backgroundColor: c.borderStrong,
  },
  button: {
    height: 46,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  buttonSm: {
    height: 38,
    paddingHorizontal: 12,
  },
  primaryButton: {
    backgroundColor: c.accentFill,
  },
  secondaryButton: {
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  dangerButton: {
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    ...text.bodyStrong,
  },
  // Colour only — `buttonText` owns the family, and a family here would
  // silently undo its weight.
  primaryButtonText: {
    color: c.accentFillInk,
  },
  secondaryButtonText: {
    color: c.ink,
  },
  dangerButtonText: {
    color: c.red,
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    ...text.meta,
    color: c.muted,
  },
  input: {
    ...text.body,
    height: 44,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 12,
  },
  inputMultiline: {
    height: undefined,
    minHeight: 88,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: "top",
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  pillSoft: {
    backgroundColor: c.accentSoft,
  },
  pillWarn: {
    backgroundColor: c.amberSoft,
  },
  pillBad: {
    backgroundColor: c.redSoft,
  },
  pillOk: {
    backgroundColor: c.greenSoft,
  },
  pillOutline: {
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  pillText: {
    ...text.smallStrong,
    fontSize: 11,
    lineHeight: 15,
  },
  pillTextSoft: {
    color: c.accentSoftInk,
  },
  pillTextWarn: {
    color: c.amber,
  },
  pillTextBad: {
    color: c.red,
  },
  pillTextOk: {
    color: c.green,
  },
  pillTextOutline: {
    color: c.dim,
  },
  emptyState: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 36,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    ...text.barTitle,
    color: c.ink,
    textAlign: "center",
  },
  emptyBody: {
    ...text.meta,
    color: c.dim,
    textAlign: "center",
    maxWidth: 300,
  },
  emptyAction: {
    minHeight: 44,
    justifyContent: "center",
  },
  emptyActionText: {
    ...text.metaStrong,
    color: c.accent,
  },
  errorTitle: {
    ...text.bodyStrong,
    color: c.red,
  },
  errorBody: {
    ...text.meta,
    color: c.ink,
  },
  metric: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 2,
  },
  metricPressed: {
    opacity: 0.7,
  },
  metricValue: {
    ...text.statValue,
  },
  metricValueInk: {
    color: c.ink,
  },
  metricValueAmber: {
    color: c.amber,
  },
  metricValueRed: {
    color: c.red,
  },
  metricValueGreen: {
    color: c.green,
  },
  metricLabel: {
    ...text.small,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
    color: c.faint,
  },
}));
