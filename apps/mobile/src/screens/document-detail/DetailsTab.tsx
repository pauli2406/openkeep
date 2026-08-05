import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, type useQueryClient } from "@tanstack/react-query";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pill, SectionHeader } from "../../components/ui";
import { useI18n } from "../../i18n";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import {
  formatCurrency,
  formatDate,
  responseToMessage,
  sortTaxonomyOptions,
  taxonomyQueryKey,
  type ArchiveDocument,
  type TaxonomyOption,
} from "../../lib";
import { EditFieldsSheet } from "./EditFieldsSheet";
import {
  CONFIDENCE_THRESHOLD,
  fieldConfidence,
  formToState,
  isOverdue,
  isSameForm,
  type Translate,
} from "./shared";

type FieldRow = {
  name: string;
  /**
   * Where the extraction confidence lives, when it is not `name`. The edit sheet
   * keys taxonomy fields by id (`correspondentId`); the pipeline records what it
   * read off the page (`correspondentName`).
   */
  confidenceKey?: string;
  label: string;
  value: string;
  mono: boolean;
  /** Only set when the pipeline recorded a confidence and it is low. */
  confidence: number | null;
  tone: "ink" | "red";
};

function detailRows(document: ArchiveDocument, t: Translate): FieldRow[] {
  const overdue = isOverdue(document);
  const rows: Array<FieldRow | null> = [
    {
      name: "issueDate",
      label: t("documentDetail.overview.issueDate"),
      value: formatDate(document.issueDate),
      mono: true,
      confidence: null,
      tone: "ink",
    },
    {
      name: "dueDate",
      label: t("documentDetail.overview.dueDate"),
      value: formatDate(document.dueDate),
      mono: true,
      confidence: null,
      tone: overdue ? "red" : "ink",
    },
    document.expiryDate
      ? {
          name: "expiryDate",
          label: t("documentDetail.overview.expiryDate"),
          value: formatDate(document.expiryDate),
          mono: true,
          confidence: null,
          tone: "ink",
        }
      : null,
    {
      name: "amount",
      label: t("documentDetail.overview.amount"),
      value: formatCurrency(document.amount, document.currency ?? "EUR"),
      mono: true,
      confidence: null,
      tone: "ink",
    },
    document.referenceNumber
      ? {
          name: "referenceNumber",
          label: t("documentDetail.overview.reference"),
          value: document.referenceNumber,
          mono: true,
          confidence: null,
          tone: "ink",
        }
      : null,
    {
      name: "correspondentId",
      confidenceKey: "correspondentName",
      label: t("documentDetail.overview.correspondent"),
      value: document.correspondent?.name ?? "-",
      mono: false,
      confidence: null,
      tone: "ink",
    },
    {
      name: "documentTypeId",
      confidenceKey: "documentTypeName",
      label: t("documentDetail.overview.documentType"),
      value: document.documentType?.name ?? "-",
      mono: false,
      confidence: null,
      tone: "ink",
    },
    document.holderName
      ? {
          name: "holderName",
          label: t("documentDetail.overview.holder"),
          value: document.holderName,
          mono: false,
          confidence: null,
          tone: "ink",
        }
      : null,
    document.issuingAuthority
      ? {
          name: "issuingAuthority",
          label: t("documentDetail.overview.authority"),
          value: document.issuingAuthority,
          mono: false,
          confidence: null,
          tone: "ink",
        }
      : null,
  ];

  return rows.filter((row): row is FieldRow => row !== null).map((row) => {
    const recorded = fieldConfidence(document, row.confidenceKey ?? row.name);
    return {
      ...row,
      // The badge belongs to the field, and only when the value is uncertain.
      confidence: recorded !== null && recorded < CONFIDENCE_THRESHOLD ? recorded : null,
    };
  });
}

/**
 * One list, not two. These rows replace both the old `Übersicht` metadata card
 * and the `Analyse` recognition rows that repeated them with a percentage
 * appended — the percentage now sits on the row it describes. (#114)
 */
