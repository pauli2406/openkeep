import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BULK_THRESHOLDS,
  buildReviewPatch,
  collectAllPages,
  confidenceTone,
  countReasons,
  DEFAULT_BULK_THRESHOLD,
  fetchReviewQueue,
  fieldAttention,
  fieldKind,
  fieldsToConfirm,
  filterByReason,
  neighbourOf,
  oldestDays,
  patchDocument,
  queuePosition,
  requeueReview,
  resolveReview,
  seedForm,
  type ReviewFieldKey,
  type ReviewForm,
} from "../api/review";
import { useAuth } from "../auth";
import { DocumentViewer } from "../components/DocumentViewer";
import { BottomSheet, Chip, Gradient, IconTile, Skeleton } from "../components/layout";
import { findPassage, firstLines, PassagePaper, type Passage } from "../components/Passage";
import {
  Button,
  EmptyState,
  ErrorCard,
  FullScreenModal,
  Notice,
  Panel,
  Pill,
  Screen,
} from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import { useI18n, type TranslationKey } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import { offlineCacheScope } from "../offline-scope";
import { createReviewOutbox } from "../review-outbox";
import {
  isBulkEligible,
  isConfidenceOnlyReason,
  reviewReasonLabel,
  reviewReasonWhy,
} from "../review-reasons";
import type { AppStackParamList } from "../../App";
import { cardShadow, createThemedStyles, radii, raisedShadow, useColors } from "../theme";
import { text } from "../typography";
import {
  fetchTaxonomy,
  formatCurrency,
  formatDate,
  responseToMessage,
  sortTaxonomyOptions,
  taxonomyQueryKey,
  titleForDocument,
  type ArchiveDocument,
  type DocumentTextResponse,
} from "../lib";

/** Long enough to notice a mis-tap, short enough not to linger. */
const UNDO_WINDOW_MS = 5_000;

const FIELD_LABELS: Record<ReviewFieldKey, TranslationKey> = {
  correspondentId: "review.form.correspondent",
  documentTypeId: "review.form.documentType",
  issueDate: "review.form.issueDate",
  dueDate: "review.form.dueDate",
  amount: "review.form.amount",
  referenceNumber: "review.form.referenceNumber",
  expiryDate: "review.field.expiryDate",
  holderName: "review.field.holderName",
  issuingAuthority: "review.field.issuingAuthority",
};

/** The value as stored, before display formatting: what the OCR text is searched for. */
function storedFieldValue(document: ArchiveDocument, key: ReviewFieldKey): string | null {
  switch (key) {
    case "correspondentId":
      return document.correspondent?.name ?? null;
    case "documentTypeId":
      return document.documentType?.name ?? null;
    case "amount":
      return document.amount === null || document.amount === undefined
        ? null
        : String(document.amount);
    default:
      return document[key] ?? null;
  }
}

function displayFieldValue(document: ArchiveDocument, key: ReviewFieldKey): string | null {
  const stored = storedFieldValue(document, key);
  if (stored === null) {
    return null;
  }
  switch (fieldKind(key)) {
    case "date":
      return formatDate(stored);
    case "amount":
      return formatCurrency(document.amount ?? 0, document.currency ?? "EUR");
    default:
      return stored;
  }
}

type ActiveField = {
  key: ReviewFieldKey;
  label: string;
  value: string | null;
  raw: string | null;
  attention: "missing" | "low" | null;
};

// ---------------------------------------------------------------------------
// The full-page reader
// ---------------------------------------------------------------------------

function Reader({
  document,
  passage,
  field,
  pageCount,
  authFetch,
  offlineMode,
  localFileUri,
  onClose,
}: {
  document: ArchiveDocument;
  passage: Passage | null;
  field: ActiveField | null;
  pageCount: number;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  offlineMode: boolean;
  /** `DocumentViewer` can only render offline from a file it already has. */
  localFileUri: string | null;
  onClose: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const scrollRef = useRef<ScrollView>(null);

  return (
    <FullScreenModal onRequestClose={onClose} style={styles.readerRoot}>
        <View style={styles.readerBar}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            hitSlop={10}
            style={styles.readerBack}
          >
            <MaterialCommunityIcons name="chevron-left" size={18} color={colors.accent} />
            <Text style={styles.readerBackText}>{t("review.fields")}</Text>
          </Pressable>
          <Text style={styles.readerPages}>{`${pageCount} ${t("review.pages")}`}</Text>
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={styles.readerBody}>
          {passage ? (
            <PassagePaper passage={passage} />
          ) : (
            <Text style={styles.readerHint}>{t("review.passageNotFound")}</Text>
          )}

          <DocumentViewer
            authFetch={authFetch}
            documentId={document.id}
            mimeType={document.mimeType}
            searchablePdfAvailable={document.searchablePdfAvailable}
            localFileUri={localFileUri}
            hasLocalFile={Boolean(localFileUri)}
            offlineMode={offlineMode}
            canFetchOnline={!offlineMode}
          />
        </ScrollView>

        <View style={styles.readerFooter}>
          <Pressable
            accessibilityRole="button"
            onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })}
            style={styles.citationButton}
          >
            <MaterialCommunityIcons name="crosshairs" size={13} color={colors.amber} />
            <Text style={styles.citationText}>{t("review.toCitation")}</Text>
          </Pressable>
          {passage ? (
            <Text style={styles.readerPageNumber}>
              {`${t("review.page")} ${passage.page} / ${pageCount}`}
            </Text>
          ) : null}
        </View>

        {field ? (
          <View style={styles.pinnedField}>
            <View style={styles.pinnedFieldBox}>
              <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.amber} />
              <View style={styles.pinnedFieldText}>
                <Text style={styles.pinnedFieldLabel}>
                  {field.attention === "missing"
                    ? field.label
                    : `${field.label} · ${
                        field.attention === "low" ? t("review.lowConfidence") : t("review.confident")
                      }`}
                </Text>
                <Text
                  style={[
                    styles.pinnedFieldValue,
                    field.attention === "missing" ? styles.amberInk : null,
                  ]}
                  numberOfLines={1}
                >
                  {field.value ?? t("review.missingValue")}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                hitSlop={{ top: 6, bottom: 6 }}
                style={styles.fitsButton}
              >
                <Text style={styles.fitsButtonText}>{t("review.fits")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </FullScreenModal>
  );
}

