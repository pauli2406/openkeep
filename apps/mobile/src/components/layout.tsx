import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createThemedStyles, radii, raisedShadow, useColors, type Colors } from "../theme";
import { text } from "../typography";

/** A CSS angle as the unit-square endpoints `LinearGradient` wants. */
function endpoints(angle: number) {
  const radians = (angle * Math.PI) / 180;
  const x = Math.sin(radians);
  const y = -Math.cos(radians);
  return {
    start: { x: 0.5 - x / 2, y: 0.5 - y / 2 },
    end: { x: 0.5 + x / 2, y: 0.5 + y / 2 },
  };
}

/**
 * A theme gradient. `name` picks one of the four the web theme defines, so a call
 * site never spells a colour or an angle.
 */
export function Gradient({
  name,
  style,
  borderRadius,
  children,
}: {
  name: keyof Colors["gradient"];
  style?: StyleProp<ViewStyle>;
  borderRadius?: number;
  children?: ReactNode;
}) {
  const gradient = useColors().gradient[name];
  return (
    <LinearGradient
      colors={gradient.colors as [string, string, ...string[]]}
      locations={gradient.locations as [number, number, ...number[]]}
      {...endpoints(gradient.angle)}
      style={[borderRadius !== undefined ? { borderRadius } : null, style]}
    >
      {children}
    </LinearGradient>
  );
}

/** The signature surface. Use it at most once on a screen. */
export function GradientPanel({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.panelShadow, style]}>
      <Gradient name="brand" borderRadius={radii.xxl} style={styles.panelFill}>
        {children}
      </Gradient>
    </View>
  );
}

/** A soft blue square around an icon; `solid` for the gradient version. */
export function IconTile({
  children,
  size = "default",
  tone = "soft",
}: {
  children: ReactNode;
  size?: "sm" | "default" | "lg" | "xl";
  tone?: "soft" | "solid";
}) {
  const styles = useStyles();
  const box =
    size === "sm"
      ? styles.tileSm
      : size === "lg"
        ? styles.tileLg
        : size === "xl"
          ? styles.tileXl
          : styles.tile;
  if (tone === "solid") {
    return (
      <Gradient name="brand" style={[styles.tileBase, box]} borderRadius={box.borderRadius}>
        {children}
      </Gradient>
    );
  }
  return <View style={[styles.tileBase, styles.tileSoft, box]}>{children}</View>;
}

/** A filter pill. `active` is the selected state. */
export function Chip({
  label,
  active = false,
  onPress,
  count,
  disabled,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  count?: number;
  disabled?: boolean;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6 }}
      style={[styles.chip, active ? styles.chipActive : null, disabled ? styles.dimmed : null]}
    >
      <Text style={[styles.chipText, active ? styles.chipTextActive : null]} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text style={[styles.chipCount, active ? styles.chipTextActive : null]}>{count}</Text>
      ) : null}
    </Pressable>
  );
}

/** One-of-many switch, the web's `SegmentedControl`. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: string }>;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View accessibilityRole="radiogroup" style={styles.segmented}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            hitSlop={{ top: 6, bottom: 6 }}
            style={[styles.segment, active ? styles.segmentActive : null]}
          >
            {option.icon ? (
              <MaterialCommunityIcons
                name={option.icon as never}
                size={15}
                color={active ? colors.ink : colors.muted}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={[styles.segmentText, active ? styles.segmentTextActive : null]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A pulsing placeholder for content that is on its way. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.skeleton, { opacity }, style]} />;
}

/** A sheet rising from the bottom: filters, pickers, secondary panels. */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* A modal is its own window, so the screen's avoiding view never reaches it. */}
      <KeyboardAvoidingView
        style={styles.sheetRoot}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable
          accessibilityLabel={title}
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.sheetHandle} />
          {title ? (
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {title}
              </Text>
              <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
                <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
              </Pressable>
            </View>
          ) : null}
          <ScrollView
            style={styles.sheetBody}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createThemedStyles((c) => ({
  panelShadow: {
    borderRadius: radii.xxl,
    ...raisedShadow(c),
  },
  panelFill: {
    overflow: "hidden",
    padding: 18,
  },
  tileBase: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tileSoft: {
    backgroundColor: c.accentSoft,
  },
  tileSm: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
  },
  tile: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
  },
  tileXl: {
    width: 56,
    height: 56,
    borderRadius: radii.xl,
  },
  tileLg: {
    width: 44,
    height: 44,
    borderRadius: radii.lg,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.app,
  },
  chipActive: {
    borderColor: "transparent",
    backgroundColor: c.accentSoft,
  },
  chipText: {
    ...text.body,
    color: c.muted,
  },
  chipTextActive: {
    fontFamily: text.bodyStrong.fontFamily,
    color: c.accentSoftInk,
  },
  chipCount: {
    ...text.numeric,
    color: c.muted,
  },
  dimmed: {
    opacity: 0.5,
  },
  segmented: {
    flexDirection: "row",
    height: 36,
    padding: 3,
    gap: 2,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
  },
  segmentActive: {
    backgroundColor: c.app,
    shadowColor: c.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: {
    ...text.body,
    color: c.muted,
  },
  segmentTextActive: {
    fontFamily: text.bodyStrong.fontFamily,
    color: c.ink,
  },
  skeleton: {
    borderRadius: radii.sm,
    backgroundColor: c.raised,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: c.overlay,
  },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    backgroundColor: c.panel,
    ...raisedShadow(c),
  },
  sheetHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    marginTop: 8,
    borderRadius: radii.pill,
    backgroundColor: c.borderStrong,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  sheetTitle: {
    ...text.barTitle,
    flex: 1,
    color: c.ink,
  },
  sheetBody: {
    flexGrow: 0,
  },
  sheetContent: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  sheetFooter: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
}));
