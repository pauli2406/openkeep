import { useEffect, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BottomSheet, Skeleton } from "../../components/layout";
import { ErrorCard } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";

export type SheetOption = { id: string; label: string };

/**
 * Picks one taxonomy entry: the phone's version of the web's select and its
 * search-and-create chips. With `onCreate`, a name that matches nothing can be
 * added right there, so the document you are holding is never stranded on an
 * entry that does not exist yet.
 */
export function OptionSheet({
  visible,
  title,
  options,
  selectedId,
  loading = false,
  error = null,
  onRetry,
  searchPlaceholder,
  onSelect,
  onCreate,
  createPending = false,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  selectedId: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  searchPlaceholder?: string;
  onSelect: (id: string) => void;
  onCreate?: (name: string) => void;
  createPending?: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!visible) {
      setQuery("");
    }
  }, [visible]);

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;
  const canCreate =
    Boolean(onCreate) &&
    needle.length > 0 &&
    !options.some((option) => option.label.trim().toLowerCase() === needle);

  const pick = (id: string) => {
    onSelect(id);
    onClose();
  };

  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}>
      {error ? (
        <ErrorCard message={error} onRetry={onRetry} />
      ) : loading ? (
        <View style={styles.skeletons}>
          <Skeleton style={styles.skeletonRow} />
          <Skeleton style={styles.skeletonRow} />
          <Skeleton style={styles.skeletonRow} />
        </View>
      ) : (
        <>
          {searchPlaceholder ? (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.dim}
              accessibilityLabel={searchPlaceholder}
              autoCorrect={false}
              returnKeyType="done"
              style={styles.search}
            />
          ) : null}

          <View>
            {needle ? null : (
              <OptionRow
                label={t("documentDetail.noneOption")}
                muted
                selected={selectedId === ""}
                onPress={() => pick("")}
              />
            )}
            {matches.map((option) => (
              <OptionRow
                key={option.id}
                label={option.label}
                selected={option.id === selectedId}
                onPress={() => pick(option.id)}
              />
            ))}
            {canCreate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t("documentDetail.createOption")}: ${query.trim()}`}
                disabled={createPending}
                onPress={() => {
                  onCreate?.(query.trim());
                  onClose();
                }}
                style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
              >
                <MaterialCommunityIcons name="plus" size={18} color={colors.accent} />
                <Text style={styles.createText} numberOfLines={1}>
                  {query.trim()}
                </Text>
              </Pressable>
            ) : null}
            {needle && matches.length === 0 && !canCreate ? (
              <Text style={styles.empty}>{t("documentDetail.noOptions")}</Text>
            ) : null}
          </View>
        </>
      )}
    </BottomSheet>
  );
}

function OptionRow({
  label,
  selected,
  muted = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  muted?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <Text style={[styles.rowText, muted ? styles.rowTextMuted : null]} numberOfLines={1}>
        {label}
      </Text>
      {selected ? <MaterialCommunityIcons name="check" size={18} color={colors.accent} /> : null}
    </Pressable>
  );
}

const useStyles = createThemedStyles((c) => ({
  skeletons: {
    gap: 8,
    paddingBottom: 8,
  },
  skeletonRow: {
    height: 36,
  },
  search: {
    ...text.body,
    height: 44,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.lg,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderRadius: radii.md,
    paddingHorizontal: 4,
  },
  rowPressed: {
    backgroundColor: c.raised,
  },
  rowText: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  rowTextMuted: {
    color: c.muted,
  },
  createText: {
    ...text.bodyStrong,
    flex: 1,
    color: c.accent,
  },
  empty: {
    ...text.body,
    paddingVertical: 12,
    color: c.muted,
  },
}));
