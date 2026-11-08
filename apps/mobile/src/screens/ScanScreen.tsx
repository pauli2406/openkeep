import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useNavigation } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  applyPatch,
  canClearFinished,
  classifyFile,
  clearFinished,
  createItem,
  fetchDocumentStatus,
  fetchWatchFolder,
  formatFileSize,
  IMPORT_CONCURRENCY,
  IMPORT_MIME_TYPES,
  IMPORT_POLL_INTERVAL_MS,
  isFinished,
  isInFlight,
  isRetryable,
  patchFromDocument,
  pickedUpToday,
  processItem,
  queueCounts,
  runBounded,
  stageProgress,
  type ImportItem,
  type ImportPatch,
  type ImportStage,
  type PickedFile,
} from "../api/import";
import { useAuth } from "../auth";
import { Gradient, IconTile } from "../components/layout";
import {
  Button,
  ErrorCard,
  Field,
  Notice,
  Panel,
  Pill,
  Row,
  Screen,
} from "../components/ui";
import { useI18n, type TranslationKey } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import { createPdfFromImages } from "../lib";

type ScannerModule = {
  scanDocument: (options?: {
    responseType?: string;
    maxNumDocuments?: number;
    croppedImageQuality?: number;
  }) => Promise<{
    status?: string;
    scannedImages?: string[];
  }>;
};

function getScannerModule(): ScannerModule | null {
  const turboModule = TurboModuleRegistry.get("DocumentScanner") as ScannerModule | null;
  if (turboModule) {
    return turboModule;
  }

  const legacyModule = (NativeModules as Record<string, unknown>).DocumentScanner;
  if (legacyModule && typeof legacyModule === "object") {
    return legacyModule as ScannerModule;
  }

  return null;
}

type DraftPage = {
  id: string;
  uri: string;
};

const STAGE_LABELS: Partial<Record<ImportStage, TranslationKey>> = {
  upload: "import.stageUpload",
  ocr: "import.stageOcr",
  extract: "import.stageExtract",
  embed: "import.stageEmbed",
};

const PIPELINE: Array<{ icon: string; title: TranslationKey; hint: TranslationKey }> = [
  { icon: "file-document-outline", title: "import.stageUpload", hint: "import.stepUploadHint" },
  { icon: "text-recognition", title: "import.stageOcr", hint: "import.stepOcrHint" },
  { icon: "creation", title: "import.stageExtract", hint: "import.stepExtractHint" },
  { icon: "magnify", title: "import.stageEmbed", hint: "import.stepEmbedHint" },
];

/** The tile at the head of a row carries the row's outcome at a glance. */
function OutcomeTile({ stage }: { stage: ImportStage }) {
  const styles = useStyles();
  const colors = useColors();
  if (stage === "done") {
    return (
      <View style={[styles.outcomeTile, styles.outcomeDone]}>
        <MaterialCommunityIcons name="check-circle-outline" size={18} color={colors.green} />
      </View>
    );
  }
  if (stage === "failed") {
    return (
      <View style={[styles.outcomeTile, styles.outcomeFailed]}>
        <MaterialCommunityIcons name="alert-outline" size={18} color={colors.red} />
      </View>
    );
  }
  if (stage === "duplicate") {
    return (
      <View style={[styles.outcomeTile, styles.outcomeDuplicate]}>
        <MaterialCommunityIcons name="content-copy" size={18} color={colors.amber} />
      </View>
    );
  }
  return (
    <IconTile>
      <MaterialCommunityIcons name="file-outline" size={18} color={colors.accentSoftInk} />
    </IconTile>
  );
}

