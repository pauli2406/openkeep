import type { ReactNode } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Gradient } from "../components/layout";
import { useI18n } from "../i18n";
import { createThemedStyles, radii } from "../theme";
import { text } from "../typography";

/**
 * Every "before the app" screen: the web's split, turned on its side for a phone.
 * The brand panel becomes a band across the top, the form sits on calm white.
 */
export function AuthFrame({
  title,
  subtitle,
  top,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Above the title: the setup wizard's step indicator. */
  top?: ReactNode;
  /** Under a rule at the end: a way to the other flow. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <Gradient name="chrome" style={[styles.band, { paddingTop: insets.top + 20 }]}>
          <View style={styles.brand}>
            <Image source={require("../../assets/icon.png")} style={styles.logo} />
            <Text style={styles.brandName}>OpenKeep</Text>
          </View>
          <Text style={styles.headline}>{t("auth.brandHeadline")}</Text>
        </Gradient>

        <View style={styles.form}>
          {top}
          <View style={styles.titleBlock}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          <View style={styles.fields}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.app,
  },
  scroll: {
    flexGrow: 1,
  },
  band: {
    gap: 16,
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
  },
  brandName: {
    ...text.barTitle,
    color: c.onGradient,
  },
  headline: {
    ...text.screenTitle,
    fontSize: 22,
    lineHeight: 28,
    color: c.onGradient,
  },
  form: {
    gap: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  titleBlock: {
    gap: 4,
  },
  title: {
    ...text.screenTitle,
    color: c.ink,
  },
  subtitle: {
    ...text.body,
    color: c.muted,
  },
  fields: {
    gap: 14,
  },
  footer: {
    alignItems: "center",
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
}));
