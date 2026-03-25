import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, shadow } from "../theme";

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
  const compact = headerVariant === "compact";
  const body = (
    <View style={[styles.content, contentContainerStyle]}>
      <View style={[styles.headerRow, compact ? styles.headerRowCompact : null]}>
        <View style={styles.headerTextWrap}>
          <Text style={[styles.eyebrow, compact ? styles.eyebrowCompact : null]}>OpenKeep mobile</Text>
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
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
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
      {loading ? <ActivityIndicator color={variant === "secondary" ? colors.primary : "#fff"} /> : null}
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
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
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
  return (
    <Card style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

export function ErrorCard({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card>
      <Text style={styles.errorTitle}>Something needs attention</Text>
      <Text style={styles.errorBody}>{message}</Text>
      {onRetry ? <Button label="Retry" variant="secondary" onPress={onRetry} /> : null}
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backgroundGlowTop: {
    position: "absolute",
    top: -56,
    right: -28,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: colors.primarySoft,
    opacity: 0.35,
  },
  backgroundGlowBottom: {
    position: "absolute",
    bottom: 84,
    left: -72,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: colors.surfaceMuted,
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
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  eyebrowCompact: {
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 2,
  } satisfies TextStyle,
  title: {
    fontSize: 32,
    lineHeight: 37,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.8,
  },
  titleCompact: {
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: -0.5,
  } satisfies TextStyle,
  subtitle: {
    marginTop: 4,
    fontSize: 15,
    lineHeight: 24,
    color: colors.muted,
    maxWidth: 640,
  },
  subtitleCompact: {
    marginTop: 3,
    fontSize: 14,
    lineHeight: 21,
  } satisfies TextStyle,
  sectionHeader: {
    gap: 5,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 16,
    ...shadow,
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
    backgroundColor: colors.primary,
  },
  secondaryButton: {
    backgroundColor: colors.primarySoft,
  },
  dangerButton: {
    backgroundColor: colors.danger,
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
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  primaryButtonText: {
    color: "#fff",
  },
  secondaryButtonText: {
    color: colors.primary,
  },
  dangerButtonText: {
    color: "#fff",
  },
  loadingButtonText: {
    opacity: 0.9,
  },
  fieldWrap: {
    gap: 9,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSoft,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  input: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
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
    backgroundColor: colors.surfaceMuted,
  },
  pillSuccess: {
    backgroundColor: "#d9f3e2",
  },
  pillWarning: {
    backgroundColor: "#f6ead1",
  },
  pillDanger: {
    backgroundColor: "#f4d9d6",
  },
  pillText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  pillTextDefault: {
    color: colors.text,
  },
  pillTextSuccess: {
    color: colors.success,
  },
  pillTextWarning: {
    color: colors.warning,
  },
  pillTextDanger: {
    color: colors.danger,
  },
  emptyCard: {
    alignItems: "center",
    paddingVertical: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.3,
  },
  emptyBody: {
    marginTop: 10,
    textAlign: "center",
    color: colors.muted,
    lineHeight: 22,
    maxWidth: 320,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.danger,
  },
  errorBody: {
    color: colors.text,
    lineHeight: 21,
  },
  metricCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 20,
    padding: 16,
    gap: 8,
  },
  metricCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  metricLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  metricBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metricValue: {
    fontSize: 30,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: -0.8,
  },
  metricChevron: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  metricChevronText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: "800",
    marginTop: -2,
  },
});
