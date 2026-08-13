import { useNavigation } from "@react-navigation/native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth";
import { DocumentViewer } from "../components/DocumentViewer";
import { findPassage, firstLines, PassagePaper, type Passage } from "../components/Passage";
import { Button, ErrorCard, Notice, Panel, Pill, Screen } from "../components/ui";
import { processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useOfflineArchive } from "../offline-archive";
import { offlineCacheScope } from "../offline-scope";
import { createReviewOutbox } from "../review-outbox";
import { reviewReasonLabel } from "../review-reasons";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import {
  formatCurrency,
  formatDate,
  responseToMessage,
  titleForDocument,
  type ArchiveDocument,
  type DocumentTextResponse,
  type ReviewQueueResponse,
} from "../lib";

type Translate = ReturnType<typeof useI18n>["t"];

/** Long enough to notice a mis-tap, short enough not to linger. */
const UNDO_WINDOW_MS = 5_000;

const FIELD_KEYS: Record<string, string> = {
  issueDate: "review.field.issueDate",
  dueDate: "review.field.dueDate",
  expiryDate: "review.field.expiryDate",
  amount: "review.field.amount",
  currency: "review.field.currency",
  referenceNumber: "review.field.referenceNumber",
  correspondent: "review.field.correspondent",
  correspondentName: "review.field.correspondent",
  documentType: "review.field.documentType",
  documentTypeName: "review.field.documentType",
  holderName: "review.field.holderName",
  issuingAuthority: "review.field.issuingAuthority",
  title: "review.field.title",
};

function fieldLabel(field: string, t: Translate) {
  const key = FIELD_KEYS[field];
  return key ? t(key as never) : field;
}

type ReviewField = {
  name: string;
  label: string;
  value: string | null;
  /** What the extractor stored, for locating the passage in the OCR text. */
  raw: string | null;
  /** Mono, because it is a number, a date or an identifier. */
  mono: boolean;
  missing: boolean;
  /** Below the document's confidence threshold. */
  low: boolean;
  confidence: number | null;
};

const MONO_FIELDS = new Set([
  "issueDate",
  "dueDate",
  "expiryDate",
  "amount",
  "currency",
  "referenceNumber",
]);

/** The value as stored, before display formatting. */
function storedFieldValue(document: ArchiveDocument, field: string): string | null {
  switch (field) {
    case "issueDate":
      return document.issueDate ?? null;
    case "dueDate":
      return document.dueDate ?? null;
    case "expiryDate":
      return document.expiryDate ?? null;
    case "amount":
      return document.amount === null || document.amount === undefined
        ? null
        : String(document.amount);
    default:
      return displayFieldValue(document, field);
  }
}

function displayFieldValue(document: ArchiveDocument, field: string): string | null {
  switch (field) {
    case "issueDate":
      return document.issueDate ? formatDate(document.issueDate) : null;
    case "dueDate":
      return document.dueDate ? formatDate(document.dueDate) : null;
    case "expiryDate":
      return document.expiryDate ? formatDate(document.expiryDate) : null;
    case "amount":
      return document.amount === null || document.amount === undefined
        ? null
        : formatCurrency(document.amount, document.currency ?? "EUR");
    case "currency":
      return document.currency ?? null;
    case "referenceNumber":
      return document.referenceNumber ?? null;
    case "correspondent":
    case "correspondentName":
      return document.correspondent?.name ?? null;
    case "documentType":
    case "documentTypeName":
      return document.documentType?.name ?? null;
    case "holderName":
      return document.holderName ?? null;
    case "issuingAuthority":
      return document.issuingAuthority ?? null;
    case "title":
      return document.title ?? null;
    default:
      return null;
  }
}

/**
 * Only the fields that need confirming. `reviewEvidence.requiredFields` is the
 * list the backend judged this document against and `missingFields` is what it
 * could not find. There is no per-field confidence in the payload — only a
 * document-level `confidence` and `confidenceThreshold` — so a field that was
 * found carries the document's figure and a missing one carries none.
 */
