import type { Ref } from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, raisedShadow, useColors } from "../../theme";
import { text } from "../../typography";
import { Gradient } from "../layout";

/** The rounded card the question is typed in, with the gradient send button. */
export function Composer({
  value,
  onChangeText,
  onSend,
  placeholder,
  hint,
  busy = false,
  canSend,
  inputRef,
}: {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  placeholder: string;
  /** "provider · only extracted text". */
  hint: string;
  /** An answer is on its way. */
  busy?: boolean;
  canSend: boolean;
  inputRef?: Ref<TextInput>;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  return (
    <View style={styles.card}>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        accessibilityLabel={placeholder}
        multiline
        style={styles.input}
      />
      <View style={styles.footer}>
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("chat.send")}
          accessibilityState={{ disabled: !canSend, busy }}
          disabled={!canSend}
          onPress={onSend}
          hitSlop={6}
          style={({ pressed }) => [
            !canSend ? styles.sendDisabled : null,
            pressed && canSend ? styles.sendPressed : null,
          ]}
        >
          <Gradient name="action" borderRadius={radii.pill} style={styles.send}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.accentFillInk} />
            ) : (
              <MaterialCommunityIcons name="arrow-up" size={18} color={colors.accentFillInk} />
            )}
          </Gradient>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  card: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.xl,
    backgroundColor: c.panel,
    ...raisedShadow(c),
  },
  input: {
    ...text.body,
    fontSize: 15,
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    color: c.ink,
    textAlignVertical: "top",
    // The browser's focus ring, in the test harness; a phone draws none.
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 16,
    paddingRight: 8,
    paddingBottom: 8,
  },
  hint: {
    ...text.small,
    flex: 1,
    color: c.muted,
  },
  send: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  sendDisabled: {
    opacity: 0.45,
  },
  sendPressed: {
    opacity: 0.85,
  },
}));
