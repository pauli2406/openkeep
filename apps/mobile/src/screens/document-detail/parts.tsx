import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, Text, View, type DimensionValue } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Gradient, Skeleton } from "../../components/layout";
import { Pill } from "../../components/ui";
import { documentRowState, isDocumentProcessing } from "../../document-processing";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import type { ArchiveDocument } from "../../lib";

/** Where the document stands in the pipeline, in one pill. */
export function DocumentStatusPill({
  document,
}: {
  document: Pick<ArchiveDocument, "status" | "latestProcessingJob">;
}) {
  const { t } = useI18n();
  if (isDocumentProcessing(document)) {
    return (
      <Pill
        tone="soft"
        label={
          documentRowState(document) === "queued"
            ? t("documentDetail.statusQueued")
            : t("documentDetail.processing")
        }
      />
    );
  }
  if (document.status === "failed") {
    return <Pill tone="bad" label={t("documentDetail.statusFailed")} />;
  }
  return <Pill tone="ok" label={t("documentDetail.statusReady")} />;
}

/** How sure the AI is, as a small meter that colours itself by threshold. */
export function ConfidenceMeter({ value, showValue = false }: { value: number; showValue?: boolean }) {
  const styles = useStyles();
  const { t } = useI18n();
  const percent = Math.round(value * 100);
  const fill = value >= 0.8 ? styles.meterHigh : value >= 0.5 ? styles.meterMid : styles.meterLow;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`${t("documentDetail.confidence")} ${percent}%`}
      style={styles.meter}
    >
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, fill, { width: `${percent}%` }]} />
      </View>
      {showValue ? <Text style={styles.meterValue}>{`${percent}%`}</Text> : null}
    </View>
  );
}

/** A titled panel inside a tab. Bordered, never raised: the tab is already a card. */
export function InspectorCard({
  title,
  aside,
  children,
  tinted = false,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  tinted?: boolean;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.card, tinted ? styles.cardTinted : null]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {title}
        </Text>
        {aside}
      </View>
      {children}
    </View>
  );
}

/** Label-left, value-right facts. */
export function MetaRows({ rows }: { rows: Array<[label: string, value: ReactNode]> }) {
  const styles = useStyles();
  return (
    <View style={styles.metaRows}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.metaRow}>
          <Text style={styles.metaLabel}>{label}</Text>
          {typeof value === "string" ? (
            <Text style={styles.metaValue}>{value}</Text>
          ) : (
            <View style={styles.metaValueBox}>{value}</View>
          )}
        </View>
      ))}
    </View>
  );
}

/** A chevron and a label that show or hide what is under them. */
export function Disclosure({
  label,
  open,
  onToggle,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.disclosure, pressed ? styles.pressed : null]}
    >
      <MaterialCommunityIcons
        name={open ? "chevron-down" : "chevron-right"}
        size={16}
        color={colors.muted}
      />
      <Text style={styles.disclosureText}>{label}</Text>
    </Pressable>
  );
}

/** A collapsed block of JSON: real data, but rarely what you came for. */
export function RawJson({ label, value }: { label: string; value: unknown }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Disclosure label={label} open={open} onToggle={() => setOpen((current) => !current)} />
      {open ? (
        <ScrollView style={styles.json} nestedScrollEnabled>
          <Text style={styles.jsonText} selectable>
            {JSON.stringify(value, null, 2)}
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

/** A soft failure strip, for an action that did not take. */
export function InlineError({ message }: { message: string }) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View accessibilityRole="alert" style={styles.inlineError}>
      <MaterialCommunityIcons name="alert-outline" size={16} color={colors.red} />
      <Text style={styles.inlineErrorText}>{message}</Text>
    </View>
  );
}

/** Lines of text that have not arrived yet. */
export function SkeletonLines({
  widths = ["92%", "88%", "60%"],
}: {
  widths?: DimensionValue[];
}) {
  const styles = useStyles();
  return (
    <View style={styles.skeletonLines}>
      {widths.map((width, index) => (
        <Skeleton key={index} style={[styles.skeletonLine, { width }]} />
      ))}
    </View>
  );
}

/** The header's bottom edge while the worker has the document. */
export function ProcessingLine() {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View style={[styles.processingLine, { opacity }]}>
      <Gradient name="action" style={styles.processingFill} />
    </Animated.View>
  );
}

