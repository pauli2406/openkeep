import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import FileViewer from "react-native-file-viewer";
import Pdf, { type PdfRef } from "react-native-pdf";
import { Buffer } from "buffer";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useI18n } from "../i18n";
import { createThemedStyles, radii, raisedShadow, useColors } from "../theme";
import { fonts, text } from "../typography";
import { IconTile, Skeleton } from "./layout";
import { Button, EmptyState } from "./ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ViewerProps = {
  /** Authenticated fetch function from auth context. */
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  documentId: string;
  mimeType: string;
  searchablePdfAvailable: boolean;
  localFileUri?: string | null;
  hasLocalFile?: boolean;
  offlineMode?: boolean;
  canFetchOnline?: boolean;
  onPersistOnlineFile?: () => Promise<string | null>;
  /** Pre-fetched OCR text blocks (optional). Falls back to fetching. */
  textBlocks?: Array<{ page: number; text: string }>;
  /**
   * 1-based page to show, for callers that render their own page bar. The
   * viewer still owns the PDF; this only tells it where to go.
   */
  page?: number;
  onPageChange?: (page: number) => void;
  onTotalPagesChange?: (total: number) => void;
  /**
   * The detail screen's pane draws its own toolbar, so here the viewer is only
   * the page: it fills its parent and brings no navigator or share button.
   */
  embedded?: boolean;
  /** Percent. Only `embedded` honours it: elsewhere pinching is the only zoom. */
  zoom?: number;
  /** What a pinch settled on, so a toolbar can show it. Never fed back into `zoom`. */
  onZoomSettled?: (percent: number) => void;
  /** The local file now on screen, or null while there is none. */
  onFileReady?: (uri: string | null) => void;
  /** The offline copy is still being decrypted: wait for it rather than give up. */
  localFilePending?: boolean;
};

type FileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; uri: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
];

function isImage(mimeType: string) {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType);
}

function isPdf(mimeType: string) {
  return mimeType === "application/pdf";
}

function isText(mimeType: string) {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  );
}

function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "image/tiff": ".tiff",
    "text/plain": ".txt",
    "text/html": ".html",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/xml": ".xml",
  };
  return map[mimeType] ?? "";
}

/**
 * Whether a local file is there. `getInfoAsync` has no browser implementation, and
 * the visual build's offline copy is a fixture path: there it counts as present, so
 * the offline state renders the page rather than a platform error.
 */
function localFileExists(uri: string) {
  return FileSystem.getInfoAsync(uri).then(
    (info) => info.exists,
    () => Platform.OS === "web",
  );
}

/** Hands a file to the OS viewer, which has the zoom and search this view lacks. */
export function openInNativeViewer(uri: string, displayName: string) {
  return FileViewer.open(uri, {
    displayName,
    showAppsSuggestions: true,
    showOpenWithDialog: false,
  });
}

// ---------------------------------------------------------------------------
// PDF Loading Progress Indicator
// ---------------------------------------------------------------------------

function PdfProgressBar({ progress }: { progress: number }) {
  const progressStyles = useProgressStyles();
  const pct = Math.max(0, Math.min(1, progress));
  return (
    <View style={progressStyles.container}>
      <View style={progressStyles.track}>
        <View style={[progressStyles.fill, { width: `${pct * 100}%` }]} />
      </View>
      <Text style={progressStyles.label}>{`${Math.round(pct * 100)}%`}</Text>
    </View>
  );
}

const useProgressStyles = createThemedStyles((c) => ({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 10,
  },
  track: {
    width: 140,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: c.raised,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radii.pill,
    backgroundColor: c.accentFill,
  },
  label: {
    fontSize: 12,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
  },
}));

// ---------------------------------------------------------------------------
// Page Navigation Bar
// ---------------------------------------------------------------------------