/** How far along a file is, or what became of it. */
function RowStatus({
  item,
  onOpenOriginal,
}: {
  item: ImportItem;
  onOpenOriginal: (documentId: string) => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();

  if (item.stage === "duplicate") {
    const originalId = item.duplicateOfId;
    return (
      <View style={styles.duplicateLine}>
        <Text style={styles.duplicateText}>{t("import.alreadyInArchive")}</Text>
        {originalId ? (
          <>
            <Text style={styles.duplicateText}>·</Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => onOpenOriginal(originalId)}
              hitSlop={14}
            >
              <Text style={styles.duplicateLink}>{t("import.openOriginal")}</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    );
  }
  if (item.stage === "failed") {
    return <Text style={styles.failedText}>{item.errorMessage ?? t("import.failed")}</Text>;
  }
  if (item.stage === "done") {
    return item.typeName ? (
      <Text style={styles.filedText} numberOfLines={1}>
        {`${t("import.filedAs")} ${item.typeName}`}
      </Text>
    ) : null;
  }

  const labelKey = STAGE_LABELS[item.stage];
  const label = labelKey ? t(labelKey) : "";
  const progress = stageProgress(item.stage);
  return (
    <View style={styles.progressRow}>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
        style={styles.progressTrack}
      >
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
      </View>
      <Text style={styles.progressLabel}>{label}</Text>
    </View>
  );
}

function QueueRow({
  item,
  last,
  canRetry,
  onRetry,
  onOpen,
  onOpenOriginal,
  onOpenReview,
}: {
  item: ImportItem;
  last: boolean;
  canRetry: boolean;
  onRetry: () => void;
  onOpen: (documentId: string) => void;
  onOpenOriginal: (documentId: string) => void;
  onOpenReview: () => void;
}) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const meta = [
    item.size !== null ? formatFileSize(item.size) : null,
    item.pageCount !== null
      ? `${item.pageCount} ${item.pageCount === 1 ? t("import.page") : t("import.pages")}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const name = item.title?.trim() || item.name;
  const openable = item.documentId && (item.stage === "done" || item.stage === "duplicate");

  return (
    <View style={[styles.queueRow, last ? null : styles.queueRowRule]}>
      <OutcomeTile stage={item.stage} />
      <View style={styles.queueRowBody}>
        <View style={styles.queueRowHead}>
          <View style={styles.queueRowText}>
            {openable ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => onOpen(item.documentId as string)}
                hitSlop={8}
              >
                <Text style={styles.queueRowName} numberOfLines={1}>
                  {name}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.queueRowName} numberOfLines={1}>
                {name}
              </Text>
            )}
            {meta ? <Text style={styles.queueRowMeta}>{meta}</Text> : null}
          </View>
          {isRetryable(item) ? (
            <Button
              label={t("import.retry")}
              variant="secondary"
              size="sm"
              disabled={!canRetry}
              onPress={onRetry}
            />
          ) : item.stage === "failed" ? null : item.stage === "done" && item.needsReview ? (
            <Pressable accessibilityRole="link" onPress={onOpenReview} hitSlop={12}>
              <Pill label={t("import.review")} tone="warn" />
            </Pressable>
          ) : item.stage === "done" ? (
            <Pill label={t("import.done")} tone="ok" />
          ) : item.stage === "duplicate" ? (
            <Pill label={t("import.duplicate")} tone="warn" />
          ) : (
            <View style={styles.processingBadge}>
              <ActivityIndicator size="small" color={colors.muted} />
              <Pill label={t("import.processing")} />
            </View>
          )}
        </View>
        <RowStatus item={item} onOpenOriginal={onOpenOriginal} />
      </View>
    </View>
  );
}

/**
 * Import, the web's upload page on a phone. The drop zone becomes a card with the
 * two things a phone has instead of a desktop to drag from: the OS scanner and the
 * file picker. Several files go straight into the queue; one file, or anything
 * scanned, stops at a draft first, because that is where its title can be set.
 */
export function ScanScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t, language } = useI18n();
  const offline = useOfflineArchive();
  const insets = useSafeAreaInsets();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [draftFile, setDraftFile] = useState<PickedFile | null>(null);
  const [error, setError] = useState("");
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<ImportItem[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // "Cancel all" aborts this and replaces it. Workers check it before taking the
  // next file, so clearing the list stops the uploads rather than hiding their rows.
  const cancelRef = useRef(new AbortController());

  // The queue belongs to the session that started it. `authFetch` reads the current
  // server and credentials on every call, so work left running into a new sign-in
  // would upload the rest into that archive. Leaving the screen, or the session
  // changing under it, stops what has not started; nothing tracks it afterwards.
  const sessionKey = `${auth.apiUrl}|${auth.user?.id ?? ""}`;
  const sessionRef = useRef(sessionKey);
  useEffect(() => {
    if (sessionRef.current === sessionKey) return;
    sessionRef.current = sessionKey;
    cancelRef.current.abort();
    cancelRef.current = new AbortController();
    setQueue([]);
  }, [sessionKey]);
  useEffect(() => () => cancelRef.current.abort(), []);

  // Sizes come from the filesystem, once per draft page.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      pages.map(async (page) => {
        try {
          const info = await FileSystem.getInfoAsync(page.uri);
          return [page.id, info.exists ? (info.size ?? 0) : 0] as const;
        } catch {
          return [page.id, 0] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setSizes(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pages]);

  const watchQuery = useQuery({
    queryKey: ["archive", "watch-folder", "status", auth.apiUrl],
    enabled: !shouldUseCache,
    queryFn: () => fetchWatchFolder(auth.authFetch),
    staleTime: 60_000,
    retry: false,
  });

  const patch = useCallback((id: string, changes: ImportPatch) => {
    setQueue((current) => applyPatch(current, id, changes));
  }, []);

  const refreshArchive = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["review"] }),
      ]),
    [queryClient],
  );

  const run = useCallback(
    async (item: ImportItem) => {
      const outcome = await processItem(item, {
        authFetch: auth.authFetch,
        buildPdf: createPdfFromImages,
        failedMessage: t("scan.uploadFailed"),
        signal: cancelRef.current.signal,
      });
      // A cancelled row is gone from the list, so this finds nothing to change.
      patch(item.id, outcome);
    },
    [auth.authFetch, patch, t],
  );

  const enqueue = useCallback(
    (items: ImportItem[]) => {
      if (items.length === 0) {
        return;
      }
      setQueue((current) => [...current, ...items]);
      const { signal } = cancelRef.current;
      void runBounded(
        items.filter((item) => item.source !== null),
        IMPORT_CONCURRENCY,
        () => signal.aborted,
        run,
      ).then(refreshArchive);
    },
    [refreshArchive, run],
  );

  const retry = useCallback(
    (item: ImportItem) => {
      patch(item.id, {
        stage: item.documentId ? "ocr" : "upload",
        errorMessage: undefined,
      });
      void run(item).then(refreshArchive);
    },
    [patch, refreshArchive, run],
  );

  // Poll in-flight documents so each row progresses independently.
  const hasInFlight = queue.some(isInFlight);
  useEffect(() => {
    if (!hasInFlight || shouldUseCache) {
      return;
    }
    const interval = setInterval(() => {
      for (const item of queueRef.current.filter(isInFlight)) {
        fetchDocumentStatus(auth.authFetch, item.documentId as string)
          .then((document) => {
            const next = document
              ? patchFromDocument(document, {
                  failed: t("import.failed"),
                  embeddingFailed: t("import.embeddingFailed"),
                })
              : null;
            if (next) {
              patch(item.id, next);
              if (next.stage && isFinished(next.stage)) {
                void refreshArchive();
              }
            }
          })
          // A transient poll failure keeps the current stage.
          .catch(() => undefined);
      }
    }, IMPORT_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [auth.authFetch, hasInFlight, patch, refreshArchive, shouldUseCache, t]);

  function clearDraft() {
    setTitle("");
    setPages([]);
    setDraftFile(null);
    setError("");
  }

  function uploadDraft() {
    if (shouldUseCache) {
      return;
    }
    const trimmed = title.trim() || null;
    if (draftFile) {
      enqueue([
        createItem({
          name: draftFile.name,
          size: draftFile.size ?? null,
          title: trimmed,
          source: { kind: "file", file: draftFile },
        }),
      ]);
    } else if (pages.length > 0) {
      enqueue([
        createItem({
          name: `openkeep-scan-${Date.now()}.pdf`,
          title: trimmed,
          pageCount: pages.length,
          source: { kind: "pages", uris: pages.map((page) => page.uri) },
        }),
      ]);
    } else {
      setError(t("scan.addBeforeUpload"));
      return;
    }
    clearDraft();
  }

  function askDiscardDraft() {
    if (pages.length === 0) {
      clearDraft();
      return;
    }
    Alert.alert(t("import.discard"), `${pages.length} ${t("scan.pages")}`, [
      { text: t("settings.cancel"), style: "cancel" },
      { text: t("import.discard"), style: "destructive", onPress: clearDraft },
    ]);
  }

  async function ensureAndroidCameraPermission() {
    if (Platform.OS !== "android") {
      return true;
    }

    const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async function handleScan() {
    setError("");
    if (!(await ensureAndroidCameraPermission())) {
      setError(t("scan.cameraPermission"));
      return;
    }

    const scanner = getScannerModule();
    if (!scanner) {
      setError(t("scan.scannerUnavailable"));
      return;
    }

    const result = await scanner.scanDocument({
      responseType: "imageFilePath",
      maxNumDocuments: Platform.OS === "android" ? 12 : undefined,
      croppedImageQuality: 92,
    });

    if (result.status === "cancel") {
      return;
    }

    const scannedImages = result.scannedImages ?? [];
    if (scannedImages.length > 0) {
      setDraftFile(null);
      setPages(
        scannedImages.map((uri: string, index: number) => ({ id: `${Date.now()}-${index}`, uri })),
      );
    }
  }

  async function handlePickImages() {
    setError("");
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*"],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return;
    }

    setDraftFile(null);
    setPages(
      result.assets.map((asset, index) => ({ id: `${asset.name}-${index}`, uri: asset.uri })),
    );
  }

  async function handleChooseFiles() {
    setError("");
    const result = await DocumentPicker.getDocumentAsync({
      type: IMPORT_MIME_TYPES,
      // Offline a draft is all this can become, and a draft is one file.
      multiple: !shouldUseCache,
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return;
    }

    const files: PickedFile[] = result.assets.map((asset) => ({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size,
    }));
    if (files.length === 1 && classifyFile(files[0]) === "ok") {
      setPages([]);
      setDraftFile(files[0]);
      return;
    }

    enqueue(
      files.map((file) => {
        const verdict = classifyFile(file);
        return verdict === "ok"
          ? createItem({
              name: file.name,
              size: file.size ?? null,
              source: { kind: "file", file },
            })
          : createItem({
              name: file.name,
              size: file.size ?? null,
              source: null,
              stage: "failed",
              errorMessage:
                verdict === "oversized"
                  ? t("import.oversized")
                  : t("import.unsupportedFormat"),
            });
      }),
    );
  }

  function removePage(id: string) {
    setPages((current) => current.filter((page) => page.id !== id));
  }

  function cancelAll() {
    cancelRef.current.abort();
    cancelRef.current = new AbortController();
    setQueue([]);
  }

  const openDocument = (documentId: string) =>
    navigation.navigate("DocumentDetail", { documentId });

  const counts = queueCounts(queue);
  const summary = [
    counts.processing ? `${counts.processing} ${t("import.processing").toLowerCase()}` : null,
    counts.done ? `${counts.done} ${t("import.done").toLowerCase()}` : null,
    counts.duplicate ? `${counts.duplicate} ${t("import.duplicate").toLowerCase()}` : null,
    counts.failed ? `${counts.failed} ${t("import.failed").toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const hasDraft = pages.length > 0 || draftFile !== null;
  const watch = watchQuery.data;
  const lastScan = watch?.lastImport ?? null;
  const pickedUp = watch ? pickedUpToday(watch) : 0;
  const watchMeta = [
    lastScan
      ? `${t("import.lastScan")} ${new Date(lastScan.scannedAt).toLocaleTimeString(
          language === "de" ? "de-DE" : "en-GB",
          { hour: "2-digit", minute: "2-digit" },
        )}`
      : null,
    pickedUp > 0 ? `${pickedUp} ${t("import.pickedUpToday")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen
      title={t("import.title")}
      onBack={() => navigation.goBack()}
      notice={shouldUseCache ? <Notice label={t("state.offlineScan")} tone="warn" /> : undefined}
      contentContainerStyle={{ paddingBottom: 28 + insets.bottom }}
    >
      <Text style={styles.subtitle}>{t("import.subtitle")}</Text>

      {hasDraft ? (
        /* What was captured, what it will be called, and the one thing to do next. */
        <Panel style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>
              {draftFile ? t("import.selectedFile") : t("scan.capturedPages")}
            </Text>
            {pages.length > 0 ? (
              <>
                <Pill label={String(pages.length)} tone="soft" />
                <View style={styles.cardHeadEnd}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void handleScan()}
                    hitSlop={14}
                  >
                    <Text style={styles.headerLink}>{t("scan.rescan")}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>

          <View style={styles.draftTitle}>
            <Field
              label={t("scan.titleOptional")}
              value={title}
              onChangeText={setTitle}
              placeholder={t("scan.titleDetected")}
            />
          </View>

          {pages.map((page, index) => (
            <Row
              key={page.id}
              minHeight={72}
              leading={<Image source={{ uri: page.uri }} style={styles.thumb} />}
              title={`${t("scan.page")} ${index + 1}`}
              meta={sizes[page.id] ? formatFileSize(sizes[page.id]) : undefined}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("scan.removePage")}
                  onPress={() => removePage(page.id)}
                  hitSlop={12}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={19} color={colors.red} />
                </Pressable>
              }
            />
          ))}

          {draftFile ? (
            <Row
              minHeight={62}
              leading={
                <IconTile>
                  <MaterialCommunityIcons
                    name="file-document-outline"
                    size={18}
                    color={colors.accentSoftInk}
                  />
                </IconTile>
              }
              title={draftFile.name}
              meta={draftFile.size ? formatFileSize(draftFile.size) : undefined}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("scan.shareCopy")}
                  onPress={() => void Sharing.shareAsync(draftFile.uri)}
                  hitSlop={12}
                >
                  <MaterialCommunityIcons
                    name="share-variant-outline"
                    size={18}
                    color={colors.muted}
                  />
                </Pressable>
              }
            />
          ) : null}

          <View style={styles.draftActions}>
            <Button
              label={
                draftFile
                  ? draftFile.name.toLowerCase().endsWith(".pdf")
                    ? t("scan.uploadPdfFile")
                    : t("import.uploadFile")
                  : t("scan.createAndUpload")
              }
              icon="tray-arrow-up"
              disabled={shouldUseCache}
              onPress={uploadDraft}
            />
            {pages.length > 0 ? (
              <Text style={styles.draftNote}>
                {`${pages.length} ${t("scan.pages")} → ${t("scan.toOnePdf")}`}
              </Text>
            ) : null}
            <Button label={t("import.discard")} variant="ghost" onPress={askDiscardDraft} />
          </View>
        </Panel>
      ) : (
        <View style={[styles.dropzone, queue.length > 0 ? styles.dropzoneCompact : null]}>
          <Gradient name="wash" borderRadius={radii.xxl} style={StyleSheet.absoluteFill} />
          {/*
            Its own layer, not a border on the gradient: on Android the gradient
            paints over its own view's border.
          */}
          <View pointerEvents="none" style={styles.dropzoneBorder} />
          <IconTile size="xl" tone="solid">
            <MaterialCommunityIcons name="tray-arrow-up" size={28} color={colors.onGradient} />
          </IconTile>
          <View style={styles.dropzoneText}>
            <Text style={styles.dropzoneTitle}>{t("import.addTitle")}</Text>
            {shouldUseCache ? null : (
              <Text style={styles.dropzoneHint}>{t("import.dropHint")}</Text>
            )}
          </View>
          <View style={styles.dropzoneButtons}>
            <View style={styles.dropzoneButton}>
              <Button
                label={t("import.scan")}
                icon="line-scan"
                onPress={() => void handleScan()}
              />
            </View>
            <View style={styles.dropzoneButton}>
              <Button
                label={t("import.chooseFiles")}
                icon="file-outline"
                variant="secondary"
                onPress={() => void handleChooseFiles()}
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => void handlePickImages()}
            style={styles.imagesLink}
          >
            <MaterialCommunityIcons name="image-outline" size={16} color={colors.accent} />
            <Text style={styles.imagesLinkText}>{t("scan.pickImages")}</Text>
            <Text style={styles.imagesLinkHint}>{t("import.imagesHint")}</Text>
          </Pressable>
        </View>
      )}

      {error ? <ErrorCard message={error} /> : null}

      {watch?.configuredPath ? (
        <Panel style={styles.watchCard}>
          <IconTile>
            <MaterialCommunityIcons
              name="folder-sync-outline"
              size={18}
              color={colors.accentSoftInk}
            />
          </IconTile>
          <View style={styles.watchText}>
            <Text style={styles.watchNote}>
              {`${t("import.watchNote")} `}
              <Text style={styles.watchPath}>{watch.configuredPath}</Text>
              {` ${t("import.watchNoteTail")}`}
            </Text>
            {watchMeta ? <Text style={styles.watchMeta}>{watchMeta}</Text> : null}
          </View>
        </Panel>
      ) : null}

      {queue.length > 0 ? (
        <>
          <Panel style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t("import.queue")}</Text>
              <Pill label={String(queue.length)} tone="soft" />
              {canClearFinished(queue) ? (
                <View style={styles.cardHeadEnd}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setQueue(clearFinished)}
                    hitSlop={14}
                  >
                    <Text style={styles.headerLink}>{t("import.clearFinished")}</Text>
                  </Pressable>
                </View>
              ) : null}
              <Text style={styles.queueSummary}>{summary}</Text>
            </View>
            {queue.map((item, index) => (
              <QueueRow
                key={item.id}
                item={item}
                last={index === queue.length - 1}
                canRetry={!shouldUseCache}
                onRetry={() => retry(item)}
                onOpen={openDocument}
                onOpenOriginal={openDocument}
                onOpenReview={() => navigation.popTo("Home", { screen: "Review" } as never)}
              />
            ))}
          </Panel>

          <View style={styles.queueActions}>
            <View style={styles.queueAction}>
              <Button label={t("import.cancelAll")} variant="secondary" onPress={cancelAll} />
            </View>
            <View style={styles.queueAction}>
              <Button
                label={t("import.done")}
                onPress={() => navigation.popTo("Home", { screen: "Documents" } as never)}
              />
            </View>
          </View>
        </>
      ) : shouldUseCache || hasDraft ? null : (
        <View accessibilityLabel={t("import.stepsTitle")} style={styles.pipeline}>
          {PIPELINE.map((step) => (
            <View key={step.title} style={styles.pipelineStep}>
              <IconTile size="sm">
                <MaterialCommunityIcons
                  name={step.icon as never}
                  size={15}
                  color={colors.accentSoftInk}
                />
              </IconTile>
              <View style={styles.pipelineText}>
                <Text style={styles.pipelineTitle}>{t(step.title)}</Text>
                <Text style={styles.pipelineHint}>{t(step.hint)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  subtitle: {
    ...text.body,
    color: c.muted,
  },

  /* the drop zone's place */
  dropzone: {
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 16,
    overflow: "hidden",
    borderRadius: radii.xxl,
  },
  dropzoneCompact: {
    minHeight: 0,
    gap: 12,
    paddingTop: 20,
    paddingBottom: 8,
  },
  dropzoneBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radii.xxl,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: c.accent,
    // The web's `border-brand/25`. Only the border draws here, so this is its alpha.
    opacity: 0.3,
  },
  dropzoneText: {
    alignItems: "center",
    gap: 4,
  },
  dropzoneTitle: {
    ...text.barTitle,
    fontSize: 18,
    lineHeight: 24,
    color: c.ink,
    textAlign: "center",
  },
  dropzoneHint: {
    ...text.body,
    color: c.muted,
    textAlign: "center",
  },
  dropzoneButtons: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: 8,
  },
  dropzoneButton: {
    flex: 1,
    minWidth: 0,
  },
  imagesLink: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 44,
  },
  imagesLinkText: {
    ...text.bodyStrong,
    color: c.accent,
  },
  imagesLinkHint: {
    ...text.meta,
    color: c.muted,
  },

  /* cards */
  card: {
    overflow: "hidden",
  },
  cardHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  cardHeadEnd: {
    marginLeft: "auto",
  },
  cardTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  headerLink: {
    ...text.smallStrong,
    color: c.accent,
  },

  /* the draft */
  draftTitle: {
    padding: 16,
  },
  thumb: {
    width: 40,
    height: 56,
    flexShrink: 0,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: c.paperBorder,
    backgroundColor: c.paper,
  },
  draftActions: {
    gap: 8,
    padding: 16,
  },
  draftNote: {
    ...text.numeric,
    color: c.muted,
    textAlign: "center",
  },

  /* the watch folder */
  watchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  watchText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  watchNote: {
    ...text.body,
    color: c.ink,
  },
  watchPath: {
    ...text.mono,
    color: c.ink,
  },
  watchMeta: {
    ...text.numeric,
    color: c.muted,
  },

  /* the queue */
  queueSummary: {
    ...text.meta,
    flexBasis: "100%",
    color: c.muted,
  },
  queueRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  queueRowRule: {
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  queueRowBody: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  queueRowHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  queueRowText: {
    flex: 1,
    minWidth: 0,
  },
  queueRowName: {
    ...text.rowTitle,
    color: c.ink,
  },
  queueRowMeta: {
    ...text.numeric,
    color: c.muted,
  },
  processingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  outcomeTile: {
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: radii.md,
  },
  outcomeDone: {
    backgroundColor: c.greenSoft,
  },
  outcomeFailed: {
    backgroundColor: c.redSoft,
  },
  outcomeDuplicate: {
    backgroundColor: c.amberSoft,
  },
  duplicateLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
  },
  duplicateText: {
    ...text.meta,
    color: c.amber,
  },
  duplicateLink: {
    ...text.metaStrong,
    color: c.amber,
    textDecorationLine: "underline",
  },
  failedText: {
    ...text.meta,
    color: c.red,
  },
  filedText: {
    ...text.meta,
    color: c.muted,
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  progressTrack: {
    flex: 1,
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
  progressLabel: {
    ...text.meta,
    width: 64,
    color: c.muted,
    textAlign: "right",
  },
  queueActions: {
    flexDirection: "row",
    gap: 8,
  },
  queueAction: {
    flex: 1,
    minWidth: 0,
  },

  /* the pipeline */
  pipeline: {
    gap: 14,
    paddingTop: 4,
  },
  pipelineStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  pipelineText: {
    flex: 1,
    minWidth: 0,
  },
  pipelineTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  pipelineHint: {
    ...text.meta,
    color: c.muted,
  },
}));
