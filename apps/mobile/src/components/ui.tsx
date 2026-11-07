import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useScrollToTop } from "@react-navigation/native";
import {
  Modal,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../i18n";
import {
  cardShadow,
  createThemedStyles,
  DENSITY_SCALE,
  radii,
  useAppearance,
  useColors,
} from "../theme";
import { Gradient, IconTile } from "./layout";
import { SHELL_HEADER_HEIGHT, useInShell } from "./shell-context";

/**
 * A modal that covers the screen, with its safe area respected.
 *
 * A `Modal` is its own native view hierarchy, so the insets measured for the app
 * window never reach it: a `SafeAreaView` inside one measures nothing, and a
 * header ends up under the status bar and the clock. Nesting a provider inside
 * the modal is what makes the insets real, and having one component do it means
 * the next full-screen sheet cannot forget.
 */
export function FullScreenModal({
  visible = true,
  onRequestClose,
  style,
  children,
}: {
  visible?: boolean;
  onRequestClose: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onRequestClose}>
      <SafeAreaProvider>
        <SafeAreaView style={style} edges={["top", "bottom"]}>
          {children}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
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
  hideHeader = false,
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
  /** A screen with its own hero, such as Today, opens without a page heading. */
  hideHeader?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const inShell = useInShell();
  const insets = useSafeAreaInsets();

  useScrollToTop(scrollRef);

  // Inside the shell the header belongs to the shell, so a title is the page's
  // own heading in the body, exactly as on the web.
  const pageHeader = inShell ? (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <Text style={styles.pageTitle} numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
        {titleMeta ? (
          <Text style={styles.pageMeta} numberOfLines={2}>
            {titleMeta}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.appBarActions}>{right}</View> : null}
    </View>
  ) : null;

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
      {scroll && !hideHeader ? (
        padded ? <View style={styles.pageHeaderInset}>{pageHeader}</View> : pageHeader
      ) : null}
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={includeTopSafeArea && !inShell ? ["top"] : []} style={styles.safeArea}>
      {inShell ? null : (
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
      )}
      {notice}
      {!scroll && !hideHeader ? pageHeader : null}
      <KeyboardAvoidingView
        style={styles.flexFill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        // The shell's header sits above this view, and the avoiding view measures
        // from its own top, not the screen's.
        keyboardVerticalOffset={inShell ? SHELL_HEADER_HEIGHT + insets.top : 0}
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

/** A card: white, softly lifted, with the web's rounded corners. */
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
 * The label above a group of rows, with an optional count on the right.
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
  icon,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  disabled?: boolean;
  loading?: boolean;
  /** A MaterialCommunityIcons name, drawn before the label. */
  icon?: string;
}) {
  const styles = useStyles();
  const colors = useColors();

  const boxMap = {
    primary: styles.primaryButton,
    secondary: styles.secondaryButton,
    ghost: styles.ghostButton,
    danger: styles.dangerButton,
  };
  const textMap = {
    primary: styles.primaryButtonText,
    secondary: styles.secondaryButtonText,
    ghost: styles.secondaryButtonText,
    danger: styles.dangerButtonText,
  };
  // Each spinner matches its label, so a loading button stays legible.
  const spinnerMap = {
    primary: colors.accentFillInk,
    secondary: colors.ink,
    ghost: colors.ink,
    danger: colors.red,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
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
      {variant === "primary" ? (
        <Gradient name="action" style={styles.buttonFill} borderRadius={radii.lg} />
      ) : null}
      {loading ? <ActivityIndicator size="small" color={spinnerMap[variant]} /> : null}
      {icon && !loading ? (
        <MaterialCommunityIcons
          name={icon as never}
          size={size === "sm" ? 15 : 17}
          color={spinnerMap[variant]}
        />
      ) : null}
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
  icon,
}: {
  title: string;
  body?: string;
  /** A MaterialCommunityIcons name, in a soft tile above the title. */
  icon?: string;
  /** A way back — "show all" after a filter turned up nothing. */
  action?: string;
  onAction?: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.emptyState}>
      {icon ? (
        <IconTile>
          <MaterialCommunityIcons name={icon as never} size={18} color={colors.accentSoftInk} />
        </IconTile>
      ) : null}
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
    height: 52,
    flexShrink: 0,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.app,
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
    padding: 6,
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
    marginTop: 1,
    color: c.muted,
  },
  appBarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    paddingVertical: 8,
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
    color: c.muted,
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
    paddingBottom: 24,
  },
  contentFlex: {
    flex: 1,
  },
  contentPadded: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 28,
    gap: 16,
  },
  panel: {
    backgroundColor: c.panel,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
    ...cardShadow(c),
  },
  panelPadded: {
    padding: 16,
    gap: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 8,
  },
  sectionHeaderLabel: {
    ...text.sectionLabel,
    flex: 1,
    color: c.muted,
  },
  sectionHeaderCount: {
    ...text.numeric,
    color: c.muted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  rowPressed: {
    backgroundColor: c.bar,
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
    marginTop: 2,
    color: c.muted,
  },
  rowMetaMono: {
    ...text.numericMeta,
    marginTop: 2,
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
    marginTop: 2,
    color: c.muted,
  },
  dot: {
    width: 8,
    height: 8,
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
    backgroundColor: c.muted,
  },
  button: {
    height: 44,
    borderRadius: radii.lg,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
  },
  buttonSm: {
    height: 38,
    borderRadius: radii.md,
    paddingHorizontal: 12,
  },
  primaryButton: {
    backgroundColor: c.accentFill,
  },
  secondaryButton: {
    backgroundColor: c.app,
    borderWidth: 1,
    borderColor: c.border,
  },
  dangerButton: {
    backgroundColor: c.redSoft,
  },
  buttonFill: {
    ...StyleSheet.absoluteFillObject,
  },
  ghostButton: {
    backgroundColor: "transparent",
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
  },
  pageHeaderInset: {
    marginHorizontal: -16,
    marginTop: -20,
    marginBottom: -8,
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    ...text.screenTitle,
    color: c.ink,
  },
  pageMeta: {
    ...text.body,
    marginTop: 2,
    color: c.muted,
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
  inputMultiline: {
    height: undefined,
    minHeight: 88,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: "top",
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
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
    borderColor: c.border,
  },
  pillText: {
    ...text.smallStrong,
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
    color: c.ink,
  },
  emptyState: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    ...text.barTitle,
    color: c.ink,
    textAlign: "center",
  },
  emptyBody: {
    ...text.body,
    color: c.muted,
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
    marginTop: 2,
    color: c.muted,
  },
}));