function PageNavigator({
  currentPage,
  totalPages,
  onPrev,
  onNext,
  onOpenFullscreen,
  pageLabel,
  ofLabel,
}: {
  currentPage: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  onOpenFullscreen: () => void;
  pageLabel: string;
  ofLabel: string;
}) {
  const colors = useColors();
  const navStyles = useNavStyles();
  const isFirst = currentPage <= 1;
  const isLast = currentPage >= totalPages;

  return (
    <View style={navStyles.container}>
      {/* Prev */}
      <Pressable
        onPress={onPrev}
        disabled={isFirst}
        style={({ pressed }) => [
          navStyles.navButton,
          isFirst && navStyles.navButtonDisabled,
          pressed && !isFirst && navStyles.navButtonPressed,
        ]}
        hitSlop={8}
      >
        <MaterialCommunityIcons
          name="chevron-left"
          size={20}
          color={isFirst ? colors.faint : colors.accent}
        />
      </Pressable>

      {/* Page indicator */}
      <View style={navStyles.pageInfo}>
        <Text style={navStyles.pageText}>
          {`${pageLabel} ${currentPage} ${ofLabel} ${totalPages}`}
        </Text>
      </View>

      {/* Next */}
      <Pressable
        onPress={onNext}
        disabled={isLast}
        style={({ pressed }) => [
          navStyles.navButton,
          isLast && navStyles.navButtonDisabled,
          pressed && !isLast && navStyles.navButtonPressed,
        ]}
        hitSlop={8}
      >
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isLast ? colors.faint : colors.accent}
        />
      </Pressable>

      {/* Fullscreen button */}
      <Pressable
        onPress={onOpenFullscreen}
        style={({ pressed }) => [
          navStyles.fullscreenButton,
          pressed && navStyles.navButtonPressed,
        ]}
        hitSlop={8}
      >
        <MaterialCommunityIcons name="fullscreen" size={20} color={colors.accent} />
      </Pressable>
    </View>
  );
}

