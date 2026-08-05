import { Modal, ScrollView, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button, Field } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles } from "../../theme";
import { text } from "../../typography";
import type { TaxonomyOption } from "../../lib";
import { PickerField, TagsPicker } from "./pickers";
import type { MetadataForm } from "./shared";

/**
 * Editing moved off the Details list into a sheet (#114). Tapping a field row
 * opens it; the PATCH body and the create-a-correspondent flow are unchanged.
 */
export function EditFieldsSheet({
  visible,
  form,
  setForm,
  taxonomies,
  lockedFields,
  newCorrespondentName,
  setNewCorrespondentName,
  onCreateCorrespondent,
  createPending,
  createError,
  onSave,
  saving,
  saveError,
  disabled,
  onClose,
}: {
  visible: boolean;
  form: MetadataForm;
  setForm: React.Dispatch<React.SetStateAction<MetadataForm>>;
  taxonomies: {
    correspondents: TaxonomyOption[];
    documentTypes: TaxonomyOption[];
    tags: TaxonomyOption[];
  } | null;
  lockedFields: string[];
  newCorrespondentName: string;
  setNewCorrespondentName: (value: string) => void;
  onCreateCorrespondent: () => void;
  createPending: boolean;
  createError: string | null;
  onSave: () => void;
  saving: boolean;
  saveError: string | null;
  disabled: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.bar}>
          <Text style={styles.title}>{t("documentDetail.editTitle")}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.action}>{t("settings.cancel")}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Field
            label={t("documentDetail.overview.title")}
            value={form.title}
            onChangeText={(v) => setForm((s) => ({ ...s, title: v }))}
          />
          <Field
            label={t("documentDetail.overview.issueDate")}
            value={form.issueDate}
            onChangeText={(v) => setForm((s) => ({ ...s, issueDate: v }))}
            placeholder={t("documentDetail.overview.datePlaceholder")}
          />
          <Field
            label={t("documentDetail.overview.dueDate")}
            value={form.dueDate}
            onChangeText={(v) => setForm((s) => ({ ...s, dueDate: v }))}
            placeholder={t("documentDetail.overview.datePlaceholder")}
          />
          <Field
            label={t("documentDetail.overview.expiryDate")}
            value={form.expiryDate}
            onChangeText={(v) => setForm((s) => ({ ...s, expiryDate: v }))}
            placeholder={t("documentDetail.overview.datePlaceholder")}
          />
          <Field
            label={t("documentDetail.overview.amountField")}
            value={form.amount}
            onChangeText={(v) => setForm((s) => ({ ...s, amount: v }))}
            keyboardType="numeric"
          />
          <Field
            label={t("documentDetail.overview.currencyField")}
            value={form.currency}
            onChangeText={(v) => setForm((s) => ({ ...s, currency: v }))}
            autoCapitalize="characters"
            placeholder={t("documentDetail.overview.currencyPlaceholder")}
          />
          <Field
            label={t("documentDetail.overview.referenceNumber")}
            value={form.referenceNumber}
            onChangeText={(v) => setForm((s) => ({ ...s, referenceNumber: v }))}
          />
          <Field
            label={t("documentDetail.overview.holderName")}
            value={form.holderName}
            onChangeText={(v) => setForm((s) => ({ ...s, holderName: v }))}
          />
          <Field
            label={t("documentDetail.overview.issuingAuthority")}
            value={form.issuingAuthority}
            onChangeText={(v) => setForm((s) => ({ ...s, issuingAuthority: v }))}
          />

          {taxonomies ? (
            <>
              <PickerField
                label={t("documentDetail.overview.correspondent")}
                selectedId={form.correspondentId}
                options={taxonomies.correspondents.map((c) => ({ id: c.id, label: c.name }))}
                onSelect={(id) => setForm((s) => ({ ...s, correspondentId: id }))}
                placeholder={t("documentDetail.overview.selectCorrespondent")}
                createValue={newCorrespondentName}
                onCreateValueChange={setNewCorrespondentName}
                onCreateOption={onCreateCorrespondent}
                createPending={createPending}
                createError={createError}
              />
              <PickerField
                label={t("documentDetail.overview.documentType")}
                selectedId={form.documentTypeId}
                options={taxonomies.documentTypes.map((d) => ({ id: d.id, label: d.name }))}
                onSelect={(id) => setForm((s) => ({ ...s, documentTypeId: id }))}
                placeholder={t("documentDetail.overview.selectDocumentType")}
              />
              <TagsPicker
                label={t("documentDetail.overview.tags")}
                selectedIds={form.tagIds}
                options={taxonomies.tags.map((tag) => ({ id: tag.id, label: tag.name }))}
                onToggle={(id) =>
                  setForm((s) => ({
                    ...s,
                    tagIds: s.tagIds.includes(id)
                      ? s.tagIds.filter((item) => item !== id)
                      : [...s.tagIds, id],
                  }))
                }
              />
            </>
          ) : null}

          {saveError ? <Text style={styles.error}>{saveError}</Text> : null}

          {lockedFields.length > 0 ? (
            <Text style={styles.hint}>
              {lockedFields.length === 1
                ? `1 ${t("documentDetail.overview.lockedFields.one")}`
                : `${lockedFields.length} ${t("documentDetail.overview.lockedFields.other")}`}
            </Text>
          ) : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button
            label={t("documentDetail.overview.saveChanges")}
            onPress={onSave}
            loading={saving}
            disabled={disabled}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createThemedStyles((c) => ({
  root: {
    flex: 1,
    backgroundColor: c.app,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  title: {
    ...text.barTitle,
    flex: 1,
    color: c.ink,
  },
  action: {
    ...text.metaStrong,
    color: c.accent,
  },
  body: {
    padding: 16,
    gap: 14,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  error: {
    ...text.meta,
    color: c.red,
  },
  hint: {
    ...text.small,
    color: c.dim,
  },
}));