export function DetailsTab({
  document,
  documentId,
  apiUrl,
  authFetch,
  queryClient,
  taxonomies,
  offlineReadOnly,
}: {
  document: ArchiveDocument;
  documentId: string;
  apiUrl: string;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  queryClient: ReturnType<typeof useQueryClient>;
  taxonomies: {
    correspondents: TaxonomyOption[];
    documentTypes: TaxonomyOption[];
    tags: TaxonomyOption[];
  } | null;
  offlineReadOnly: boolean;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();

  const initialForm = useMemo(() => formToState(document), [document]);
  const [form, setForm] = useState(initialForm);
  const [editing, setEditing] = useState(false);
  const [newCorrespondentName, setNewCorrespondentName] = useState("");

  // Snapshot of the server state the form was last synced with, so unsaved
  // edits can be told apart from incoming server changes.
  const syncedFormRef = useRef(initialForm);
  useEffect(() => {
    if (isSameForm(form, initialForm)) {
      syncedFormRef.current = initialForm;
      return;
    }
    if (!isSameForm(form, syncedFormRef.current)) {
      return;
    }
    syncedFormRef.current = initialForm;
    setForm(initialForm);
  }, [form, initialForm]);

  const invalidateAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["document", documentId] }),
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      queryClient.invalidateQueries({ queryKey: ["review"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["document-facets"] }),
    ]);
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim() || undefined,
          issueDate: form.issueDate.trim() || null,
          dueDate: form.dueDate.trim() || null,
          expiryDate: form.expiryDate.trim() || null,
          amount: form.amount.trim() ? Number(form.amount) : null,
          currency: form.currency.trim() || null,
          referenceNumber: form.referenceNumber.trim() || null,
          holderName: form.holderName.trim() || null,
          issuingAuthority: form.issuingAuthority.trim() || null,
          correspondentId: form.correspondentId || null,
          documentTypeId: form.documentTypeId || null,
          tagIds: form.tagIds.length > 0 ? form.tagIds : undefined,
        }),
      });
      if (!response.ok) throw new Error(await responseToMessage(response));
    },
    onSuccess: async () => {
      await invalidateAll();
      setEditing(false);
    },
  });

  const createCorrespondentMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await authFetch("/api/taxonomies/correspondents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await responseToMessage(response));
      return (await response.json()) as TaxonomyOption;
    },
    onSuccess: async (correspondent) => {
      const correspondentsKey = taxonomyQueryKey(apiUrl, "correspondents");
      queryClient.setQueryData(correspondentsKey, (current: TaxonomyOption[] | undefined) =>
        current
          ? sortTaxonomyOptions([
              ...current.filter((item) => item.id !== correspondent.id),
              correspondent,
            ])
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: correspondentsKey });
      setForm((current) => ({ ...current, correspondentId: correspondent.id }));
      setNewCorrespondentName("");
    },
  });

  const rows = detailRows(document, t);
  const lockedFields = document.metadata?.manual?.lockedFields ?? [];
  const suggestedTags = (document.metadata?.intelligence?.tagging?.tags ?? []).filter(
    (tag) => !document.tags.some((existing) => existing.name === tag),
  );

  const fileRows: Array<{ label: string; value: string }> = [
    { label: t("documentDetail.file.type"), value: document.mimeType },
    ...(document.metadata?.pageCount != null
      ? [{ label: t("documentDetail.file.pages"), value: String(document.metadata.pageCount) }]
      : []),
    { label: t("documentDetail.file.imported"), value: formatDate(document.createdAt) },
    ...(document.processedAt
      ? [{ label: t("documentDetail.file.processed"), value: formatDate(document.processedAt) }]
      : []),
    ...(document.parseProvider
      ? [{ label: t("documentDetail.file.parser"), value: document.parseProvider }]
      : []),
    {
      label: t("documentDetail.file.searchable"),
      value: document.searchablePdfAvailable ? t("documentDetail.yes") : t("documentDetail.no"),
    },
  ];

  return (
    <>
      {rows.map((row) => (
        <Pressable
          key={row.name}
          onPress={offlineReadOnly ? undefined : () => setEditing(true)}
          style={({ pressed }) => [styles.fieldRow, pressed ? styles.fieldRowPressed : null]}
        >
          <Text style={styles.fieldLabel} numberOfLines={1}>
            {row.label}
            {lockedFields.includes(row.name as never) ? " 🔒" : ""}
          </Text>
          <Text
            style={[
              styles.fieldValue,
              row.mono ? styles.fieldValueMono : null,
              row.tone === "red" ? styles.fieldValueRed : null,
            ]}
            numberOfLines={1}
          >
            {row.value}
          </Text>
          {row.confidence !== null ? (
            <View style={styles.confidenceBadge}>
              <Text style={styles.confidenceText}>{`${Math.round(row.confidence * 100)}%`}</Text>
            </View>
          ) : null}
          {offlineReadOnly ? null : (
            <MaterialCommunityIcons name="chevron-right" size={15} color={colors.faint} />
          )}
        </Pressable>
      ))}

      {/* Tags: current, then what the pipeline suggested */}
      <View style={styles.tagBlock}>
        <Text style={styles.blockLabel}>{t("documentDetail.tagsCurrent")}</Text>
        <View style={styles.tagRow}>
          {document.tags.map((tag) => (
            <Pill key={tag.id} label={tag.name} tone="soft" />
          ))}
          {offlineReadOnly ? null : (
            <Pressable onPress={() => setEditing(true)}>
              <Pill label={`+ ${t("documentDetail.addTag")}`} tone="outline" />
            </Pressable>
          )}
        </View>
        {suggestedTags.length > 0 ? (
          <>
            <Text style={styles.blockSubLabel}>{t("documentDetail.tagsSuggested")}</Text>
            <View style={styles.tagRow}>
              {suggestedTags.map((tag) => (
                <Pill key={tag} label={`+ ${tag}`} tone="outline" />
              ))}
            </View>
          </>
        ) : null}
      </View>

      {/* The technical facts, which used to sit under the preview */}
      <SectionHeader label={t("documentDetail.file")} />
      {fileRows.map((row) => (
        <View key={row.label} style={styles.fileRow}>
          <Text style={styles.fieldLabel} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={[styles.fieldValue, styles.fieldValueMono]} numberOfLines={1}>
            {row.value}
          </Text>
        </View>
      ))}

      <EditFieldsSheet
        visible={editing}
        form={form}
        setForm={setForm}
        taxonomies={taxonomies}
        lockedFields={lockedFields}
        newCorrespondentName={newCorrespondentName}
        setNewCorrespondentName={setNewCorrespondentName}
        onCreateCorrespondent={() =>
          createCorrespondentMutation.mutate(newCorrespondentName.trim())
        }
        createPending={createCorrespondentMutation.isPending}
        createError={
          createCorrespondentMutation.isError
            ? createCorrespondentMutation.error instanceof Error
              ? createCorrespondentMutation.error.message
              : t("documentDetail.overview.createCorrespondentFailed")
            : null
        }
        onSave={() => updateMutation.mutate()}
        saving={updateMutation.isPending}
        saveError={
          updateMutation.isError
            ? updateMutation.error instanceof Error
              ? updateMutation.error.message
              : t("documentDetail.overview.saveFailed")
            : null
        }
        disabled={offlineReadOnly}
        onClose={() => {
          // Cancelling drops the edits. Keeping them would silently include them
          // in whatever the next save sends.
          syncedFormRef.current = initialForm;
          setForm(initialForm);
          setNewCorrespondentName("");
          setEditing(false);
        }}
      />
    </>
  );
}

const useStyles = createThemedStyles((c) => ({
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  fieldRowPressed: {
    backgroundColor: c.raised,
  },
  fileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  fieldLabel: {
    ...text.meta,
    width: 98,
    flexShrink: 0,
    color: c.dim,
  },
  fieldValue: {
    ...text.rowTitle,
    flex: 1,
    color: c.ink,
    textAlign: "right",
  },
  fieldValueMono: {
    ...text.amount,
    fontSize: 13.5,
    lineHeight: 19,
    textAlign: "right",
  },
  fieldValueRed: {
    color: c.red,
  },
  confidenceBadge: {
    flexShrink: 0,
    borderRadius: radii.sm,
    backgroundColor: c.amberSoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  confidenceText: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
    color: c.amber,
  },
  tagBlock: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  blockLabel: {
    ...text.meta,
    color: c.dim,
  },
  blockSubLabel: {
    ...text.small,
    marginTop: 3,
    color: c.faint,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
}));