const useNavStyles = createThemedStyles((c) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    gap: 6,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  navButtonDisabled: {
    backgroundColor: c.raised,
    opacity: 0.5,
  },
  navButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },
  pageInfo: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pageText: {
    fontSize: 13,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  fullscreenButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: c.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
}));

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function DocumentViewer({
  authFetch,
  documentId,
  mimeType,
  searchablePdfAvailable,
  localFileUri,
  hasLocalFile = Boolean(localFileUri),
  offlineMode = false,
  canFetchOnline = true,
  onPersistOnlineFile,
  textBlocks,
  page,
  onPageChange,
  onTotalPagesChange,
  embedded = false,
  zoom = 100,
  onZoomSettled,
  onFileReady,
  localFilePending = false,
}: ViewerProps) {
  const colors = useColors();
  const styles = useStyles();
  const { t } = useI18n();
  const [fileState, setFileState] = useState<FileState>({ status: "idle" });
  const [textContent, setTextContent] = useState<string | null>(null);
  const lastLoadedUriRef = useRef<string | null>(null);

  // PDF-specific state
  const pdfRef = useRef<PdfRef>(null);
  const [currentPage, setCurrentPage] = useState(page ?? 1);
  const [totalPages, setTotalPages] = useState(0);
  const [loadProgress, setLoadProgress] = useState(0);
  const [openingNativeViewer, setOpeningNativeViewer] = useState(false);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  // Android rebuilds the whole PDF view when `scale` changes and starts it from the
  // `page` prop, so that prop has to say where the reader is at that moment. It is
  // otherwise left alone: page jumps go through `setPage`, which does not reload.
  const pdfStartPage = useRef(page ?? 1);
  const lastZoom = useRef(zoom);
  if (lastZoom.current !== zoom) {
    lastZoom.current = zoom;
    pdfStartPage.current = currentPage;
  }

  const canPreview = isPdf(mimeType) || isImage(mimeType) || isText(mimeType);

  useEffect(() => {
    setFileState({ status: "idle" });
    setTextContent(null);
    lastLoadedUriRef.current = null;
    setCurrentPage(page ?? 1);
    setTotalPages(0);
    setLoadProgress(0);
  }, [documentId, mimeType]);

  // The offline copy arrives after the first render. Anything shown until then,
  // including "not available", was a verdict on a file that had not been asked for.
  useEffect(() => {
    if (!localFileUri) {
      return;
    }
    setFileState((current) =>
      current.status === "ready" && current.uri === localFileUri ? current : { status: "idle" },
    );
  }, [localFileUri]);

  useEffect(() => {
    onFileReady?.(fileState.status === "ready" && fileState.uri ? fileState.uri : null);
  }, [fileState, onFileReady]);

  // Download file to local cache for PDF/image rendering
  const downloadFile = useCallback(async () => {
    if (localFileUri && fileState.status === "ready" && fileState.uri === localFileUri) {
      return;
    }

    setFileState({ status: "loading" });
    try {
      if (localFileUri) {
        if (await localFileExists(localFileUri)) {
          lastLoadedUriRef.current = localFileUri;
          setFileState({ status: "ready", uri: localFileUri });
          return;
        }
      }

      if (!canFetchOnline) {
        throw new Error(t("documentViewer.shareOfflineMissing"));
      }

      // For PDFs, prefer searchable version when available
      const uri = onPersistOnlineFile
        ? await onPersistOnlineFile()
        : await (async () => {
            const endpoint =
              isPdf(mimeType) && searchablePdfAvailable
                ? `/api/documents/${documentId}/download/searchable`
                : `/api/documents/${documentId}/download`;

            const response = await authFetch(endpoint);
            if (!response.ok) {
              throw new Error(`Download failed (${response.status})`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const ext = extensionForMime(mimeType);
            const nextUri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}openkeep-preview-${documentId}${ext}`;
            await FileSystem.writeAsStringAsync(
              nextUri,
              Buffer.from(arrayBuffer).toString("base64"),
              { encoding: FileSystem.EncodingType.Base64 },
            );
            return nextUri;
          })();
      if (!uri) {
        throw new Error(t("documentViewer.downloadFailed"));
      }
      lastLoadedUriRef.current = uri;
      setFileState({ status: "ready", uri });
    } catch (err) {
        setFileState({
          status: "error",
          message: err instanceof Error ? err.message : t("documentViewer.downloadFailed"),
        });
      }
  }, [authFetch, canFetchOnline, documentId, hasLocalFile, localFileUri, mimeType, offlineMode, onPersistOnlineFile, searchablePdfAvailable, t]);

  // For text files, fetch as text
  const fetchText = useCallback(async () => {
    if (localFileUri && fileState.status === "ready" && fileState.uri === localFileUri && textContent !== null) {
      return;
    }

    setFileState({ status: "loading" });
    try {
      if (localFileUri) {
        const info = await FileSystem.getInfoAsync(localFileUri);
        if (info.exists) {
          const text = await FileSystem.readAsStringAsync(localFileUri);
          setTextContent(text);
          lastLoadedUriRef.current = localFileUri;
          setFileState({ status: "ready", uri: localFileUri });
          return;
        }
      }

      if (!canFetchOnline) {
        throw new Error(t("documentViewer.shareOfflineMissing"));
      }

      if (onPersistOnlineFile) {
        const uri = await onPersistOnlineFile();
        if (!uri) {
          throw new Error(t("documentViewer.loadTextFailed"));
        }
        const text = await FileSystem.readAsStringAsync(uri);
        setTextContent(text);
        lastLoadedUriRef.current = uri;
        setFileState({ status: "ready", uri });
        return;
      }

      const response = await authFetch(`/api/documents/${documentId}/download`);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const text = await response.text();
      setTextContent(text);
      lastLoadedUriRef.current = "";
      setFileState({ status: "ready", uri: "" });
    } catch (err) {
        setFileState({
          status: "error",
          message: err instanceof Error ? err.message : t("documentViewer.loadTextFailed"),
        });
      }
  }, [authFetch, canFetchOnline, documentId, hasLocalFile, localFileUri, offlineMode, onPersistOnlineFile, t]);

  // Auto-load on mount when previewable
  useEffect(() => {
    if (!canPreview) return;
    if (localFilePending) return;
    if (fileState.status !== "idle") return;
    if (localFileUri && lastLoadedUriRef.current === localFileUri) return;
    if (isText(mimeType)) {
      void fetchText();
    } else {
      void downloadFile();
    }
  }, [canPreview, fileState.status, localFilePending, mimeType, localFileUri, fetchText, downloadFile]);

  // Fallback: share to external app
  const handleShare = useCallback(async () => {
    try {
      if (localFileUri) {
        const info = await FileSystem.getInfoAsync(localFileUri);
        if (info.exists) {
          await Sharing.shareAsync(localFileUri);
          return;
        }
      }

      if (offlineMode) {
        throw new Error(t("documentViewer.shareOfflineMissing"));
      }

      setFileState({ status: "loading" });
      const response = await authFetch(
        `/api/documents/${documentId}/download`,
      );
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const arrayBuffer = await response.arrayBuffer();
      const ext = extensionForMime(mimeType);
      const uri = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory}openkeep-share-${documentId}${ext}`;
      await FileSystem.writeAsStringAsync(
        uri,
        Buffer.from(arrayBuffer).toString("base64"),
        { encoding: FileSystem.EncodingType.Base64 },
      );
      setFileState({ status: "ready", uri });
      await Sharing.shareAsync(uri);
    } catch (err) {
      setFileState({
        status: "error",
        message: err instanceof Error ? err.message : t("documentViewer.shareFailed"),
      });
    }
  }, [authFetch, documentId, localFileUri, mimeType, offlineMode, t]);

  // Follow the caller's page bar. `setPage` does nothing before the document has
  // loaded, so the jump waits for `totalPages`.
  useEffect(() => {
    if (!page || totalPages === 0 || page === currentPage) {
      return;
    }
    pdfRef.current?.setPage(Math.min(Math.max(page, 1), totalPages));
  }, [currentPage, page, totalPages]);

  // PDF navigation handlers
  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) pdfRef.current?.setPage(currentPage - 1);
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) pdfRef.current?.setPage(currentPage + 1);
  }, [currentPage, totalPages]);

  const handleOpenFullscreen = useCallback(() => {
    if (fileState.status !== "ready" || openingNativeViewer) {
      return;
    }

    setOpeningNativeViewer(true);
    void FileViewer.open(fileState.uri, {
      displayName: `Document ${documentId}`,
      onDismiss: () => {
        setOpeningNativeViewer(false);
      },
      showAppsSuggestions: true,
      showOpenWithDialog: false,
    })
      .catch((error) => {
        setFileState({
          status: "error",
          message: error instanceof Error ? error.message : t("documentViewer.previewUnavailable"),
        });
      })
      .finally(() => {
        setOpeningNativeViewer(false);
      });
  }, [documentId, fileState, openingNativeViewer, t]);

  if (embedded) {
    if (!canPreview) {
      return (
        <View style={styles.embeddedCentered}>
          <IconTile size="lg">
            <MaterialCommunityIcons
              name="file-question-outline"
              size={22}
              color={colors.accentSoftInk}
            />
          </IconTile>
          <Text style={styles.fallbackTitle}>{t("documentViewer.previewUnavailable")}</Text>
          <Text style={styles.fallbackBody}>
            {`${mimeType} ${t("documentViewer.inlinePreviewUnsupported")}`}
          </Text>
          <Button
            label={t("documentViewer.shareToOpen")}
            icon="share-variant-outline"
            variant="secondary"
            size="sm"
            loading={fileState.status === "loading"}
            onPress={() => void handleShare()}
          />
        </View>
      );
    }

    if (fileState.status === "idle" || fileState.status === "loading") {
      return (
        <View
          style={styles.paperSheet}
          accessibilityLabel={t("documentViewer.loadingPreview")}
          accessibilityState={{ busy: true }}
        >
          <View style={styles.paperLines}>
            {([40, 92, 88, 94, 76] as const).map((width) => (
              <Skeleton key={width} style={[styles.paperLine, { width: `${width}%` }]} />
            ))}
          </View>
        </View>
      );
    }

    if (fileState.status === "error") {
      // Offline, a missing file is a fact about the copy rather than a failure.
      return (
        <View style={styles.embeddedCentered}>
          {canFetchOnline ? (
            <>
              <IconTile size="lg">
                <MaterialCommunityIcons name="alert-outline" size={22} color={colors.accentSoftInk} />
              </IconTile>
              <Text style={styles.errorText}>{fileState.message}</Text>
              <Button
                label={t("documentViewer.retry")}
                variant="secondary"
                size="sm"
                onPress={() => {
                  if (isText(mimeType)) void fetchText();
                  else void downloadFile();
                }}
              />
            </>
          ) : (
            <EmptyState icon="cloud-off-outline" title={t("documentDetail.offlineFileMissing")} />
          )}
        </View>
      );
    }

    if (isPdf(mimeType)) {
      return (
        <View
          style={styles.paperSheet}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setBox({ width, height });
          }}
        >
          {box ? (
            <Pdf
              ref={pdfRef}
              source={{ uri: fileState.uri }}
              style={{ width: box.width, height: box.height, backgroundColor: colors.paper }}
              // Pages turn sideways, so a vertical drag is free to scroll the
              // column the viewer sits in.
              horizontal
              enablePaging
              enableDoubleTapZoom
              trustAllCerts={false}
              scale={zoom / 100}
              minScale={0.5}
              maxScale={5}
              spacing={10}
              page={pdfStartPage.current}
              onLoadProgress={(percent) => setLoadProgress(percent)}
              onLoadComplete={(numberOfPages) => {
                setTotalPages(numberOfPages);
                setLoadProgress(1);
                onTotalPagesChange?.(numberOfPages);
              }}
              onPageChanged={(shownPage, numberOfPages) => {
                setCurrentPage(shownPage);
                setTotalPages(numberOfPages);
                onPageChange?.(shownPage);
                onTotalPagesChange?.(numberOfPages);
              }}
              onScaleChanged={(scale) => onZoomSettled?.(Math.round(scale * 100))}
              onError={() => {
                setFileState({ status: "error", message: t("documentViewer.pdfRenderError") });
              }}
              renderActivityIndicator={(progress) => <PdfProgressBar progress={progress} />}
            />
          ) : null}
        </View>
      );
    }

    if (isImage(mimeType)) {
      const scale = zoom / 100;
      return (
        <View
          style={styles.paperSheet}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setBox({ width, height });
          }}
        >
          {box ? (
            <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={false}
              >
                <Image
                  source={{ uri: fileState.uri }}
                  style={{ width: box.width * scale, height: box.height * scale }}
                  resizeMode="contain"
                />
              </ScrollView>
            </ScrollView>
          ) : null}
        </View>
      );
    }

    return (
      <View style={styles.paperSheet}>
        <ScrollView nestedScrollEnabled contentContainerStyle={styles.paperText}>
          <Text style={styles.paperTextContent} selectable>
            {textContent ?? ""}
          </Text>
        </ScrollView>
      </View>
    );
  }

  // ---- Unsupported type fallback ----
  if (!canPreview) {
    return (
      <View style={styles.fallbackContainer}>
        <View style={styles.fallbackIcon}>
          <Text style={styles.fallbackIconText}>
            {mimeType.split("/")[1]?.toUpperCase().slice(0, 5) ?? "FILE"}
          </Text>
        </View>
        <Text style={styles.fallbackTitle}>{t("documentViewer.previewUnavailable")}</Text>
        <Text style={styles.fallbackBody}>
          {`${mimeType} ${t("documentViewer.inlinePreviewUnsupported")}`}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.shareButton,
            pressed ? styles.shareButtonPressed : null,
          ]}
          onPress={() => void handleShare()}
        >
          {fileState.status === "loading" ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.shareButtonText}>{t("documentViewer.shareToOpen")}</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // ---- Loading state ----
  if (fileState.status === "idle" || fileState.status === "loading") {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>{t("documentViewer.loadingPreview")}</Text>
      </View>
    );
  }

  // ---- Error state ----
  if (fileState.status === "error") {
    return (
      <View style={styles.fallbackContainer}>
        <Text style={styles.errorText}>{fileState.message}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.shareButton,
            pressed ? styles.shareButtonPressed : null,
          ]}
          onPress={() => {
            if (isText(mimeType)) void fetchText();
            else void downloadFile();
          }}
        >
          <Text style={styles.shareButtonText}>{t("documentViewer.retry")}</Text>
        </Pressable>
      </View>
    );
  }

  // ---- PDF viewer ----
  if (isPdf(mimeType) && fileState.status === "ready") {
    const { width: screenWidth } = Dimensions.get("window");
    const pdfWidth = screenWidth - 40; // 20px padding each side
    return (
      <View style={styles.pdfContainer}>
        <View style={styles.pdfTapTarget}>
          <Pdf
            ref={pdfRef}
            source={{ uri: fileState.uri }}
            style={{ width: pdfWidth, height: pdfWidth * 1.4 }}
            enablePaging
            enableDoubleTapZoom
            trustAllCerts={false}
            minScale={1.0}
            maxScale={5.0}
            spacing={10}
            onLoadProgress={(percent) => setLoadProgress(percent)}
            onLoadComplete={(numberOfPages) => {
              setTotalPages(numberOfPages);
              setLoadProgress(1);
              onTotalPagesChange?.(numberOfPages);
            }}
            onPageChanged={(shownPage, numberOfPages) => {
              setCurrentPage(shownPage);
              setTotalPages(numberOfPages);
              onPageChange?.(shownPage);
              onTotalPagesChange?.(numberOfPages);
            }}
            onError={(error) => {
              setFileState({
                status: "error",
                message: t("documentViewer.pdfRenderError"),
              });
            }}
            renderActivityIndicator={(progress) => (
              <PdfProgressBar progress={progress} />
            )}
          />
        </View>

        {/* Page navigation bar */}
        {totalPages > 0 && (
          <PageNavigator
            currentPage={currentPage}
            totalPages={totalPages}
            onPrev={handlePrevPage}
            onNext={handleNextPage}
            onOpenFullscreen={handleOpenFullscreen}
            pageLabel={t("documentViewer.page")}
            ofLabel={t("documentViewer.of")}
          />
        )}

        <Pressable
          style={({ pressed }) => [
            styles.shareButton,
            styles.shareButtonInline,
            pressed ? styles.shareButtonPressed : null,
          ]}
          onPress={() => void Sharing.shareAsync(fileState.uri)}
        >
          <Text style={styles.shareButtonText}>{t("documentViewer.sharePdf")}</Text>
        </Pressable>
      </View>
    );
  }

  // ---- Image viewer ----
  if (isImage(mimeType) && fileState.status === "ready") {
    return (
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: fileState.uri }}
          style={styles.image}
          resizeMode="contain"
        />
        <Pressable
          style={({ pressed }) => [
            styles.shareButton,
            styles.shareButtonInline,
            pressed ? styles.shareButtonPressed : null,
          ]}
          onPress={() => void Sharing.shareAsync(fileState.uri)}
        >
          <Text style={styles.shareButtonText}>{t("documentViewer.shareImage")}</Text>
        </Pressable>
      </View>
    );
  }

  // ---- Text viewer ----
  if (isText(mimeType) && textContent !== null) {
    return (
      <View style={styles.textContainer}>
        <ScrollView
          style={styles.textScroll}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          <Text style={styles.textContent} selectable>
            {textContent}
          </Text>
        </ScrollView>
      </View>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const useStyles = createThemedStyles((c) => ({
  paperSheet: {
    flex: 1,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: c.paperBorder,
    borderRadius: radii.sm,
    backgroundColor: c.paper,
    ...raisedShadow(c),
  },
  paperLines: {
    gap: 12,
    padding: 24,
  },
  paperLine: {
    height: 12,
    borderRadius: radii.pill,
    backgroundColor: c.paperBorder,
  },
  paperText: {
    padding: 20,
  },
  paperTextContent: {
    ...text.mono,
    fontSize: 13,
    lineHeight: 20,
    color: c.paperInk,
  },
  embeddedCentered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 20,
  },
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  loadingText: {
    color: c.muted,
    fontSize: 13,
    fontFamily: fonts.sans.semibold,
  },
  fallbackContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    gap: 12,
  },
  fallbackIcon: {
    width: 64,
    height: 64,
    borderRadius: radii.xl,
    backgroundColor: c.raised,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  fallbackIconText: {
    fontSize: 11,
    fontFamily: fonts.sans.semibold,
    color: c.muted,
    letterSpacing: 0.5,
  },
  fallbackTitle: {
    fontSize: 17,
    fontFamily: fonts.sans.semibold,
    color: c.ink,
  },
  fallbackBody: {
    fontFamily: fonts.sans.regular,
    color: c.muted,
    fontSize: 13,
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 18,
  },
  errorText: {
    color: c.red,
    fontSize: 14,
    fontFamily: fonts.sans.semibold,
    textAlign: "center",
    maxWidth: 280,
  },
  shareButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radii.lg,
    backgroundColor: c.accentSoft,
  },
  shareButtonInline: {
    alignSelf: "center",
    marginTop: 12,
  },
  shareButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  shareButtonText: {
    color: c.accent,
    fontSize: 14,
    fontFamily: fonts.sans.semibold,
  },
  pdfContainer: {
    alignItems: "center",
    gap: 4,
    padding: 8,
    borderRadius: radii.xl,
    backgroundColor: c.sunken,
  },
  pdfTapTarget: {
    borderRadius: radii.lg,
    overflow: "hidden",
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.paperBorder,
  },
  imageContainer: {
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderRadius: radii.xl,
    backgroundColor: c.sunken,
  },
  image: {
    width: "100%",
    aspectRatio: 0.707, // ~A4 portrait ratio
    borderRadius: radii.lg,
    backgroundColor: c.paper,
    borderWidth: 1,
    borderColor: c.paperBorder,
  },
  textContainer: {
    borderRadius: radii.xl,
    backgroundColor: c.panel,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  textScroll: {
    maxHeight: 320,
    padding: 16,
  },
  textContent: {
    // The bundled face, not the platform keyword: `"monospace"` is Android-only,
    // so a text preview rendered in the system font on iOS.
    fontFamily: fonts.mono.regular,
    fontSize: 13,
    lineHeight: 20,
    color: c.ink,
  },
}));