/** A square icon button, 44pt to the finger whatever it draws. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  outlined = false,
  size = 36,
  tone = "muted",
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  outlined?: boolean;
  size?: number;
  tone?: "muted" | "amber" | "accent";
}) {
  const styles = useStyles();
  const colors = useColors();
  const slop = Math.max(0, (44 - size) / 2);
  const ink = disabled
    ? colors.faint
    : tone === "amber"
      ? colors.amber
      : tone === "accent"
        ? colors.accent
        : colors.muted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size },
        outlined ? styles.iconButtonOutlined : null,
        disabled ? styles.iconButtonDisabled : null,
        pressed ? styles.iconButtonPressed : null,
      ]}
    >
      <MaterialCommunityIcons name={icon as never} size={18} color={ink} />
    </Pressable>
  );
}

const useStyles = createThemedStyles((c) => ({
  meter: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: 6,
  },
  meterTrack: {
    width: 28,
    height: 4,
    overflow: "hidden",
    borderRadius: radii.pill,
    backgroundColor: c.raised,
  },
  meterFill: {
    height: "100%",
    borderRadius: radii.pill,
  },
  meterHigh: {
    backgroundColor: c.green,
  },
  meterMid: {
    backgroundColor: c.amber,
  },
  meterLow: {
    backgroundColor: c.red,
  },
  meterValue: {
    ...text.numeric,
    color: c.muted,
  },
  card: {
    gap: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.xl,
    backgroundColor: c.panel,
  },
  cardTinted: {
    backgroundColor: c.bar,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  cardTitle: {
    ...text.bodyStrong,
    flexShrink: 1,
    color: c.ink,
  },
  metaRows: {
    gap: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  metaLabel: {
    ...text.meta,
    width: 96,
    flexShrink: 0,
    color: c.muted,
  },
  metaValue: {
    ...text.meta,
    flex: 1,
    minWidth: 0,
    color: c.ink,
  },
  metaValueBox: {
    flex: 1,
    minWidth: 0,
    alignItems: "flex-start",
  },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 4,
    minHeight: 44,
    paddingRight: 8,
  },
  disclosureText: {
    ...text.metaStrong,
    color: c.muted,
  },
  pressed: {
    opacity: 0.7,
  },
  json: {
    maxHeight: 384,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
    padding: 12,
  },
  jsonText: {
    ...text.mono,
    fontSize: 11,
    lineHeight: 17,
    color: c.ink,
  },
  inlineError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: radii.lg,
    backgroundColor: c.redSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inlineErrorText: {
    ...text.meta,
    flex: 1,
    color: c.red,
  },
  skeletonLines: {
    gap: 8,
    paddingTop: 2,
  },
  skeletonLine: {
    height: 12,
    borderRadius: radii.pill,
  },
  processingLine: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
  },
  processingFill: {
    flex: 1,
  },
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    borderRadius: radii.md,
  },
  iconButtonOutlined: {
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
  },
  iconButtonDisabled: {
    opacity: 0.5,
  },
  iconButtonPressed: {
    backgroundColor: c.raised,
  },
}));

export const useAnswerMarkdownStyles = createThemedStyles((c) => ({
  body: {
    ...text.body,
    color: c.ink,
  },
  strong: {
    ...text.bodyStrong,
    color: c.ink,
  },
  em: {
    fontStyle: "italic",
  },
  paragraph: {
    marginTop: 0,
    marginBottom: 6,
  },
  bullet_list: {
    marginTop: 2,
    marginBottom: 2,
  },
  ordered_list: {
    marginTop: 2,
    marginBottom: 2,
  },
  list_item: {
    marginBottom: 3,
    flexDirection: "row",
  },
  link: {
    ...text.bodyStrong,
    color: c.accent,
    textDecorationLine: "none",
  },
  code_inline: {
    ...text.numeric,
    color: c.ink,
    backgroundColor: c.raised,
    borderRadius: radii.sm,
    paddingHorizontal: 4,
  },
}));
