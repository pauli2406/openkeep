import type { ReactNode } from "react";
import { useRef } from "react";
import { useScrollToTop } from "@react-navigation/native";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useI18n } from "../i18n";
import { createThemedStyles, useColors } from "../theme";
import { fonts, text } from "../typography";

export function Screen({
  title,
  subtitle,
  children,
  scroll = true,
  right,
  contentContainerStyle,
  headerVariant = "default",
  includeTopSafeArea = true,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  scroll?: boolean;
  right?: ReactNode;
  contentContainerStyle?: ViewStyle;
  headerVariant?: "default" | "compact";
  includeTopSafeArea?: boolean;
}) {
  const styles = useStyles();
  const scrollRef = useRef<ScrollView>(null);

  useScrollToTop(scrollRef);

  const compact = headerVariant === "compact";
  const body = (
    <View style={[styles.content, contentContainerStyle]}>
      <View style={[styles.headerRow, compact ? styles.headerRowCompact : null]}>
        <View style={styles.headerTextWrap}>
          <Text style={[styles.title, compact ? styles.titleCompact : null]}>{title}</Text>
          {subtitle ? <Text style={[styles.subtitle, compact ? styles.subtitleCompact : null]}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={includeTopSafeArea ? ["top"] : []} style={styles.safeArea}>
      <View pointerEvents="none" style={styles.backgroundGlowTop} />
      <View pointerEvents="none" style={styles.backgroundGlowBottom} />
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
}: {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const styleMap = {
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
    secondary: colors.accentSoftInk,
    danger: colors.app,
  };

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styleMap[variant],
        (disabled || loading) && styles.buttonDisabled,
        pressed && !(disabled || loading) ? styles.buttonPressed : null,
      ]}
    >
      {loading ? <ActivityIndicator color={spinnerMap[variant]} /> : null}
      <Text style={[styles.buttonText, textMap[variant], loading ? styles.loadingButtonText : null]}>{label}</Text>
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

export function Pill({
  label,
  tone = "default",
}: {
  label: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const styles = useStyles();
  const bgMap = {
    default: styles.pillDefault,
    success: styles.pillSuccess,
    warning: styles.pillWarning,
    danger: styles.pillDanger,
  };
  const textMap = {
    default: styles.pillTextDefault,
    success: styles.pillTextSuccess,
    warning: styles.pillTextWarning,
    danger: styles.pillTextDanger,
  };

  return (
    <View style={[styles.pill, bgMap[tone]]}>
      <Text style={[styles.pillText, textMap[tone]]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  const styles = useStyles();
  return (
    <Card style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <Card>
      <Text style={styles.errorTitle}>
        {t("common.attentionTitle")}
      </Text>
      <Text style={styles.errorBody}>{message}</Text>
      {onRetry ? (
        <Button
          label={t("common.retry")}
          variant="secondary"
          onPress={onRetry}
        />
      ) : null}
    </Card>
  );
}

export function Metric({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string | number;
  onPress?: () => void;
}) {
  const styles = useStyles();
  const content = (
    <>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricBottomRow}>
        <Text style={styles.metricValue}>{value}</Text>
        {onPress ? (
          <View style={styles.metricChevron}>
            <Text style={styles.metricChevronText}>{"\u203a"}</Text>
          </View>
        ) : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.metricCard, pressed ? styles.metricCardPressed : null]}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={styles.metricCard}>{content}</View>;
}

const useStyles = createThemedStyles((c) => ({
  safeArea: {
    flex: 1,
    backgroundColor: c.app,
  },
  flexFill: {
    flex: 1,
  },
  backgroundGlowTop: {
    position: "absolute",
    top: -56,
    right: -28,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: c.accentSoft,
    opacity: 0.35,
  },
  backgroundGlowBottom: {
    position: "absolute",
    bottom: 84,
    left: -72,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: c.raised,
    opacity: 0.55,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 0,
    gap: 20,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 0,
  },
  headerRowCompact: {
    gap: 10,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    ...text.screenTitle,
    color: c.ink,
  },
  titleCompact: {
    ...text.barTitle,
  } satisfies TextStyle,
  subtitle: {
    ...text.meta,
    marginTop: 4,
    color: c.muted,
    maxWidth: 640,
  },
  subtitleCompact: {
    marginTop: 3,
  } satisfies TextStyle,
  sectionHeader: {
    gap: 5,
  },
  sectionTitle: {
    ...text.screenTitle,
    color: c.ink,
  },
  sectionHint: {
    ...text.meta,
    color: c.muted,
  },
  card: {
    backgroundColor: c.panel,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: c.border,
    gap: 16,
  },
  button: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 18,
  },
  primaryButton: {
    backgroundColor: c.accentFill,
  },
  secondaryButton: {
    backgroundColor: c.accentSoft,
  },
  dangerButton: {
    backgroundColor: c.red,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.96,
    transform: [{ scale: 0.985 }],
  },
  buttonText: {
    fontSize: 15,
    fontFamily: fonts.sans.semibold,
    letterSpacing: 0.1,
  },
  primaryButtonText: {
    fontFamily: fonts.sans.regular,
    color: c.accentFillInk,
  },
  secondaryButtonText: {
    fontFamily: fonts.sans.regular,
    color: c.accentSoftInk,
  },
  dangerButtonText: {
    fontFamily: fonts.sans.regular,
    color: c.app,
  },
  loadingButtonText: {
    opacity: 0.9,
  },
  fieldWrap: {
    gap: 9,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  input: {
    fontFamily: fonts.sans.regular,
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    lineHeight: 22,
  },
  inputMultiline: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  pill: {
    alignSelf: "flex-start",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
  },
  pillDefault: {
    backgroundColor: c.raised,
  },
  pillSuccess: {
    backgroundColor: c.greenSoft,
  },
  pillWarning: {
    backgroundColor: c.amberSoft,
  },
  pillDanger: {
    backgroundColor: c.redSoft,
  },
  pillText: {
    fontSize: 11,
    fontFamily: fonts.sans.semibold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  pillTextDefault: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
  },
  pillTextSuccess: {
    fontFamily: fonts.sans.regular,
    color: c.green,
  },
  pillTextWarning: {
    fontFamily: fonts.sans.regular,
    color: c.amber,
  },
  pillTextDanger: {
    fontFamily: fonts.sans.regular,
    color: c.red,
  },
  emptyCard: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyTitle: {
    ...text.screenTitle,
    color: c.ink,
  },
  emptyBody: {
    fontFamily: fonts.sans.regular,
    marginTop: 10,
    textAlign: "center",
    color: c.muted,
    lineHeight: 22,
    maxWidth: 320,
  },
  errorTitle: {
    ...text.barTitle,
    color: c.red,
  },
  errorBody: {
    fontFamily: fonts.sans.regular,
    color: c.ink,
    lineHeight: 21,
  },
  metricCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: c.raised,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  metricCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  metricLabel: {
    ...text.sectionLabel,
    color: c.muted,
  },
  metricBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricValue: {
    ...text.statValue,
    color: c.ink,
  },
  metricChevron: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  metricChevronText: {
    color: c.accent,
    fontSize: 18,
    fontFamily: fonts.sans.semibold,
    marginTop: -2,
  },
}));