// ---------------------------------------------------------------------------
// Pieces of the screen
// ---------------------------------------------------------------------------

/** The queue as rows, for the sheet. */
function QueueList({
  queue,
  selectedId,
  onSelect,
}: {
  queue: ArchiveDocument[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  return (
    <View style={styles.queueList}>
      {queue.map((item) => {
        const active = item.id === selectedId;
        const percent = Math.round((item.confidence ?? 0) * 100);
        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(item.id)}
            style={({ pressed }) => [
              styles.queueRow,
              active ? styles.queueRowActive : pressed ? styles.queueRowPressed : null,
            ]}
          >
            <View style={styles.queueRowHead}>
              <Text style={styles.queueRowTitle} numberOfLines={1}>
                {titleForDocument(item)}
              </Text>
              <Pill label={`${percent}%`} tone={confidenceTone(percent)} />
            </View>
            <Text style={styles.queueRowMeta} numberOfLines={1}>
              {`${(item.reviewReasons ?? []).map((reason) => reviewReasonLabel(reason, t)).join(", ")} · ${formatDate(item.createdAt)}`}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One of a sheet's mutually exclusive options. */
function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.optionRow,
        selected ? styles.queueRowActive : pressed ? styles.queueRowPressed : null,
      ]}
    >
      <Text style={styles.optionLabel} numberOfLines={1}>
        {label}
      </Text>
      {selected ? (
        <MaterialCommunityIcons name="check" size={17} color={colors.accentSoftInk} />
      ) : null}
    </Pressable>
  );
}

/** A field to confirm: amber with a reason when it needs a look, a tick when not. */
function ConfirmField({
  fieldKey,
  label,
  value,
  selectLabel,
  attention,
  error,
  editable,
  onChange,
  onOpenSelect,
  onShowInDocument,
}: {
  fieldKey: ReviewFieldKey;
  label: string;
  value: string;
  /** What a select currently shows; absent on a text input. */
  selectLabel?: string;
  attention: "missing" | "low" | null;
  error: string | null;
  editable: boolean;
  onChange: (value: string) => void;
  onOpenSelect: () => void;
  onShowInDocument: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const kind = fieldKind(fieldKey);
  const boxStyle = [
    styles.input,
    attention !== null ? styles.inputAttention : null,
    error ? styles.inputInvalid : null,
    !editable ? styles.inputReadOnly : null,
  ];

  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {attention === null ? (
          <MaterialCommunityIcons name="check" size={13} color={colors.green} />
        ) : null}
      </View>
      {kind === "select" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityValue={{ text: selectLabel }}
          accessibilityState={{ disabled: !editable }}
          disabled={!editable}
          onPress={onOpenSelect}
          style={[boxStyle, styles.selectBox]}
        >
          <Text style={styles.selectText} numberOfLines={1}>
            {selectLabel}
          </Text>
          <MaterialCommunityIcons name="chevron-down" size={17} color={colors.muted} />
        </Pressable>
      ) : (
        <TextInput
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          editable={editable}
          autoCorrect={false}
          autoCapitalize={kind === "text" && fieldKey !== "referenceNumber" ? "words" : "none"}
          keyboardType={
            kind === "amount"
              ? "decimal-pad"
              : kind === "date"
                ? "numbers-and-punctuation"
                : "default"
          }
          placeholder={kind === "date" ? t("documentDetail.overview.datePlaceholder") : undefined}
          placeholderTextColor={colors.muted}
          style={[boxStyle, styles.inputText]}
        />
      )}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      {attention !== null ? (
        <View style={styles.fieldNoteRow}>
          <Text style={styles.fieldNote}>
            {attention === "missing" ? t("review.missingValue") : t("review.lowConfidence")}
          </Text>
          <Pressable accessibilityRole="button" onPress={onShowInDocument} hitSlop={12}>
            <Text style={styles.showLink}>{t("review.showInDocument")}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ReviewSkeleton() {
  const styles = useStyles();
  return (
    <View style={styles.skeletonWrap}>
      <Skeleton style={styles.skeletonStrip} />
      <Skeleton style={styles.skeletonStage} />
      <Skeleton style={styles.skeletonCard} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export function ReviewScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  /**
   * Confirming invalidates `["review"]`, so the refetched queue no longer holds
   * the confirmed document, and a numeric cursor into that list would skip the
   * next item. The cursor is an id, and confirmed ids are filtered out, which is
   * stable across refetches. Skipping only moves the cursor, as on the web.
   */
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  // Confirmed documents leave the queue, so "3 of 12" has to remember them.
  const [filedCount, setFiledCount] = useState(0);
  const [bulkThreshold, setBulkThreshold] = useState<number>(DEFAULT_BULK_THRESHOLD);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [picker, setPicker] = useState<"correspondentId" | "documentTypeId" | "threshold" | null>(
    null,
  );
  const [editing, setEditing] = useState<{ documentId: string; values: ReviewForm } | null>(null);
  const [invalidFields, setInvalidFields] = useState<ReviewFieldKey[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readerField, setReaderField] = useState<ReviewFieldKey | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
  const swipeableRef = useRef<Swipeable>(null);
  /**
   * One snackbar at a time: what just happened, and how to take it back. The
   * confirm is not sent while the window is open — it is held in
   * `pendingConfirm` and posted when the window closes. Two problems go away
   * with it: undo can no longer race an in-flight resolve, and taking a
   * mis-tap back needs no server call, so the queue never goes through
   * `requeue`, which clears the review state and enqueues a forced processing
   * job rather than restoring the document to pending review.
   */
  const [undo, setUndo] = useState<{
    action: "confirmed" | "skipped";
    documentId: string;
  } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingConfirm = useRef<string | null>(null);
  const outbox = useMemo(() => createReviewOutbox({ storage: AsyncStorage }), []);
  const scope = offlineCacheScope({ apiUrl: auth.apiUrl, userId: auth.user?.id });

  const reviewQuery = useQuery({
    queryKey: ["review", auth.apiUrl, shouldUseCache, offline.cacheSummary.revision],
    queryFn: () =>
      shouldUseCache
        ? collectAllPages((page, pageSize) =>
            offline.queryCachedDocuments({ reviewOnly: true, page, pageSize }),
          )
        : fetchReviewQueue(auth.authFetch, t("review.loadError")),
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  // Both selects are write surfaces, so there is nothing to load for them offline.
  const correspondentsQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "correspondents"),
    enabled: !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "correspondents", t("review.loadError")),
  });
  const documentTypesQuery = useQuery({
    queryKey: taxonomyQueryKey(auth.apiUrl, "document-types"),
    enabled: !shouldUseCache,
    queryFn: () => fetchTaxonomy(auth.authFetch, "document-types", t("review.loadError")),
  });
  const correspondents = useMemo(
    () =>
      Array.isArray(correspondentsQuery.data) ? sortTaxonomyOptions(correspondentsQuery.data) : [],
    [correspondentsQuery.data],
  );
  const documentTypes = useMemo(
    () =>
      Array.isArray(documentTypesQuery.data) ? sortTaxonomyOptions(documentTypesQuery.data) : [],
    [documentTypesQuery.data],
  );

  // A confirm the server has taken is gone from the queue, so its hold can go too.
  // Keeping it would hide the document if it were requeued later in this session.
  useEffect(() => {
    if (!reviewQuery.data) return;
    const queued = new Set(reviewQuery.data.items.map((item) => item.id));
    setConfirmedIds((current) => {
      const next = new Set([...current].filter((id) => queued.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [reviewQuery.data]);

  const items = useMemo(
    () => (reviewQuery.data?.items ?? []).filter((item) => !confirmedIds.has(item.id)),
    [confirmedIds, reviewQuery.data],
  );
  const reasonCounts = useMemo(() => countReasons(items), [items]);
  const queue = useMemo(() => filterByReason(items, reasonFilter), [items, reasonFilter]);
  const document = queue.find((item) => item.id === selectedId) ?? queue[0] ?? null;
  const selectedIndex = document ? queue.findIndex((item) => item.id === document.id) : -1;

  // An edit belongs to the document it was made on; anything else shows the record.
  const seed = useMemo(() => (document ? seedForm(document) : null), [document]);
  const form = editing && editing.documentId === document?.id ? editing.values : seed;

  // The cached record carries the file the offline reader needs.
  const cachedRecordQuery = useQuery({
    queryKey: ["cached-document-record", document?.id, offline.cacheSummary.revision],
    enabled: readerOpen && Boolean(document),
    queryFn: () => (document ? offline.loadCachedDocument(document.id) : null),
  });

  const textQuery = useQuery({
    queryKey: ["document-text", document?.id, shouldUseCache, offline.cacheSummary.revision],
    enabled: Boolean(document),
    queryFn: async () => {
      if (!document) {
        return { documentId: "", blocks: [] } satisfies DocumentTextResponse;
      }
      if (shouldUseCache) {
        const record = await offline.loadCachedDocument(document.id);
        return record?.text ?? { documentId: document.id, blocks: [] };
      }
      const response = await auth.authFetch(`/api/documents/${document.id}/text`);
      if (!response.ok) {
        return { documentId: document.id, blocks: [] } satisfies DocumentTextResponse;
      }
      return (await response.json()) as DocumentTextResponse;
    },
  });

  const refreshArchive = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]),
    [queryClient],
  );

  /**
   * A confirm the app was killed on top of. Replayed once, on the first render
   * that has both an archive to send it to and a connection to reach it — the
   * user already watched this document be accepted, so sending it is finishing
   * what they asked for rather than acting on its own.
   */
  const replayed = useRef(false);
  useEffect(() => {
    if (replayed.current || !scope || shouldUseCache) {
      return;
    }
    replayed.current = true;
    void outbox
      .flush({
        scope,
        send: (documentId) => resolveReview(auth.authFetch, documentId),
      })
      .then(async (outcome) => {
        if (outcome === "sent") {
          await queryClient.invalidateQueries({ queryKey: ["review"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }
      })
      .catch(() => undefined);
  }, [auth, outbox, queryClient, scope, shouldUseCache]);

  const resolveMutation = useMutation({
    mutationFn: (documentId: string) => resolveReview(auth.authFetch, documentId),
    onSuccess: refreshArchive,
    // The window has closed and the send failed: the document is still pending on
    // the server, so it goes back in the queue rather than quietly staying hidden.
    onError: (error, documentId) => {
      setConfirmedIds((current) => {
        const next = new Set(current);
        next.delete(documentId);
        return next;
      });
      setFiledCount((count) => Math.max(0, count - 1));
      setActionError(error instanceof Error ? error.message : t("review.actionFailed"));
    },
  });

  const patchMutation = useMutation({
    mutationFn: (input: { documentId: string; body: Record<string, unknown> }) =>
      patchDocument(auth.authFetch, input.documentId, input.body),
    // Awaited: the next look at this document has to be the saved values, or an
    // undo would seed the form from the old record and re-send the difference.
    onSuccess: refreshArchive,
  });

  const requeueMutation = useMutation({
    mutationFn: (documentId: string) => requeueReview(auth.authFetch, documentId),
    onSuccess: refreshArchive,
  });

  const activeField = useMemo<ActiveField | null>(() => {
    if (!document) {
      return null;
    }
    const seeded = seedForm(document);
    const fields = fieldsToConfirm(document).map((key) => ({
      key,
      label: t(FIELD_LABELS[key]),
      value: displayFieldValue(document, key),
      raw: storedFieldValue(document, key),
      attention: fieldAttention(document, key, seeded[key]),
    }));
    return (
      fields.find((field) => field.key === readerField) ??
      fields.find((field) => field.attention !== null) ??
      fields[0] ??
      null
    );
  }, [document, readerField, t]);

  const blocks = textQuery.data?.blocks;

  /**
   * The lookup uses the stored value, not the formatted one: an `issueDate` of
   * `2024-03-18` renders as `18 Mar 2024`, which never matches OCR text reading
   * `18.03.2024`. Dates are also tried in day-first order, since that is how a
   * German invoice prints them.
   */
  const passage = useMemo(() => {
    const raw = activeField?.raw ?? null;
    const candidates = [raw, activeField?.value ?? null];
    const dateOnly = raw ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
    if (dateOnly) {
      candidates.push(`${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`);
      candidates.push(`${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1].slice(2)}`);
    }
    for (const candidate of candidates) {
      const found = findPassage(blocks, candidate);
      if (found) {
        return found;
      }
    }
    return firstLines(blocks, 4);
  }, [blocks, activeField?.raw, activeField?.value]);

  const pageCount = document?.metadata?.pageCount ?? passage?.page ?? 1;

  const select = useCallback((id: string | null) => {
    setReaderField(null);
    setInvalidFields([]);
    setActionError(null);
    setSelectedId(id);
  }, []);

  /** Post the confirm that is still waiting out its window, if there is one. */
  const flushPendingConfirm = useCallback(() => {
    const documentId = pendingConfirm.current;
    pendingConfirm.current = null;
    if (documentId) {
      // Only a confirm the server took may leave the outbox. If this fails, signing
      // out mid-window being the likely case, the next open sends it again.
      void resolveMutation.mutateAsync(documentId).then(() => outbox.release(), () => {});
    }
  }, [resolveMutation, outbox]);

  const closeUndo = useCallback(() => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setUndo(null);
  }, []);

  const offerUndo = useCallback(
    (action: "confirmed" | "skipped", documentId: string) => {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
      setUndo({ action, documentId });
      undoTimer.current = setTimeout(() => {
        undoTimer.current = null;
        flushPendingConfirm();
        setUndo(null);
      }, UNDO_WINDOW_MS);
    },
    [flushPendingConfirm],
  );

  const skip = useCallback(() => {
    if (!document) return;
    const next = neighbourOf(queue, document.id);
    if (!next) {
      // Nothing to skip to. The swipe still has to spring back.
      swipeableRef.current?.close();
      return;
    }
    flushPendingConfirm();
    offerUndo("skipped", document.id);
    select(next.id);
  }, [document, flushPendingConfirm, offerUndo, queue, select]);

  const confirm = useCallback(async () => {
    if (!document || !form || patchMutation.isPending) return;

    const patch = buildReviewPatch(document, form);
    if (!patch.ok) {
      setInvalidFields(patch.invalid);
      const first = patch.invalid[0];
      setActionError(
        `${t(FIELD_LABELS[first])}: ${
          fieldKind(first) === "amount" ? t("review.invalidAmount") : t("review.invalidDate")
        }`,
      );
      return;
    }
    setInvalidFields([]);
    setActionError(null);

    /**
     * Corrections are saved now and the confirm is held, not the other way round.
     * The undo window and the outbox only ever have to deal with the review
     * decision; what the undo takes back is that decision, and a typo the user
     * fixed stays fixed. Killed in between, the document is simply still in the
     * queue, with the corrected values.
     */
    if (patch.changed) {
      try {
        await patchMutation.mutateAsync({ documentId: document.id, body: patch.body });
      } catch (error) {
        setActionError(error instanceof Error ? error.message : t("review.actionFailed"));
        return;
      }
    }
    setEditing(null);

    // A confirm still in its window goes now; only one can be taken back.
    flushPendingConfirm();
    pendingConfirm.current = document.id;
    // Written down before the window opens: if the app dies inside it, the next
    // launch sends what the user already watched being accepted.
    if (scope) {
      void outbox.hold({ documentId: document.id, scope });
    }
    offerUndo("confirmed", document.id);
    setFiledCount((count) => count + 1);
    setConfirmedIds((current) => new Set(current).add(document.id));
    select(neighbourOf(queue, document.id)?.id ?? null);
  }, [
    document,
    flushPendingConfirm,
    form,
    offerUndo,
    outbox,
    patchMutation,
    queue,
    scope,
    select,
    t,
  ]);

  /**
   * Back puts the document at the head of the walk again. A held confirm was never
   * sent, so this is local: drop it and stop treating the document as confirmed.
   * Going by id rather than by position matters — a refetch may have reordered the
   * queue since.
   */
  const undoLast = useCallback(() => {
    if (!undo) return;
    pendingConfirm.current = null;
    // Taken back, so there is nothing to replay.
    void outbox.release();
    if (undo.action === "confirmed") {
      setFiledCount((count) => Math.max(0, count - 1));
      setConfirmedIds((current) => {
        const next = new Set(current);
        next.delete(undo.documentId);
        return next;
      });
    }
    const restored = reviewQuery.data?.items.find((item) => item.id === undo.documentId);
    if (restored && filterByReason([restored], reasonFilter).length === 0) {
      setReasonFilter("all");
    }
    select(undo.documentId);
    closeUndo();
  }, [closeUndo, outbox, reasonFilter, reviewQuery.data, select, undo]);

  // Leaving the screen closes the window: send the confirm rather than drop it.
  const flushRef = useRef(flushPendingConfirm);
  useEffect(() => {
    flushRef.current = flushPendingConfirm;
  }, [flushPendingConfirm]);
  useEffect(
    () => () => {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
      flushRef.current();
    },
    [],
  );

  const openReader = useCallback((field?: ReviewFieldKey) => {
    if (field) {
      setReaderField(field);
    }
    setReaderOpen(true);
  }, []);

  const changeFilter = useCallback(
    (next: string) => {
      setReasonFilter(next);
      // A different queue: progress through the old one means nothing here.
      setFiledCount(0);
      select(null);
    },
    [select],
  );

  const setField = useCallback(
    (key: ReviewFieldKey, value: string) => {
      if (!document || !form) return;
      setEditing({ documentId: document.id, values: { ...form, [key]: value } });
      setInvalidFields((current) => current.filter((field) => field !== key));
      setActionError(null);
    },
    [document, form],
  );

  const bulkEligible = useMemo(
    () => queue.filter((item) => isBulkEligible(item, bulkThreshold)),
    [bulkThreshold, queue],
  );
  const bulkLabel = t("review.bulkConfirm")
    .replace("{count}", String(bulkEligible.length))
    .replace("{percent}", String(bulkThreshold));
  // Once the threshold has moved the control stays, or raising it past every
  // document would take away the only way to lower it again.
  const showBulk =
    !shouldUseCache && (bulkEligible.length > 0 || bulkThreshold !== DEFAULT_BULK_THRESHOLD);

  const runBulkConfirm = useCallback(async () => {
    flushPendingConfirm();
    closeUndo();
    setBulkRunning(true);
    setActionError(null);
    try {
      for (const item of bulkEligible) {
        await resolveReview(auth.authFetch, item.id);
        setFiledCount((count) => count + 1);
        setConfirmedIds((current) => new Set(current).add(item.id));
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("review.actionFailed"));
    } finally {
      setBulkRunning(false);
      await refreshArchive();
    }
  }, [auth.authFetch, bulkEligible, closeUndo, flushPendingConfirm, refreshArchive, t]);

  const askBulkConfirm = useCallback(() => {
    Alert.alert(bulkLabel, t("review.bulkAlertBody"), [
      { text: t("settings.cancel"), style: "cancel" },
      { text: t("review.confirm"), onPress: () => void runBulkConfirm() },
    ]);
  }, [bulkLabel, runBulkConfirm, t]);

  const reprocess = useCallback(() => {
    if (!document) return;
    setActionError(null);
    requeueMutation.mutate(document.id, {
      // It leaves the queue until the worker has been through it again.
      onSuccess: () => select(neighbourOf(queue, document.id)?.id ?? null),
      onError: (error) =>
        setActionError(error instanceof Error ? error.message : t("review.actionFailed")),
    });
  }, [document, queue, requeueMutation, select, t]);

  const busy = patchMutation.isPending || bulkRunning;
  const position = queuePosition(queue.length, selectedIndex, filedCount);
  const positionLabel = t("review.position")
    .replace("{at}", String(position.position))
    .replace("{of}", String(position.total));

  const days = oldestDays(items);
  const titleMeta =
    items.length > 0
      ? [
          `${items.length} ${items.length === 1 ? t("review.docOne") : t("review.docMany")}`,
          days === 1
            ? t("review.oldestOne")
            : days > 1
              ? t("review.oldest").replace("{days}", String(days))
              : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : t("review.subtitle");

  const optionName = (key: "correspondentId" | "documentTypeId") => {
    const value = form?.[key] ?? "";
    if (!value) {
      return "—";
    }
    const options = key === "correspondentId" ? correspondents : documentTypes;
    return (
      options.find((option) => option.id === value)?.name ??
      (key === "correspondentId" ? document?.correspondent?.name : document?.documentType?.name) ??
      "—"
    );
  };

  const percent =
    document?.confidence === null || document?.confidence === undefined
      ? null
      : Math.round(document.confidence * 100);
  const activeReasonWhy = reasonFilter === "all" ? null : reviewReasonWhy(reasonFilter, t);
  const filedLine =
    filedCount === 0
      ? ""
      : `${
          filedCount === 1
            ? t("review.filedOne")
            : t("review.filedMany").replace("{count}", String(filedCount))
        } `;

  const snackbar = undo ? (
    <View style={styles.snackbar}>
      <Text style={styles.snackbarText}>
        {undo.action === "confirmed" ? t("review.undoConfirmed") : t("review.undoSkipped")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={undoLast}
        hitSlop={10}
        style={styles.snackbarAction}
      >
        <Text style={styles.snackbarActionText}>{t("review.undo")}</Text>
      </Pressable>
    </View>
  ) : null;

  return (
    <Screen
      title={t("review.pageTitle")}
      titleMeta={reviewQuery.data ? titleMeta : undefined}
      padded={false}
      scroll={false}
      notice={shouldUseCache ? <Notice label={t("state.offlineReadOnly")} /> : undefined}
    >
      {reviewQuery.isLoading ? <ReviewSkeleton /> : null}

      {reviewQuery.isError && !reviewQuery.data ? (
        <View style={styles.gutter}>
          <ErrorCard message={t("review.loadError")} onRetry={() => reviewQuery.refetch()} />
        </View>
      ) : null}

      {/* Nothing to review: this is the good outcome, so let it feel like one. */}
      {reviewQuery.data && items.length === 0 ? (
        <ScrollView contentContainerStyle={styles.gutter}>
          <View style={styles.caughtUp}>
            <Gradient
              name="wash"
              borderRadius={radii.xxl}
              style={styles.caughtUpFill}
            />
            <IconTile size="lg" tone="solid">
              <MaterialCommunityIcons name="check-circle-outline" size={22} color={colors.onGradient} />
            </IconTile>
            <Text style={styles.caughtUpTitle} accessibilityRole="header">
              {t("review.caughtUpTitle")}
            </Text>
            <Text style={styles.caughtUpBody}>{`${filedLine}${t("review.caughtUpBody")}`}</Text>
            <View style={styles.caughtUpActions}>
              <Button
                label={t("tabs.today")}
                icon="home-outline"
                variant="secondary"
                onPress={() => navigation.navigate("Home", { screen: "Today" } as never)}
              />
              <Button
                label={t("import.title")}
                icon="file-upload-outline"
                variant="secondary"
                onPress={() => navigation.navigate("Scan")}
              />
            </View>
          </View>
        </ScrollView>
      ) : null}

      {reviewQuery.data && items.length > 0 ? (
        <>
          {showBulk ? (
            <View style={styles.bulkRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("review.bulkThreshold")}
                accessibilityValue={{ text: `${bulkThreshold}%` }}
                disabled={bulkRunning}
                onPress={() => setPicker("threshold")}
                hitSlop={{ top: 4, bottom: 4 }}
                style={styles.thresholdBox}
              >
                <Text style={styles.thresholdText}>{`≥ ${bulkThreshold}%`}</Text>
                <MaterialCommunityIcons name="chevron-down" size={15} color={colors.muted} />
              </Pressable>
              <View style={styles.bulkButton}>
                <Button
                  label={bulkLabel}
                  icon="check"
                  variant="secondary"
                  size="sm"
                  loading={bulkRunning}
                  disabled={bulkEligible.length === 0}
                  onPress={askBulkConfirm}
                />
              </View>
            </View>
          ) : null}

          {/* Where you are in the queue, and which part of it you are walking. */}
          <View style={styles.stripWrap}>
            <Panel style={styles.strip}>
              {document ? (
                <View style={styles.positionRow}>
                  <Text style={styles.positionText}>{positionLabel}</Text>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel={positionLabel}
                    accessibilityValue={{ min: 0, max: position.total, now: position.position }}
                    style={styles.progressTrack}
                  >
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.round(position.ratio * 100)}%` },
                      ]}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("review.previous")}
                    accessibilityState={{ disabled: selectedIndex <= 0 || busy }}
                    disabled={selectedIndex <= 0 || busy}
                    onPress={() => select(queue[selectedIndex - 1]?.id ?? null)}
                    hitSlop={6}
                    style={[styles.navButton, selectedIndex <= 0 ? styles.navDisabled : null]}
                  >
                    <MaterialCommunityIcons name="chevron-left" size={20} color={colors.ink} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("review.next")}
                    accessibilityState={{ disabled: selectedIndex >= queue.length - 1 || busy }}
                    disabled={selectedIndex >= queue.length - 1 || busy}
                    onPress={() => select(queue[selectedIndex + 1]?.id ?? null)}
                    hitSlop={6}
                    style={[
                      styles.navButton,
                      selectedIndex >= queue.length - 1 ? styles.navDisabled : null,
                    ]}
                  >
                    <MaterialCommunityIcons name="chevron-right" size={20} color={colors.ink} />
                  </Pressable>
                  <View style={styles.queueButton}>
                    <Button
                      label={t("review.queue")}
                      icon="format-list-numbered"
                      variant="secondary"
                      size="sm"
                      onPress={() => setQueueOpen(true)}
                    />
                  </View>
                </View>
              ) : null}

              {/* Sideways, so many reasons can't push the document away. */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                style={styles.chipScroller}
                contentContainerStyle={styles.chips}
              >
                <Chip
                  label={`${t("review.all")} · ${items.length}`}
                  active={reasonFilter === "all"}
                  onPress={() => changeFilter("all")}
                />
                {[...reasonCounts.entries()].map(([reason, count]) => (
                  <Chip
                    key={reason}
                    label={`${reviewReasonLabel(reason, t)} · ${count}`}
                    active={reasonFilter === reason}
                    onPress={() => changeFilter(reasonFilter === reason ? "all" : reason)}
                  />
                ))}
              </ScrollView>
              {activeReasonWhy ? <Text style={styles.reasonHint}>{activeReasonWhy}</Text> : null}
            </Panel>
          </View>

          {document && form ? (
            <Swipeable
              key={document.id}
              ref={swipeableRef}
              containerStyle={styles.swipeFill}
              childrenContainerStyle={styles.swipeFill}
              overshootRight={false}
              enabled={!busy && queue.length > 1}
              onSwipeableOpen={(direction) => {
                if (direction === "right") {
                  skip();
                }
              }}
              renderRightActions={() => (
                <View style={styles.skipAction}>
                  <MaterialCommunityIcons name="skip-next" size={18} color={colors.muted} />
                  <Text style={styles.skipActionText}>{t("review.skip")}</Text>
                </View>
              )}
            >
              <View style={styles.body}>
                <ScrollView
                  contentContainerStyle={styles.bodyScroll}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="interactive"
                  automaticallyAdjustKeyboardInsets
                  showsVerticalScrollIndicator={false}
                >
                  {/* The page. Paper stays white; the stage around it takes the theme. */}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("review.wholePage")}
                    onPress={() => openReader()}
                    style={styles.stage}
                  >
                    {textQuery.isLoading ? (
                      <View style={styles.stagePaper}>
                        <Skeleton style={styles.paperLineShort} />
                        <Skeleton style={styles.paperLine} />
                        <Skeleton style={styles.paperLine} />
                      </View>
                    ) : passage ? (
                      <PassagePaper passage={passage} compact />
                    ) : (
                      <View style={styles.stagePaper}>
                        <Text style={styles.stageHint}>{t("review.noText")}</Text>
                      </View>
                    )}
                    <View style={styles.stageChipLeft}>
                      <MaterialCommunityIcons name="arrow-expand" size={11} color={colors.paper} />
                      <Text style={styles.stageChipText}>{t("review.wholePage")}</Text>
                    </View>
                    <View style={styles.stageChipRight}>
                      <Text style={styles.stageChipText}>
                        {`${passage?.page ?? 1} / ${pageCount}`}
                      </Text>
                    </View>
                  </Pressable>

                  {/* The fields to confirm */}
                  <Panel style={styles.card}>
                    <View style={styles.cardHead}>
                      <View style={styles.cardHeadText}>
                        <Text style={styles.cardTitle} accessibilityRole="header">
                          {`${document.correspondent?.name ? `${document.correspondent.name} — ` : ""}${titleForDocument(document)}`}
                        </Text>
                        <View style={styles.cardMeta}>
                          {document.documentType?.name ? (
                            <Text style={styles.cardMetaText}>{document.documentType.name}</Text>
                          ) : null}
                          {document.issueDate ? (
                            <Text style={styles.cardMetaNumber}>
                              {formatDate(document.issueDate)}
                            </Text>
                          ) : null}
                          {percent !== null ? (
                            <Pill
                              label={`${t("review.confidence")} ${percent}%`}
                              tone={confidenceTone(percent)}
                            />
                          ) : null}
                        </View>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t("review.openDocument")}
                        onPress={() =>
                          navigation.navigate("DocumentDetail", {
                            documentId: document.id,
                            title: titleForDocument(document),
                          })
                        }
                        hitSlop={10}
                        style={styles.navButton}
                      >
                        <MaterialCommunityIcons
                          name="arrow-top-right"
                          size={18}
                          color={colors.muted}
                        />
                      </Pressable>
                    </View>

                    <View style={styles.cardBody}>
                      {(document.reviewReasons ?? []).length > 0 ? (
                        <View
                          accessibilityRole="alert"
                          accessibilityLabel={t("review.whyTitle")}
                          style={styles.callout}
                        >
                          <MaterialCommunityIcons
                            name="alert-outline"
                            size={17}
                            color={colors.amber}
                          />
                          <View style={styles.calloutList}>
                            {document.reviewReasons.map((reason) => {
                              const why = reviewReasonWhy(reason, t);
                              return (
                                <Text key={reason} style={styles.calloutText}>
                                  <Text
                                    style={
                                      isConfidenceOnlyReason(reason)
                                        ? styles.calloutLabelWarn
                                        : styles.calloutLabelBad
                                    }
                                  >
                                    {`${reviewReasonLabel(reason, t)}.`}
                                  </Text>
                                  {why ? ` ${why}` : ""}
                                </Text>
                              );
                            })}
                          </View>
                        </View>
                      ) : null}

                      <Text style={styles.sectionLabel}>{t("review.confirmFields")}</Text>
                      {fieldsToConfirm(document).map((key) => (
                        <ConfirmField
                          key={key}
                          fieldKey={key}
                          label={t(FIELD_LABELS[key])}
                          value={form[key]}
                          selectLabel={
                            key === "correspondentId" || key === "documentTypeId"
                              ? optionName(key)
                              : undefined
                          }
                          attention={fieldAttention(document, key, form[key])}
                          error={
                            invalidFields.includes(key)
                              ? fieldKind(key) === "amount"
                                ? t("review.invalidAmount")
                                : t("review.invalidDate")
                              : null
                          }
                          editable={!shouldUseCache && !busy}
                          onChange={(value) => setField(key, value)}
                          onOpenSelect={() =>
                            setPicker(key === "documentTypeId" ? "documentTypeId" : "correspondentId")
                          }
                          onShowInDocument={() => openReader(key)}
                        />
                      ))}
                    </View>
                  </Panel>
                </ScrollView>

                {snackbar}

                {/* Pinned, however far down the fields the user is. */}
                <View style={[styles.actionBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
                  {actionError ? (
                    <View accessibilityRole="alert" style={styles.actionError}>
                      <MaterialCommunityIcons name="alert-outline" size={15} color={colors.red} />
                      <Text style={styles.actionErrorText}>{actionError}</Text>
                    </View>
                  ) : null}
                  <Button
                    label={t("review.confirmAndFile")}
                    icon="check"
                    disabled={shouldUseCache || bulkRunning}
                    loading={patchMutation.isPending}
                    onPress={() => void confirm()}
                  />
                  <View style={styles.secondaryActions}>
                    <View style={styles.secondaryAction}>
                      <Button
                        label={t("review.skip")}
                        icon="skip-next"
                        variant="secondary"
                        disabled={busy || queue.length <= 1}
                        onPress={skip}
                      />
                    </View>
                    <View style={styles.secondaryAction}>
                      <Button
                        label={t("review.reprocess")}
                        icon="restore"
                        variant="secondary"
                        disabled={shouldUseCache || busy}
                        loading={requeueMutation.isPending}
                        onPress={reprocess}
                      />
                    </View>
                  </View>
                </View>
              </View>
            </Swipeable>
          ) : (
            <View style={styles.gutter}>
              <Panel>
                <EmptyState
                  icon="magnify-close"
                  title={t("review.filterEmptyTitle")}
                  body={t("review.filterEmptyBody")}
                  action={t("review.showAll")}
                  onAction={() => changeFilter("all")}
                />
              </Panel>
            </View>
          )}
        </>
      ) : null}

      {/* On a one-item queue the document, and the bar above which this sits, is gone. */}
      {document ? null : snackbar}

      <BottomSheet visible={queueOpen} onClose={() => setQueueOpen(false)} title={t("review.queue")}>
        <Text style={styles.sheetHint}>{t("review.queueHint")}</Text>
        <QueueList
          queue={queue}
          selectedId={document?.id ?? null}
          onSelect={(id) => {
            select(id);
            setQueueOpen(false);
          }}
        />
      </BottomSheet>

      <BottomSheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={
          picker === "threshold"
            ? t("review.bulkThreshold")
            : picker
              ? t(FIELD_LABELS[picker])
              : undefined
        }
      >
        <View style={styles.queueList}>
          {picker === "threshold" ? (
            BULK_THRESHOLDS.map((value) => (
              <OptionRow
                key={value}
                label={`≥ ${value}%`}
                selected={bulkThreshold === value}
                onPress={() => {
                  setBulkThreshold(value);
                  setPicker(null);
                }}
              />
            ))
          ) : picker ? (
            <>
              <OptionRow
                label="—"
                selected={!form?.[picker]}
                onPress={() => {
                  setField(picker, "");
                  setPicker(null);
                }}
              />
              {(picker === "correspondentId" ? correspondents : documentTypes).map((option) => (
                <OptionRow
                  key={option.id}
                  label={option.name}
                  selected={form?.[picker] === option.id}
                  onPress={() => {
                    setField(picker, option.id);
                    setPicker(null);
                  }}
                />
              ))}
            </>
          ) : null}
        </View>
      </BottomSheet>

      {readerOpen && document ? (
        <Reader
          document={document}
          passage={passage}
          field={activeField}
          pageCount={pageCount}
          authFetch={auth.authFetch}
          offlineMode={shouldUseCache}
          localFileUri={cachedRecordQuery.data?.fileUri ?? null}
          onClose={() => setReaderOpen(false)}
        />
      ) : null}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  gutter: {
    padding: 16,
  },
  amberInk: {
    color: c.amber,
  },

  /* loading */
  skeletonWrap: {
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  skeletonStrip: {
    height: 92,
    borderRadius: radii.xl,
  },
  skeletonStage: {
    height: 200,
    borderRadius: radii.xl,
  },
  skeletonCard: {
    height: 260,
    borderRadius: radii.xl,
  },

  /* all caught up */
  caughtUp: {
    alignItems: "center",
    gap: 12,
    borderRadius: radii.xxl,
    paddingHorizontal: 24,
    paddingVertical: 56,
  },
  caughtUpFill: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  caughtUpTitle: {
    ...text.screenTitle,
    color: c.accent,
    textAlign: "center",
  },
  caughtUpBody: {
    ...text.body,
    maxWidth: 320,
    color: c.muted,
    textAlign: "center",
  },
  caughtUpActions: {
    alignSelf: "stretch",
    gap: 8,
    marginTop: 12,
  },

  /* bulk */
  bulkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  thresholdBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
  },
  thresholdText: {
    ...text.numericStrong,
    color: c.ink,
  },
  bulkButton: {
    flex: 1,
    minWidth: 0,
  },

  /* position and filter */
  stripWrap: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  strip: {
    gap: 10,
    padding: 12,
  },
  positionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  positionText: {
    ...text.numericStrong,
    flexShrink: 0,
    marginRight: 4,
    color: c.ink,
  },
  progressTrack: {
    flex: 1,
    minWidth: 32,
    height: 6,
    overflow: "hidden",
    borderRadius: radii.pill,
    backgroundColor: c.sunken,
  },
  progressFill: {
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: c.accentFill,
  },
  navButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: radii.md,
  },
  navDisabled: {
    opacity: 0.3,
  },
  queueButton: {
    flexShrink: 0,
  },
  // Runs to the card's edge, so a clipped chip reads as "there is more".
  chipScroller: {
    marginHorizontal: -12,
  },
  chips: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  reasonHint: {
    ...text.meta,
    color: c.muted,
  },

  /**
   * `Swipeable` puts two plain, flex-less views between the screen and `body`.
   * Yoga resolves `body`'s `flex: 1` against their auto height — zero — so on
   * a device the whole card collapses and the screen sits blank under a live
   * queue counter. The web renderer falls back to the content size for the
   * same basis, which is why browser screenshots never showed it (#174).
   */
  swipeFill: {
    flex: 1,
  },
  body: {
    flex: 1,
    backgroundColor: c.app,
  },
  bodyScroll: {
    gap: 16,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },

  /* the document */
  stage: {
    minHeight: 168,
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
    paddingBottom: 44,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.sunken,
    ...cardShadow(c),
  },
  stagePaper: {
    alignSelf: "stretch",
    gap: 10,
    padding: 16,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: c.paperBorder,
    backgroundColor: c.paper,
  },
  paperLineShort: {
    width: "50%",
    height: 12,
    backgroundColor: c.paperBorder,
  },
  paperLine: {
    height: 8,
    backgroundColor: c.paperBorder,
  },
  stageHint: {
    ...text.meta,
    color: c.paperInk,
    textAlign: "center",
  },
  stageChipLeft: {
    position: "absolute",
    left: 14,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radii.sm,
    backgroundColor: c.overlay,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stageChipRight: {
    position: "absolute",
    right: 14,
    bottom: 12,
    borderRadius: radii.sm,
    backgroundColor: c.overlay,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stageChipText: {
    ...text.numeric,
    color: c.paper,
  },

  /* the card */
  card: {
    overflow: "hidden",
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  cardHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  cardTitle: {
    ...text.barTitle,
    color: c.ink,
  },
  cardMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  cardMetaText: {
    ...text.meta,
    color: c.muted,
  },
  cardMetaNumber: {
    ...text.numeric,
    color: c.muted,
  },
  cardBody: {
    gap: 14,
    padding: 16,
  },
  callout: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.lg,
    backgroundColor: c.amberSoft,
  },
  calloutList: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  calloutText: {
    ...text.body,
    color: c.ink,
  },
  calloutLabelWarn: {
    fontFamily: text.bodyStrong.fontFamily,
    color: c.amber,
  },
  calloutLabelBad: {
    fontFamily: text.bodyStrong.fontFamily,
    color: c.red,
  },
  sectionLabel: {
    ...text.sectionLabel,
    color: c.muted,
  },

  /* a field */
  field: {
    gap: 6,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  fieldLabel: {
    ...text.sectionLabel,
    color: c.ink,
  },
  input: {
    minHeight: 44,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: c.borderStrong,
    backgroundColor: c.panel,
    paddingHorizontal: 12,
  },
  inputAttention: {
    borderColor: c.amber,
    backgroundColor: c.amberSoft,
  },
  inputInvalid: {
    borderColor: c.red,
  },
  inputReadOnly: {
    opacity: 0.7,
  },
  inputText: {
    ...text.body,
    color: c.ink,
  },
  selectBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  selectText: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  fieldError: {
    ...text.meta,
    color: c.red,
  },
  fieldNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  fieldNote: {
    ...text.metaStrong,
    color: c.amber,
  },
  showLink: {
    ...text.smallStrong,
    color: c.accent,
  },

  /* undo */
  snackbar: {
    flexShrink: 0,
    marginHorizontal: 16,
    marginVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: radii.lg,
    backgroundColor: c.raised,
    borderWidth: 1,
    borderColor: c.border,
    paddingLeft: 12,
    paddingRight: 6,
    ...raisedShadow(c),
  },
  snackbarText: {
    ...text.meta,
    flex: 1,
    color: c.ink,
  },
  snackbarAction: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  snackbarActionText: {
    ...text.metaStrong,
    color: c.accent,
  },

  /* actions */
  actionBar: {
    gap: 8,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.panel,
  },
  actionError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: c.redSoft,
  },
  actionErrorText: {
    ...text.meta,
    flex: 1,
    color: c.red,
  },
  secondaryActions: {
    flexDirection: "row",
    gap: 8,
  },
  secondaryAction: {
    flex: 1,
    minWidth: 0,
  },
  skipAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: 110,
    backgroundColor: c.raised,
  },
  skipActionText: {
    ...text.smallStrong,
    color: c.muted,
  },

  /* sheets */
  sheetHint: {
    ...text.meta,
    color: c.muted,
  },
  queueList: {
    gap: 2,
  },
  queueRow: {
    gap: 2,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radii.lg,
  },
  queueRowActive: {
    backgroundColor: c.accentSoft,
  },
  queueRowPressed: {
    backgroundColor: c.bar,
  },
  queueRowHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  queueRowTitle: {
    ...text.rowTitle,
    flex: 1,
    color: c.ink,
  },
  queueRowMeta: {
    ...text.meta,
    color: c.muted,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: radii.lg,
  },
  optionLabel: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },

  /* reader */
  readerRoot: {
    flex: 1,
    backgroundColor: c.sunken,
  },
  readerBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  readerBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
  },
  readerBackText: {
    ...text.meta,
    color: c.accent,
  },
  readerPages: {
    ...text.numeric,
    marginLeft: "auto",
    color: c.dim,
  },
  readerBody: {
    padding: 16,
    gap: 14,
  },
  readerHint: {
    ...text.meta,
    color: c.dim,
  },
  readerFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  readerPageNumber: {
    ...text.numeric,
    marginLeft: "auto",
    color: c.dim,
  },
  citationButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 44,
    paddingHorizontal: 9,
    borderRadius: radii.md,
    backgroundColor: c.amberSoft,
  },
  citationText: {
    ...text.smallStrong,
    color: c.amber,
  },
  pinnedField: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  pinnedFieldBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: radii.lg,
    backgroundColor: c.amberSoft,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  pinnedFieldText: {
    flex: 1,
    minWidth: 0,
  },
  pinnedFieldLabel: {
    ...text.small,
    color: c.amber,
  },
  pinnedFieldValue: {
    ...text.rowTitle,
    color: c.ink,
  },
  fitsButton: {
    flexShrink: 0,
    height: 34,
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: c.accentFill,
    paddingHorizontal: 13,
  },
  fitsButtonText: {
    ...text.metaStrong,
    color: c.accentFillInk,
  },
}));
