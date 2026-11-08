import { useRef, useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { IconTile } from "../../components/layout";
import { Button } from "../../components/ui";
import { useI18n } from "../../i18n";
import { reviewReasonLabel } from "../../review-reasons";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import {
  formatCurrency,
  formatDate,
  type ArchiveDocument,
  type ManualOverrideField,
  type TaxonomyOption,
} from "../../lib";
import { OptionSheet } from "./OptionSheet";
import {
  ConfidenceMeter,
  Disclosure,
  DocumentStatusPill,
  IconButton,
  InlineError,
  InspectorCard,
  MetaRows,
  RawJson,
} from "./parts";
import {
  embeddingLabel,
  fieldConfidenceMap,
  formatTimestamp,
  isOverdue,
  parseAmount,
  parseProviderLabel,
  type EditableField,
  type MetadataForm,
} from "./shared";

export type Taxonomies = {
  correspondents: TaxonomyOption[];
  documentTypes: TaxonomyOption[];
  tags: TaxonomyOption[];
};

type EditorProps = Pick<TextInputProps, "autoFocus" | "onFocus" | "onBlur" | "onSubmitEditing">;

/**
 * One label-left, value-right row. Tap to edit in place; a changed value goes
 * amber until it is saved. A row without `children` hands the tap to `onPress`,
 * which is how the taxonomy rows open their sheets.
 */
function FieldRow({
  label,
  display,
  dirty,
  numeric = false,
  tone,
  locked = false,
  confidence,
  readOnly,
  onUnlock,
  unlockDisabled,
  onPress,
  onReveal,
  children,
}: {
  label: string;
  display: string;
  dirty: boolean;
  numeric?: boolean;
  tone?: "red";
  locked?: boolean;
  confidence?: number | null;
  readOnly: boolean;
  onUnlock?: () => void;
  unlockDisabled?: boolean;
  onPress?: () => void;
  onReveal?: (node: View | null) => void;
  children?: (editor: EditorProps) => ReactNode;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const rowRef = useRef<View>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The amount row holds two inputs, and moving between them blurs one before the
  // other takes focus. Waiting a beat keeps that from closing the row mid-edit.
  const editor: EditorProps = {
    autoFocus: true,
    onFocus: () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      onReveal?.(rowRef.current);
    },
    onBlur: () => {
      closeTimer.current = setTimeout(() => setEditing(false), 120);
    },
    onSubmitEditing: () => setEditing(false),
  };

  const interactive = !readOnly && Boolean(children || onPress);

  return (
    <View
      ref={rowRef}
      style={[
        styles.row,
        editing ? styles.rowEditing : null,
        dirty ? styles.rowDirty : null,
      ]}
    >
      <Text style={[styles.rowLabel, editing ? styles.rowLabelEditing : null]}>{label}</Text>
      {editing && children ? (
        <View style={styles.rowEditor}>{children(editor)}</View>
      ) : (
        <Pressable
          accessibilityRole={interactive ? "button" : "text"}
          accessibilityLabel={`${label}: ${display}`}
          disabled={!interactive}
          onPress={() => (children ? setEditing(true) : onPress?.())}
          style={({ pressed }) => [styles.rowValue, pressed ? styles.rowValuePressed : null]}
        >
          <Text
            numberOfLines={1}
            style={[
              numeric ? styles.valueNumeric : styles.value,
              display === "—" ? styles.valueEmpty : null,
              tone === "red" ? styles.valueRed : null,
              dirty ? styles.valueDirty : null,
            ]}
          >
            {display}
          </Text>
        </Pressable>
      )}
      {confidence != null && !locked && !dirty && !editing ? (
        <ConfidenceMeter value={confidence} />
      ) : null}
      {locked ? (
        onUnlock ? (
          <IconButton
            icon="lock-outline"
            label={`${t("documentDetail.unlock")} ${label}`}
            onPress={onUnlock}
            disabled={unlockDisabled}
            tone="amber"
            size={28}
          />
        ) : (
          <MaterialCommunityIcons name="lock-outline" size={16} color={colors.amber} />
        )
      ) : null}
    </View>
  );
}

/** The input a row turns into. */
function EditorInput(props: TextInputProps & { numeric?: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { numeric, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.dim}
      returnKeyType="done"
      {...rest}
      style={[styles.input, numeric ? styles.inputNumeric : null, style]}
    />
  );
}

/**
 * The first tab, and the reason most people open a document: what the pipeline
 * read, how sure it is, and in place to fix what it got wrong. The route owns the
 * form; this renders and edits it, and the save bar is pinned by the route.
 */
export function FieldsTab({
  document,
  form,
  onFormChange,
  taxonomies,
  taxonomiesLoading,
  taxonomiesError,
  onRetryTaxonomies,
  lockedFields,
  onUnlock,
  unlockPending,
  onCreateTag,
  createTagPending,
  onCreateCorrespondent,
  createCorrespondentPending,
  dirty,
  actionError,
  readOnly,
  onReveal,
}: {
  document: ArchiveDocument;
  form: MetadataForm;
  onFormChange: (patch: Partial<MetadataForm>) => void;
  taxonomies: Taxonomies | null;
  taxonomiesLoading: boolean;
  taxonomiesError: string | null;
  onRetryTaxonomies: () => void;
  lockedFields: ManualOverrideField[];
  onUnlock: (fields: ManualOverrideField[]) => void;
  unlockPending: boolean;
  onCreateTag: (name: string) => void;
  createTagPending: boolean;
  onCreateCorrespondent: (name: string) => void;
  createCorrespondentPending: boolean;
  dirty: EditableField[];
  actionError: string | null;
  readOnly: boolean;
  onReveal: (node: View | null) => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(() =>
    Boolean(document.expiryDate || document.holderName || document.issuingAuthority),
  );
  const [picker, setPicker] = useState<"correspondent" | "type" | null>(null);
  const [tagQuery, setTagQuery] = useState("");
  const tagBlockRef = useRef<View>(null);

  const confidence = fieldConfidenceMap(document);
  const isDirty = (...fields: EditableField[]) => fields.some((field) => dirty.includes(field));

  /** A row may own more than one lockable field: amount carries currency. */
  const lockProps = (...fields: ManualOverrideField[]) => {
    const locked = fields.filter((field) => lockedFields.includes(field));
    return {
      locked: locked.length > 0,
      onUnlock: readOnly ? undefined : () => onUnlock(locked),
      unlockDisabled: unlockPending,
    };
  };
  const rowProps = { readOnly, onReveal };

  // Offline the taxonomies are not loaded, so a name comes from the document.
  const correspondents: TaxonomyOption[] =
    taxonomies?.correspondents ?? (document.correspondent ? [document.correspondent] : []);
  const documentTypes: TaxonomyOption[] =
    taxonomies?.documentTypes ?? (document.documentType ? [document.documentType] : []);
  const allTags: TaxonomyOption[] = [
    ...(taxonomies?.tags ?? []),
    ...document.tags.filter((tag) => !taxonomies?.tags.some((known) => known.id === tag.id)),
  ];
  const nameOf = (options: TaxonomyOption[], id: string) =>
    (id ? options.find((option) => option.id === id)?.name : null) ?? "—";

  const selectedTags = allTags.filter((tag) => form.tagIds.includes(tag.id));
  const tagFilter = tagQuery.trim().toLowerCase();
  const tagMatches = tagFilter
    ? allTags
        .filter((tag) => !form.tagIds.includes(tag.id) && tag.name.toLowerCase().includes(tagFilter))
        .slice(0, 6)
    : [];
  const exactTag = allTags.find((tag) => tag.name.trim().toLowerCase() === tagFilter);
  const suggestedTags = (document.metadata?.intelligence?.tagging?.tags ?? []).filter(
    (name) => !selectedTags.some((tag) => tag.name.toLowerCase() === name.toLowerCase()),
  );

  const addTag = (id: string) => {
    onFormChange({ tagIds: form.tagIds.includes(id) ? form.tagIds : [...form.tagIds, id] });
    setTagQuery("");
  };
  /** A pipeline suggestion may name a tag that exists, or one that does not yet. */
  const addTagByName = (name: string) => {
    const known = allTags.find((tag) => tag.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (known) {
      addTag(known.id);
      return;
    }
    onCreateTag(name.trim());
    setTagQuery("");
  };

  const parsedAmount = parseAmount(form.amount);
  const amountDisplay =
    parsedAmount === null
      ? "—"
      : parsedAmount === "invalid"
        ? form.amount
        : formatCurrency(parsedAmount, form.currency.trim() || "EUR");

  const dateDisplay = (value: string) => (value.trim() ? formatDate(value.trim()) : "—");

  const reasons = document.reviewReasons.map((reason) => reviewReasonLabel(reason, t)).join(" · ");
  const reviewPercent =
    document.confidence != null ? `${Math.round(document.confidence * 100)}%` : null;

  const email = document.metadata?.email;
  const emailMeta = email
    ? [
        email.from ?? "?",
        email.receivedAt ? formatTimestamp(email.receivedAt) : null,
        email.subject,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <View style={styles.tab}>
      {document.reviewStatus === "pending" ? (
        <View style={styles.callout}>
          <MaterialCommunityIcons name="alert-outline" size={18} color={colors.amber} />
          <View style={styles.calloutText}>
            <Text style={styles.calloutTitle}>{t("documentDetail.whyReview")}</Text>
            <Text style={styles.calloutBody}>
              {[reasons || t("documentDetail.needsReview"), reviewPercent]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            {document.reviewNote ? (
              <Text style={styles.calloutNote}>{document.reviewNote}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <View style={styles.fields}>
        {lockedFields.length > 0 ? (
          <View style={styles.lockSummary}>
            <MaterialCommunityIcons name="lock-outline" size={13} color={colors.amber} />
            <Text style={styles.lockSummaryText}>
              {`${lockedFields.length} ${
                lockedFields.length === 1
                  ? t("documentDetail.fieldLocked")
                  : t("documentDetail.fieldsLocked")
              }`}
            </Text>
          </View>
        ) : null}

        <FieldRow
          {...rowProps}
          label={t("documentDetail.title")}
          display={form.title || "—"}
          dirty={isDirty("title")}
          confidence={confidence.title}
        >
          {(editor) => (
            <EditorInput
              {...editor}
              value={form.title}
              onChangeText={(title) => onFormChange({ title })}
              accessibilityLabel={t("documentDetail.title")}
            />
          )}
        </FieldRow>

        <FieldRow
          {...rowProps}
          {...lockProps("correspondentId")}
          label={t("documentDetail.correspondent")}
          display={nameOf(correspondents, form.correspondentId)}
          dirty={isDirty("correspondentId")}
          confidence={confidence.correspondentId}
          onPress={() => setPicker("correspondent")}
        />

        <FieldRow
          {...rowProps}
          {...lockProps("documentTypeId")}
          label={t("documentDetail.documentType")}
          display={nameOf(documentTypes, form.documentTypeId)}
          dirty={isDirty("documentTypeId")}
          confidence={confidence.documentTypeId}
          onPress={() => setPicker("type")}
        />

        <FieldRow
          {...rowProps}
          {...lockProps("issueDate")}
          label={t("documentDetail.issueDate")}
          display={dateDisplay(form.issueDate)}
          dirty={isDirty("issueDate")}
          numeric
          confidence={confidence.issueDate}
        >
          {(editor) => (
            <EditorInput
              {...editor}
              numeric
              value={form.issueDate}
              onChangeText={(issueDate) => onFormChange({ issueDate })}
              placeholder={t("documentDetail.overview.datePlaceholder")}
              keyboardType="numbers-and-punctuation"
              accessibilityLabel={t("documentDetail.issueDate")}
            />
          )}
        </FieldRow>

        <FieldRow
          {...rowProps}
          {...lockProps("dueDate")}
          label={t("documentDetail.deadline")}
          display={dateDisplay(form.dueDate)}
          dirty={isDirty("dueDate")}
          numeric
          tone={isOverdue(document) ? "red" : undefined}
          confidence={confidence.dueDate}
        >
          {(editor) => (
            <EditorInput
              {...editor}
              numeric
              value={form.dueDate}
              onChangeText={(dueDate) => onFormChange({ dueDate })}
              placeholder={t("documentDetail.overview.datePlaceholder")}
              keyboardType="numbers-and-punctuation"
              accessibilityLabel={t("documentDetail.deadline")}
            />
          )}
        </FieldRow>

        <FieldRow
          {...rowProps}
          {...lockProps("amount", "currency")}
          label={t("documentDetail.amount")}
          display={amountDisplay}
          dirty={isDirty("amount", "currency")}
          numeric
          confidence={confidence.amount}
        >
          {(editor) => (
            <View style={styles.amountEditor}>
              <EditorInput
                {...editor}
                numeric
                value={form.amount}
                onChangeText={(amount) => onFormChange({ amount })}
                keyboardType="decimal-pad"
                accessibilityLabel={t("documentDetail.amount")}
                style={styles.amountInput}
              />
              <EditorInput
                {...editor}
                autoFocus={false}
                numeric
                value={form.currency}
                onChangeText={(currency) => onFormChange({ currency: currency.toUpperCase() })}
                placeholder={t("documentDetail.overview.currencyPlaceholder")}
                autoCapitalize="characters"
                maxLength={3}
                accessibilityLabel={t("documentDetail.currency")}
                style={styles.currencyInput}
              />
            </View>
          )}
        </FieldRow>

        <FieldRow
          {...rowProps}
          {...lockProps("referenceNumber")}
          label={t("documentDetail.reference")}
          display={form.referenceNumber || "—"}
          dirty={isDirty("referenceNumber")}
          numeric
          confidence={confidence.referenceNumber}
        >
          {(editor) => (
            <EditorInput
              {...editor}
              numeric
              value={form.referenceNumber}
              onChangeText={(referenceNumber) => onFormChange({ referenceNumber })}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={t("documentDetail.reference")}
            />
          )}
        </FieldRow>

        {/* Tags */}
        <View ref={tagBlockRef} style={[styles.tags, isDirty("tagIds") ? styles.rowDirty : null]}>
          <View style={styles.tagsHead}>
            <Text style={styles.tagsLabel}>{t("documentDetail.tags")}</Text>
            {confidence.tagIds != null && !lockedFields.includes("tagIds") && !isDirty("tagIds") ? (
              <ConfidenceMeter value={confidence.tagIds} />
            ) : null}
            {lockedFields.includes("tagIds") ? (
              readOnly ? (
                <MaterialCommunityIcons name="lock-outline" size={16} color={colors.amber} />
              ) : (
                <IconButton
                  icon="lock-outline"
                  label={`${t("documentDetail.unlock")} ${t("documentDetail.tags")}`}
                  onPress={() => onUnlock(["tagIds"])}
                  disabled={unlockPending}
                  tone="amber"
                  size={28}
                />
              )
            ) : null}
          </View>
          <View style={styles.tagList}>
            {selectedTags.map((tag) => (
              <View key={tag.id} style={styles.tagChip}>
                <Text style={styles.tagChipText} numberOfLines={1}>
                  {tag.name}
                </Text>
                {readOnly ? null : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${t("documentDetail.removeTag")} ${tag.name}`}
                    hitSlop={12}
                    onPress={() =>
                      onFormChange({ tagIds: form.tagIds.filter((id) => id !== tag.id) })
                    }
                  >
                    <MaterialCommunityIcons name="close" size={13} color={colors.muted} />
                  </Pressable>
                )}
              </View>
            ))}
            {readOnly ? (
              selectedTags.length === 0 ? <Text style={styles.valueEmpty}>—</Text> : null
            ) : (
              <TextInput
                value={tagQuery}
                onChangeText={setTagQuery}
                onFocus={() => onReveal(tagBlockRef.current)}
                onSubmitEditing={() => {
                  if (tagQuery.trim()) addTagByName(tagQuery);
                }}
                placeholder={t("documentDetail.addTagPlaceholder")}
                placeholderTextColor={colors.dim}
                accessibilityLabel={t("documentDetail.addTagPlaceholder")}
                returnKeyType="done"
                autoCorrect={false}
                style={styles.tagInput}
              />
            )}
          </View>
          {tagFilter ? (
            <View style={styles.tagList}>
              {tagMatches.map((tag) => (
                <Pressable
                  key={tag.id}
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => addTag(tag.id)}
                  style={styles.tagOption}
                >
                  <Text style={styles.tagOptionText} numberOfLines={1}>
                    {tag.name}
                  </Text>
                </Pressable>
              ))}
              {!exactTag ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  disabled={createTagPending}
                  onPress={() => addTagByName(tagQuery)}
                  style={[styles.tagOption, styles.tagOptionNew]}
                >
                  <MaterialCommunityIcons name="plus" size={13} color={colors.accent} />
                  <Text style={styles.tagOptionNewText} numberOfLines={1}>
                    {tagQuery.trim()}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {!readOnly && suggestedTags.length > 0 ? (
            <View style={styles.suggested}>
              <Text style={styles.suggestedLabel}>{t("documentDetail.tagsSuggested")}</Text>
              <View style={styles.tagList}>
                {suggestedTags.map((name) => (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    hitSlop={8}
                    disabled={createTagPending}
                    onPress={() => addTagByName(name)}
                    style={[styles.tagOption, styles.tagOptionNew]}
                  >
                    <MaterialCommunityIcons name="plus" size={13} color={colors.accent} />
                    <Text style={styles.tagOptionNewText} numberOfLines={1}>
                      {name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {/* Rarely-used fields stay out of the way until a document has them. */}
        <Disclosure
          label={t("documentDetail.moreFields")}
          open={moreOpen}
          onToggle={() => setMoreOpen((current) => !current)}
        />
        {moreOpen ? (
          <>
            <FieldRow
              {...rowProps}
              {...lockProps("expiryDate")}
              label={t("documentDetail.expiryDate")}
              display={dateDisplay(form.expiryDate)}
              dirty={isDirty("expiryDate")}
              numeric
              confidence={confidence.expiryDate}
            >
              {(editor) => (
                <EditorInput
                  {...editor}
                  numeric
                  value={form.expiryDate}
                  onChangeText={(expiryDate) => onFormChange({ expiryDate })}
                  placeholder={t("documentDetail.overview.datePlaceholder")}
                  keyboardType="numbers-and-punctuation"
                  accessibilityLabel={t("documentDetail.expiryDate")}
                />
              )}
            </FieldRow>
            <FieldRow
              {...rowProps}
              {...lockProps("holderName")}
              label={t("documentDetail.holderName")}
              display={form.holderName || "—"}
              dirty={isDirty("holderName")}
              confidence={confidence.holderName}
            >
              {(editor) => (
                <EditorInput
                  {...editor}
                  value={form.holderName}
                  onChangeText={(holderName) => onFormChange({ holderName })}
                  accessibilityLabel={t("documentDetail.holderName")}
                />
              )}
            </FieldRow>
            <FieldRow
              {...rowProps}
              {...lockProps("issuingAuthority")}
              label={t("documentDetail.issuingAuthority")}
              display={form.issuingAuthority || "—"}
              dirty={isDirty("issuingAuthority")}
              confidence={confidence.issuingAuthority}
            >
              {(editor) => (
                <EditorInput
                  {...editor}
                  value={form.issuingAuthority}
                  onChangeText={(issuingAuthority) => onFormChange({ issuingAuthority })}
                  accessibilityLabel={t("documentDetail.issuingAuthority")}
                />
              )}
            </FieldRow>
          </>
        ) : null}

        {actionError ? <InlineError message={actionError} /> : null}
      </View>

      <InspectorCard
        tinted
        title={t("documentDetail.processing")}
        aside={<DocumentStatusPill document={document} />}
      >
        {document.lastProcessingError ? (
          <InlineError message={document.lastProcessingError} />
        ) : null}
        <MetaRows
          rows={[
            [t("documentDetail.parseProvider"), parseProviderLabel(document.parseProvider)],
            [t("documentDetail.embedding"), embeddingLabel(document) || "—"],
            [t("documentDetail.pages"), String(document.metadata?.pageCount ?? "—")],
            [t("documentDetail.chunks"), String(document.chunkCount ?? "—")],
            [
              t("documentDetail.confidence"),
              document.confidence != null ? (
                <ConfidenceMeter value={document.confidence} showValue />
              ) : (
                "—"
              ),
            ],
            [t("documentDetail.file.type"), document.mimeType],
            [t("documentDetail.file.imported"), formatDate(document.createdAt)],
            ...(document.processedAt
              ? ([[t("documentDetail.file.processed"), formatDate(document.processedAt)]] as Array<
                  [string, string]
                >)
              : []),
          ]}
        />
      </InspectorCard>

      {email ? (
        <View style={styles.email}>
          <IconTile size="sm">
            <MaterialCommunityIcons name="email-outline" size={15} color={colors.accentSoftInk} />
          </IconTile>
          <View style={styles.emailText}>
            <Text style={styles.emailTitle}>{t("documentDetail.arrivedByEmail")}</Text>
            <Text style={styles.emailMeta}>{emailMeta}</Text>
          </View>
        </View>
      ) : null}

      <RawJson label={t("documentDetail.rawMetadata")} value={document} />

      <OptionSheet
        visible={picker === "correspondent"}
        title={t("documentDetail.correspondent")}
        options={correspondents.map((entry) => ({ id: entry.id, label: entry.name }))}
        selectedId={form.correspondentId}
        loading={taxonomiesLoading}
        error={taxonomiesError}
        onRetry={onRetryTaxonomies}
        searchPlaceholder={t("documentDetail.searchCorrespondent")}
        onSelect={(correspondentId) => onFormChange({ correspondentId })}
        onCreate={onCreateCorrespondent}
        createPending={createCorrespondentPending}
        onClose={() => setPicker(null)}
      />
      <OptionSheet
        visible={picker === "type"}
        title={t("documentDetail.documentType")}
        options={documentTypes.map((entry) => ({ id: entry.id, label: entry.name }))}
        selectedId={form.documentTypeId}
        loading={taxonomiesLoading}
        error={taxonomiesError}
        onRetry={onRetryTaxonomies}
        onSelect={(documentTypeId) => onFormChange({ documentTypeId })}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

/** One save bar under the inspector, in sight wherever the form has scrolled to. */
export function SaveBar({
  note,
  error,
  saving,
  disabled,
  onSave,
  onDiscard,
}: {
  note: string | null;
  error: string | null;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View style={styles.saveBar}>
      {note ? <Text style={styles.saveNote}>{note}</Text> : null}
      {error ? <Text style={styles.saveError}>{error}</Text> : null}
      <View style={styles.saveActions}>
        <Button
          label={t("documentDetail.save")}
          size="sm"
          loading={saving}
          disabled={disabled}
          onPress={onSave}
        />
        <Button
          label={t("documentDetail.discard")}
          variant="ghost"
          size="sm"
          disabled={saving || disabled}
          onPress={onDiscard}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  tab: {
    gap: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  callout: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderColor: c.amber,
    borderRadius: radii.lg,
    backgroundColor: c.amberSoft,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  calloutText: {
    flex: 1,
    gap: 2,
  },
  calloutTitle: {
    ...text.bodyStrong,
    color: c.amber,
  },
  calloutBody: {
    ...text.body,
    color: c.amber,
  },
  calloutNote: {
    ...text.meta,
    marginTop: 2,
    color: c.amber,
  },
  fields: {
    gap: 2,
  },
  lockSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingBottom: 6,
  },
  lockSummaryText: {
    ...text.meta,
    color: c.amber,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    marginHorizontal: -8,
    borderRadius: radii.md,
    paddingHorizontal: 8,
  },
  rowEditing: {
    alignItems: "flex-start",
    paddingVertical: 4,
  },
  rowDirty: {
    backgroundColor: c.amberSoft,
  },
  rowLabel: {
    ...text.metaStrong,
    width: 104,
    flexShrink: 0,
    color: c.muted,
  },
  rowLabelEditing: {
    paddingTop: 10,
  },
  rowEditor: {
    flex: 1,
    minWidth: 0,
  },
  rowValue: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: "center",
  },
  rowValuePressed: {
    opacity: 0.6,
  },
  value: {
    ...text.bodyStrong,
    color: c.ink,
  },
  valueNumeric: {
    ...text.amount,
    color: c.ink,
  },
  valueEmpty: {
    ...text.body,
    color: c.muted,
  },
  valueRed: {
    color: c.red,
  },
  valueDirty: {
    color: c.amber,
  },
  input: {
    ...text.body,
    height: 36,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: radii.md,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 10,
  },
  inputNumeric: {
    fontVariant: ["tabular-nums"],
  },
  amountEditor: {
    flexDirection: "row",
    gap: 6,
  },
  amountInput: {
    flex: 1,
    minWidth: 0,
  },
  currencyInput: {
    width: 64,
  },
  tags: {
    gap: 8,
    marginHorizontal: -8,
    borderRadius: radii.md,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  tagsHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 24,
  },
  tagsLabel: {
    ...text.metaStrong,
    flex: 1,
    color: c.muted,
  },
  tagList: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    maxWidth: "100%",
    borderRadius: radii.pill,
    backgroundColor: c.raised,
    paddingHorizontal: 10,
  },
  tagChipText: {
    ...text.metaStrong,
    flexShrink: 1,
    color: c.ink,
  },
  tagInput: {
    ...text.meta,
    flexGrow: 1,
    flexBasis: 120,
    height: 32,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.pill,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 12,
  },
  tagOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 28,
    maxWidth: "100%",
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
  },
  tagOptionText: {
    ...text.meta,
    color: c.ink,
  },
  tagOptionNew: {
    borderStyle: "dashed",
    borderColor: c.accent,
  },
  tagOptionNewText: {
    ...text.meta,
    flexShrink: 1,
    color: c.accent,
  },
  suggested: {
    gap: 6,
    paddingTop: 2,
  },
  suggestedLabel: {
    ...text.meta,
    color: c.muted,
  },
  email: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.xl,
    padding: 14,
  },
  emailText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  emailTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  emailMeta: {
    ...text.meta,
    color: c.muted,
  },
  saveBar: {
    gap: 8,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.panel,
  },
  saveNote: {
    ...text.meta,
    color: c.amber,
  },
  saveError: {
    ...text.meta,
    color: c.red,
  },
  saveActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
}));
