import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import { Gradient, IconTile, Skeleton } from "../layout";
import { PulsingDot } from "../ui";

/** The question, on the right, in the gradient bubble. */
export function QuestionBubble({ children }: { children: string }) {
  const styles = useStyles();
  return (
    <View style={styles.questionRow}>
      <Gradient name="action" borderRadius={radii.xl} style={styles.bubble}>
        <Text style={styles.bubbleText}>{children}</Text>
      </Gradient>
    </View>
  );
}

/** An assistant turn: the small solid tile, and the content beside it. */
export function AssistantRow({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.assistantRow}>
      <IconTile size="sm" tone="solid">
        <MaterialCommunityIcons name="creation" size={15} color={colors.onGradient} />
      </IconTile>
      <View style={styles.assistantBody}>{children}</View>
    </View>
  );
}

/** One line of the progress trace. `running` says the step is still going. */
export function TraceLine({
  icon,
  label,
  status = "done",
}: {
  icon?: string;
  label: string;
  /** `pulse` for the wait before anything has come back, `spin` for a running tool. */
  status?: "done" | "pulse" | "spin";
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View accessibilityLiveRegion="polite" style={styles.traceLine}>
      {status === "spin" ? (
        <ActivityIndicator size="small" color={colors.muted} style={styles.traceSpinner} />
      ) : icon ? (
        <MaterialCommunityIcons name={icon as never} size={15} color={colors.muted} />
      ) : null}
      <Text style={styles.traceText} numberOfLines={2}>
        {label}
      </Text>
      {status === "pulse" ? <PulsingDot style={styles.traceDot} /> : null}
    </View>
  );
}

/** Where the answer will be, until its first words arrive. */
export function AnswerSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeletonWrap}>
      {[92, 88, 94, 60].map((width) => (
        <Skeleton key={width} style={[styles.skeletonLine, { width: `${width}%` }]} />
      ))}
    </View>
  );
}

/** The amber line for an answer that should not be taken at its word. */
export function WarningNote({ label }: { label: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.warning}>
      <MaterialCommunityIcons name="alert-outline" size={14} color={colors.amber} />
      <Text style={styles.warningText}>{label}</Text>
    </View>
  );
}

/** Copies, and says so for a moment. */
export function useCopied(value: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const copy = () => {
    void Clipboard.setStringAsync(value)
      .then(() => {
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  };
  return { copied, copy };
}

export function CopyAnswerButton({ value }: { value: string }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const { copied, copy } = useCopied(value);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={copied ? t("chat.copied") : t("chat.copyAnswer")}
      onPress={copy}
      style={({ pressed }) => [styles.copyButton, pressed ? styles.pressed : null]}
    >
      <MaterialCommunityIcons
        name={copied ? "check" : "content-copy"}
        size={15}
        color={copied ? colors.green : colors.muted}
      />
    </Pressable>
  );
}

const useStyles = createThemedStyles((c) => ({
  questionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  bubble: {
    maxWidth: "85%",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomRightRadius: radii.sm,
  },
  bubbleText: {
    ...text.body,
    color: c.accentFillInk,
  },
  assistantRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  assistantBody: {
    flex: 1,
    minWidth: 0,
    gap: 12,
  },
  traceLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 28,
  },
  traceSpinner: {
    width: 15,
    height: 15,
    transform: [{ scale: 0.7 }],
  },
  traceText: {
    ...text.body,
    flexShrink: 1,
    color: c.muted,
  },
  traceDot: {
    backgroundColor: c.accent,
  },
  skeletonWrap: {
    gap: 8,
    paddingTop: 4,
  },
  skeletonLine: {
    height: 12,
    borderRadius: radii.pill,
  },
  warning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  warningText: {
    ...text.small,
    flex: 1,
    color: c.amber,
  },
  copyButton: {
    width: 44,
    height: 44,
    marginLeft: -14,
    marginTop: -12,
    marginBottom: -8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  pressed: {
    backgroundColor: c.bar,
  },
}));