function reviewFields(document: ArchiveDocument, t: Translate): ReviewField[] {
  const evidence = document.metadata?.reviewEvidence;
  const required = evidence?.requiredFields ?? [];
  const missing = new Set(evidence?.missingFields ?? []);
  const confidence = document.confidence ?? evidence?.confidence ?? null;
  const threshold = evidence?.confidenceThreshold ?? 0.8;

  const names = required.length > 0 ? required : Array.from(missing);
  return names.map((name) => {
    const value = displayFieldValue(document, name);
    const isMissing = missing.has(name) || value === null;
    return {
      name,
      label: fieldLabel(name, t),
      value,
      raw: storedFieldValue(document, name),
      mono: MONO_FIELDS.has(name),
      missing: isMissing,
      low: !isMissing && confidence !== null && confidence < threshold,
      confidence: isMissing ? null : confidence,
    };
  });
}

function confidenceLabel(confidence: number | null, t: Translate) {
  if (confidence === null) {
    return t("review.missingValue");
  }
  return `${Math.round(confidence * 100)}% ${t("review.sure")}`;
}

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
  field: ReviewField | null;
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
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.readerRoot} edges={["top", "bottom"]}>
        <View style={styles.readerBar}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.readerBack}>
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
                  {`${field.label} · ${field.missing ? t("review.missingValue") : confidenceLabel(field.confidence, t)}`}
                </Text>
                <Text
                  style={[
                    styles.pinnedFieldValue,
                    field.mono ? styles.mono : null,
                    field.missing ? styles.amberInk : null,
                  ]}
                  numberOfLines={1}
                >
                  {field.value ?? t("review.missingValue")}
                </Text>
              </View>
              <Pressable onPress={onClose} style={styles.fitsButton}>
                <Text style={styles.fitsButtonText}>{t("review.fits")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
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
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  /**
   * Confirming invalidates `["review"]`, so the refetched queue no longer holds
   * the confirmed document. A numeric cursor into that list would skip the next
   * item — for `[A, B, C]`, confirming A and moving to 1 lands on C once the
   * refetch returns `[B, C]`. Handled ids are tracked instead and filtered out,
   * which is stable across refetches.
   */
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [readerField, setReaderField] = useState<string | null>(null);
  const [readerOpen, setReaderOpen] = useState(false);
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
    queryFn: async () => {
      if (shouldUseCache) {
        return offline.queryCachedDocuments({ reviewOnly: true });
      }

      const response = await auth.authFetch("/api/documents/review?page=1&pageSize=25");
      if (!response.ok) {
        throw new Error(t("review.loadError"));
      }
      return (await response.json()) as ReviewQueueResponse;
    },
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.items),
  });

  const allItems = reviewQuery.data?.items ?? [];
  const items = allItems.filter((item) => !handled.has(item.id));
  const cleared = allItems.length > 0 && items.length === 0;
  const document = items[0] ?? null;
  const position = allItems.length - items.length + (document ? 1 : 0);

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
        send: async (documentId) => {
          const response = await auth.authFetch(`/api/documents/${documentId}/review/resolve`, {
            method: "POST",
          });
          if (!response.ok) {
            throw new Error(await responseToMessage(response));
          }
        },
      })
      .then(async (outcome) => {
        if (outcome === "sent") {
          await queryClient.invalidateQueries({ queryKey: ["review"] });
          await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }
      })
      .catch(() => undefined);
  }, [auth, outbox, queryClient, scope, shouldUseCache]);

  const mutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "resolve" | "requeue" }) => {
      const response = await auth.authFetch(`/api/documents/${id}/review/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "requeue" ? { force: true } : {}),
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["review"] }),
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
  });

  const fields = useMemo(() => (document ? reviewFields(document, t) : []), [document, t]);
  const blocks = textQuery.data?.blocks;

  const activeField =
    fields.find((field) => field.name === readerField) ??
    fields.find((field) => field.missing || field.low) ??
    fields[0] ??
    null;

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
  const uncertainCount = fields.filter((field) => field.missing || field.low).length;

  const advance = useCallback((documentId: string) => {
    setReaderField(null);
    setHandled((current) => new Set(current).add(documentId));
  }, []);

  /** Post the confirm that is still waiting out its window, if there is one. */
  const flushPendingConfirm = useCallback(() => {
    const documentId = pendingConfirm.current;
    pendingConfirm.current = null;
    if (documentId) {
      mutation.mutate({ id: documentId, action: "resolve" });
      // Sent, so it no longer has to survive a kill.
      void outbox.release();
    }
  }, [mutation, outbox]);

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
    flushPendingConfirm();
    offerUndo("skipped", document.id);
    advance(document.id);
  }, [advance, document, flushPendingConfirm, offerUndo]);

  const confirm = useCallback(() => {
    if (!document) return;
    // A confirm still in its window goes now; only one can be taken back.
    flushPendingConfirm();
    pendingConfirm.current = document.id;
    // Written down before the window opens: if the app dies inside it, the next
    // launch sends what the user already watched being accepted.
    if (scope) {
      void outbox.hold({ documentId: document.id, scope });
    }
    offerUndo("confirmed", document.id);
    advance(document.id);
  }, [advance, document, flushPendingConfirm, offerUndo, outbox, scope]);

  /**
   * Back puts the document at the head of the queue again. Nothing was sent, so
   * this is local: drop the pending confirm and stop treating the document as
   * handled. Rewinding by id rather than by position matters — a refetch may
   * have reordered the queue since.
   */
  const undoLast = useCallback(() => {
    if (!undo) return;
    pendingConfirm.current = null;
    // Taken back, so there is nothing to replay.
    void outbox.release();
    setReaderField(null);
    setHandled((current) => {
      const next = new Set(current);
      next.delete(undo.documentId);
      return next;
    });
    closeUndo();
  }, [closeUndo, undo]);

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

  const openReader = useCallback((field?: string) => {
    if (field) {
      setReaderField(field);
    }
    setReaderOpen(true);
  }, []);

  const positionLabel =
    allItems.length === 0 ? "" : `${Math.max(position, 1)} / ${allItems.length}`;
  const progress = allItems.length === 0 ? 1 : handled.size / allItems.length;

  return (
    <Screen
      title={t("review.title")}
      padded={false}
      scroll={false}
      right={positionLabel ? <Text style={styles.position}>{positionLabel}</Text> : undefined}
      notice={shouldUseCache ? <Notice label={t("state.offlineReadOnly")} /> : undefined}
    >
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>

      {reviewQuery.isLoading ? (
        <View style={styles.gutter}>
          <Panel padded>
            <Text style={styles.helper}>{t("review.loading")}</Text>
          </Panel>
        </View>
      ) : null}

      {reviewQuery.isError ? (
        <View style={styles.gutter}>
          <ErrorCard message={t("review.loadError")} onRetry={() => reviewQuery.refetch()} />
        </View>
      ) : null}

      {reviewQuery.data && !document ? (
        <View style={styles.cleared}>
          <View style={styles.clearedBadge}>
            <MaterialCommunityIcons name="check" size={26} color={colors.green} />
          </View>
          <Text style={styles.clearedTitle}>{t("review.emptyTitle")}</Text>
          <Text style={styles.clearedBody}>{t("review.emptyBody")}</Text>
          {cleared ? (
            <Button
              label={t("common.retry")}
              variant="secondary"
              size="sm"
              onPress={() => {
                setHandled(new Set());
                void reviewQuery.refetch();
              }}
            />
          ) : null}
        </View>
      ) : null}

      {document ? (
        <Swipeable
          containerStyle={styles.swipeFill}
          childrenContainerStyle={styles.swipeFill}
          overshootRight={false}
          onSwipeableOpen={(direction) => {
            if (direction === "right") {
              skip();
            }
          }}
          renderRightActions={() => (
            <View style={styles.skipAction}>
              <Text style={styles.skipActionText}>{t("review.skip")}</Text>
            </View>
          )}
        >
          <View style={styles.body}>
            {/* The page, above the fields */}
            <Pressable onPress={() => openReader()} style={styles.previewBand}>
              {passage ? (
                <PassagePaper passage={passage} compact />
              ) : (
                <Text style={styles.previewHint}>{t("review.noText")}</Text>
              )}
              <View style={styles.previewChipLeft}>
                <MaterialCommunityIcons name="arrow-expand" size={11} color={colors.paper} />
                <Text style={styles.previewChipText}>{t("review.wholePage")}</Text>
              </View>
              <View style={styles.previewChipRight}>
                <Text style={styles.previewChipNumber}>
                  {`${passage?.page ?? 1} / ${pageCount}`}
                </Text>
              </View>
            </Pressable>

            <ScrollView contentContainerStyle={styles.fieldScroll}>
              <View style={styles.docHeader}>
                <Text style={styles.docTitle}>{titleForDocument(document)}</Text>
                <Text style={styles.docMeta}>
                  {`${document.correspondent?.name ?? t("review.unfiled")}${document.documentType?.name ? ` · ${document.documentType.name}` : ""}`}
                </Text>
                <View style={styles.reasonRow}>
                  {document.reviewReasons.map((reason) => (
                    <Pill key={reason} label={reviewReasonLabel(reason, t)} tone="warn" />
                  ))}
                </View>
              </View>

              <View style={styles.fieldSectionHeader}>
                <Text style={styles.fieldSectionLabel}>{t("review.toConfirm")}</Text>
                <Text style={styles.fieldSectionNote}>
                  {uncertainCount > 0
                    ? `${uncertainCount} ${t("review.uncertain")}`
                    : fields.length === 0
                      ? // `processing_failed`, `ocr_empty` and `unsupported_format`
                        // carry no field evidence, so "all clear" would invite
                        // confirming a document that plainly needs a look.
                        t("review.noFieldEvidence")
                      : t("review.allClear")}
                </Text>
              </View>

              {fields.map((field) => {
                const flagged = field.missing || field.low;
                return (
                  <View
                    key={field.name}
                    style={[styles.fieldRow, flagged ? styles.fieldRowFlagged : null]}
                  >
                    <View style={styles.fieldTopRow}>
                      <Text style={styles.fieldLabel}>{field.label}</Text>
                      <View
                        style={[
                          styles.confidenceBadge,
                          field.missing
                            ? styles.confidenceMissing
                            : field.low
                              ? styles.confidenceLow
                              : styles.confidenceOk,
                        ]}
                      >
                        <Text
                          style={[
                            styles.confidenceText,
                            field.missing
                              ? styles.confidenceTextMissing
                              : field.low
                                ? styles.confidenceTextLow
                                : styles.confidenceTextOk,
                          ]}
                        >
                          {field.missing ? "–" : `${Math.round((field.confidence ?? 0) * 100)}%`}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.fieldBottomRow}>
                      <Text
                        style={[
                          styles.fieldValue,
                          field.mono ? styles.mono : null,
                          field.missing ? styles.amberInk : null,
                        ]}
                        numberOfLines={1}
                      >
                        {field.value ?? t("review.missingValue")}
                      </Text>
                      {flagged ? (
                        <Pressable onPress={() => openReader(field.name)} hitSlop={10}>
                          <Text style={styles.showLink}>{t("review.showInDocument")}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                );
              })}

              <Pressable
                onPress={() =>
                  navigation.navigate("DocumentDetail", {
                    documentId: document.id,
                    title: titleForDocument(document),
                  })
                }
                style={styles.editRow}
              >
                <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.dim} />
                <Text style={styles.editRowText}>{t("documentDetail.overview.editMetadata")}</Text>
              </Pressable>
            </ScrollView>

            {/* Two actions, pinned */}
            <View style={styles.actionBar}>
              <View style={styles.skipSlot}>
                <Button
                  label={t("review.skip")}
                  variant="secondary"
                  onPress={skip}
                />
              </View>
              <View style={styles.confirmSlot}>
                <Button
                  label={t("review.confirm")}
                  disabled={shouldUseCache}
                  loading={mutation.isPending}
                  onPress={confirm}
                />
              </View>
            </View>
          </View>
        </Swipeable>
      ) : null}

      {undo ? (
        <View style={styles.snackbar}>
          <Text style={styles.snackbarText}>
            {undo.action === "confirmed" ? t("review.undoConfirmed") : t("review.undoSkipped")}
          </Text>
          <Pressable onPress={undoLast} hitSlop={10} style={styles.snackbarAction}>
            <Text style={styles.snackbarActionText}>{t("review.undo")}</Text>
          </Pressable>
        </View>
      ) : null}

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
  helper: {
    ...text.meta,
    color: c.muted,
  },
  mono: {
    ...text.amount,
    fontSize: 14.5,
    lineHeight: 20,
  },
  amberInk: {
    color: c.amber,
  },
  position: {
    ...text.numericMeta,
    color: c.dim,
  },
  progressTrack: {
    height: 2,
    flexShrink: 0,
    backgroundColor: c.sunken,
  },
  progressFill: {
    height: 2,
    backgroundColor: c.accentFill,
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
  },

  /* preview band */
  previewBand: {
    height: 188,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.sunken,
  },
  previewHint: {
    ...text.meta,
    color: c.dim,
    textAlign: "center",
    maxWidth: 260,
  },
  previewChipLeft: {
    position: "absolute",
    left: 16,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 5,
    backgroundColor: c.overlay,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  previewChipRight: {
    position: "absolute",
    right: 16,
    bottom: 12,
    borderRadius: 5,
    backgroundColor: c.overlay,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  previewChipText: {
    ...text.small,
    fontSize: 10.5,
    lineHeight: 14,
    color: c.paper,
  },
  previewChipNumber: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    color: c.paper,
  },


  /* document header and reasons */
  fieldScroll: {
    paddingBottom: 12,
  },
  docHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  docTitle: {
    ...text.rowTitle,
    fontSize: 15,
    color: c.ink,
  },
  docMeta: {
    ...text.meta,
    marginTop: 4,
    color: c.dim,
  },
  reasonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 9,
  },

  /* fields */
  fieldSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.bar,
  },
  fieldSectionLabel: {
    ...text.sectionLabel,
    flex: 1,
    color: c.dim,
  },
  fieldSectionNote: {
    ...text.numeric,
    color: c.faint,
  },
  fieldRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSoft,
  },
  fieldRowFlagged: {
    backgroundColor: c.amberSoft,
  },
  fieldTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldLabel: {
    ...text.small,
    flex: 1,
    color: c.dim,
  },
  fieldBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 5,
  },
  fieldValue: {
    ...text.rowTitle,
    fontSize: 14.5,
    flexShrink: 1,
    color: c.ink,
  },
  showLink: {
    ...text.smallStrong,
    color: c.accent,
  },
  confidenceBadge: {
    flexShrink: 0,
    borderRadius: radii.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  confidenceOk: {
    backgroundColor: c.greenSoft,
  },
  confidenceLow: {
    backgroundColor: c.amberSoft,
  },
  confidenceMissing: {
    borderWidth: 1,
    borderColor: c.borderStrong,
  },
  confidenceText: {
    ...text.numericStrong,
    fontSize: 10,
    lineHeight: 14,
  },
  confidenceTextOk: {
    color: c.green,
  },
  confidenceTextLow: {
    color: c.amber,
  },
  confidenceTextMissing: {
    color: c.faint,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
  },
  editRowText: {
    ...text.meta,
    color: c.dim,
  },

  /* undo */
  snackbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: radii.lg,
    backgroundColor: c.raised,
    borderWidth: 1,
    borderColor: c.border,
    paddingLeft: 12,
    paddingRight: 6,
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
    flexDirection: "row",
    gap: 9,
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  skipSlot: {
    flex: 1,
  },
  confirmSlot: {
    flex: 2,
  },
  skipAction: {
    justifyContent: "center",
    alignItems: "center",
    width: 110,
    backgroundColor: c.raised,
  },
  skipActionText: {
    ...text.smallStrong,
    color: c.muted,
  },

  /* cleared */
  cleared: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 32,
  },
  clearedBadge: {
    height: 54,
    width: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.xl,
    backgroundColor: c.greenSoft,
  },
  clearedTitle: {
    ...text.barTitle,
    color: c.ink,
    textAlign: "center",
  },
  clearedBody: {
    ...text.meta,
    color: c.dim,
    textAlign: "center",
    maxWidth: 250,
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
