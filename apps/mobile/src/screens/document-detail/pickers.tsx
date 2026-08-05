import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Pill } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";

/**
 * The taxonomy pickers, lifted out of the old single file (#114). The
 * behaviour — search, create-a-correspondent, clear — is unchanged; only the
 * styling moved onto the token set.
 */
export function PickerField({
  label,
  selectedId,
  options,
  onSelect,
  placeholder,
  createValue,
  onCreateValueChange,
  onCreateOption,
  createPending = false,
  createError = null,
}: {
  label: string;
  selectedId: string;
  options: Array<{ id: string; label: string }>;
  onSelect: (id: string) => void;
  placeholder: string;
  createValue?: string;
  onCreateValueChange?: (value: string) => void;
  onCreateOption?: () => void;
  createPending?: boolean;
  createError?: string | null;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = options.filter((option) =>
    option.label.toLowerCase().includes(search.toLowerCase()),
  );
  const selectedLabel = options.find((option) => option.id === selectedId)?.label ?? "";

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <Pressable onPress={() => setOpen(!open)} style={styles.button}>
        <Text style={[styles.buttonText, selectedLabel ? null : styles.placeholder]}>
          {selectedLabel || placeholder}
        </Text>
        <Text style={styles.chevron}>{open ? "▲" : "▼"}</Text>
      </Pressable>
      {open ? (
        <View style={styles.dropdown}>
          <TextInput
            style={styles.search}
            value={search}
            onChangeText={setSearch}
            placeholder={t("documentDetail.picker.filter")}
            placeholderTextColor={colors.dim}
          />
          {onCreateValueChange && onCreateOption ? (
            <View style={styles.createRow}>
              <TextInput
                style={styles.createInput}
                value={createValue ?? ""}
                onChangeText={onCreateValueChange}
                placeholder={t("documentDetail.picker.addNew")}
                placeholderTextColor={colors.dim}
              />
              <Pressable
                onPress={onCreateOption}
                disabled={createPending || !(createValue ?? "").trim()}
                style={[
                  styles.createButton,
                  createPending || !(createValue ?? "").trim()
                    ? styles.createButtonDisabled
                    : null,
                ]}
              >
                <Text style={styles.createButtonText}>
                  {createPending ? t("documentDetail.picker.adding") : t("documentDetail.picker.add")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {createError ? <Text style={styles.createError}>{createError}</Text> : null}
          <Pressable
            onPress={() => {
              onSelect("");
              setOpen(false);
              setSearch("");
            }}
            style={styles.option}
          >
            <Text style={[styles.optionText, styles.optionClear]}>
              {t("documentDetail.picker.none")}
            </Text>
          </Pressable>
          <ScrollView style={styles.list} nestedScrollEnabled>
            {filtered.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => {
                  onSelect(option.id);
                  setOpen(false);
                  setSearch("");
                }}
                style={[styles.option, option.id === selectedId ? styles.optionSelected : null]}
              >
                <Text
                  style={[
                    styles.optionText,
                    option.id === selectedId ? styles.optionTextSelected : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

export function TagsPicker({
  label,
  selectedIds,
  options,
  onToggle,
}: {
  label: string;
  selectedIds: string[];
  options: Array<{ id: string; label: string }>;
  onToggle: (id: string) => void;
}) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen(!open)} hitSlop={8}>
        <Text style={styles.label}>{`${label} (${selectedIds.length})`}</Text>
      </Pressable>
      {selectedIds.length > 0 ? (
        <View style={styles.tagRow}>
          {selectedIds.map((id) => {
            const option = options.find((item) => item.id === id);
            return option ? (
              <Pressable key={id} onPress={() => onToggle(id)}>
                <Pill label={`${option.label} ×`} tone="outline" />
              </Pressable>
            ) : null;
          })}
        </View>
      ) : null}
      {open ? (
        <View style={styles.dropdown}>
          <ScrollView style={styles.list} nestedScrollEnabled>
            {options.map((option) => {
              const selected = selectedIds.includes(option.id);
              return (
                <Pressable
                  key={option.id}
                  onPress={() => onToggle(option.id)}
                  style={[styles.option, selected ? styles.optionSelected : null]}
                >
                  <Text style={[styles.optionText, selected ? styles.optionTextSelected : null]}>
                    {`${selected ? "✓ " : ""}${option.label}`}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  wrap: {
    gap: 6,
  },
  label: {
    ...text.meta,
    color: c.muted,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: 9,
    backgroundColor: c.panel,
    paddingHorizontal: 12,
  },
  buttonText: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  placeholder: {
    color: c.dim,
  },
  chevron: {
    ...text.small,
    color: c.dim,
  },
  dropdown: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 9,
    backgroundColor: c.panel,
    overflow: "hidden",
  },
  search: {
    ...text.body,
    height: 40,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
    color: c.ink,
    paddingHorizontal: 12,
  },
  createRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  createInput: {
    ...text.body,
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.md,
    color: c.ink,
    paddingHorizontal: 10,
  },
  createButton: {
    height: 38,
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: c.accentFill,
    paddingHorizontal: 12,
  },
  createButtonDisabled: {
    opacity: 0.45,
  },
  createButtonText: {
    ...text.metaStrong,
    color: c.accentFillInk,
  },
  createError: {
    ...text.meta,
    color: c.red,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  list: {
    maxHeight: 220,
  },
  option: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  optionSelected: {
    backgroundColor: c.accentSoft,
  },
  optionText: {
    ...text.body,
    color: c.ink,
  },
  optionTextSelected: {
    color: c.accentSoftInk,
  },
  optionClear: {
    color: c.dim,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
}));
