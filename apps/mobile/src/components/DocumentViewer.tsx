import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Pdf, { type PdfRef } from "react-native-pdf";
import { Buffer } from "buffer";
import { useI18n } from "../i18n";
import { colors, shadow } from "../theme";

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

// ---------------------------------------------------------------------------
// Chevron icons (simple inline SVG-like shapes via Views)
// ---------------------------------------------------------------------------

function ChevronLeft({ color = colors.primary, size = 18 }: { color?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View
        style={{
          width: size * 0.5,
          height: size * 0.5,
          borderLeftWidth: 2.5,
          borderBottomWidth: 2.5,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
          marginLeft: size * 0.15,
        }}
      />
    </View>
  );
}

function ChevronRight({ color = colors.primary, size = 18 }: { color?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View
        style={{
          width: size * 0.5,
          height: size * 0.5,
          borderRightWidth: 2.5,
          borderTopWidth: 2.5,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
          marginRight: size * 0.15,
        }}
      />
    </View>
  );
}

function ExpandIcon({ color = colors.muted, size = 16 }: { color?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      {/* Four corner brackets to represent fullscreen/expand */}
      <View style={{ width: size * 0.75, height: size * 0.75, position: "relative" }}>
        {/* Top-left */}
        <View style={{ position: "absolute", top: 0, left: 0, width: size * 0.3, height: size * 0.3, borderTopWidth: 2, borderLeftWidth: 2, borderColor: color }} />
        {/* Top-right */}
        <View style={{ position: "absolute", top: 0, right: 0, width: size * 0.3, height: size * 0.3, borderTopWidth: 2, borderRightWidth: 2, borderColor: color }} />
        {/* Bottom-left */}
        <View style={{ position: "absolute", bottom: 0, left: 0, width: size * 0.3, height: size * 0.3, borderBottomWidth: 2, borderLeftWidth: 2, borderColor: color }} />
        {/* Bottom-right */}
        <View style={{ position: "absolute", bottom: 0, right: 0, width: size * 0.3, height: size * 0.3, borderBottomWidth: 2, borderRightWidth: 2, borderColor: color }} />
      </View>
    </View>
  );
}

function CloseIcon({ color = "#fff", size = 20 }: { color?: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, justifyContent: "center", alignItems: "center" }}>
      <View
        style={{
          position: "absolute",
          width: size * 0.85,
          height: 2.5,
          backgroundColor: color,
          transform: [{ rotate: "45deg" }],
          borderRadius: 2,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 0.85,
          height: 2.5,
          backgroundColor: color,
          transform: [{ rotate: "-45deg" }],
          borderRadius: 2,
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// PDF Loading Progress Indicator
// ---------------------------------------------------------------------------

function PdfProgressBar({ progress }: { progress: number }) {
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

const progressStyles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 10,
  },
  track: {
    width: 140,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceMuted,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
  },
});

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
        <ChevronLeft color={isFirst ? colors.border : colors.primary} size={16} />
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
        <ChevronRight color={isLast ? colors.border : colors.primary} size={16} />
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
        <ExpandIcon color={colors.primary} size={16} />
      </Pressable>
    </View>
  );
}

const navStyles = StyleSheet.create({
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
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  navButtonDisabled: {
    backgroundColor: colors.surfaceMuted,
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
    fontWeight: "700",
    color: colors.text,
  },
  fullscreenButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
});

// ---------------------------------------------------------------------------
// Fullscreen Modal
// ---------------------------------------------------------------------------

function FullscreenPdfModal({
  visible,
  uri,
  initialPage,
  onClose,
  onPageChanged,
  closeLabel,
  pageLabel,
  ofLabel,
}: {
  visible: boolean;
  uri: string;
  initialPage: number;
  onClose: () => void;
  onPageChanged: (page: number, total: number) => void;
  closeLabel: string;
  pageLabel: string;
  ofLabel: string;
}) {
  const pdfRef = useRef<PdfRef>(null);
  const [page, setPage] = useState(initialPage);
  const [total, setTotal] = useState(0);
  const [showControls, setShowControls] = useState(true);

  // Sync initial page when modal opens
  useEffect(() => {
    if (visible) {
      setPage(initialPage);
      setShowControls(true);
    }
  }, [visible, initialPage]);

  const handlePageChanged = useCallback(
    (p: number, t: number) => {
      setPage(p);
      setTotal(t);
      onPageChanged(p, t);
    },
    [onPageChanged],
  );

  const handleTap = useCallback(() => {
    setShowControls((prev) => !prev);
  }, []);

  const handlePrev = useCallback(() => {
    if (page > 1) pdfRef.current?.setPage(page - 1);
  }, [page]);

  const handleNext = useCallback(() => {
    if (page < total) pdfRef.current?.setPage(page + 1);
  }, [page, total]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" animated />
      <View style={fullscreenStyles.backdrop}>
        {/* PDF */}
        <Pdf
          ref={pdfRef}
          source={{ uri }}
          page={initialPage}
          style={fullscreenStyles.pdf}
          enablePaging
          enableDoubleTapZoom
          trustAllCerts={false}
          minScale={1.0}
          maxScale={5.0}
          spacing={0}
          onLoadComplete={(numberOfPages) => {
            setTotal(numberOfPages);
          }}
          onPageChanged={handlePageChanged}
          onPageSingleTap={handleTap}
          onError={() => {
            /* handled by parent */
          }}
        />

        {/* Top bar (close button) */}
        {showControls && (
          <View style={fullscreenStyles.topBar}>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                fullscreenStyles.closeButton,
                pressed && { opacity: 0.7 },
              ]}
              hitSlop={12}
            >
              <CloseIcon color="#fff" size={18} />
              <Text style={fullscreenStyles.closeText}>{closeLabel}</Text>
            </Pressable>
          </View>
        )}

        {/* Bottom bar (page navigation) */}
        {showControls && total > 0 && (
          <View style={fullscreenStyles.bottomBar}>
            <Pressable
              onPress={handlePrev}
              disabled={page <= 1}
              style={({ pressed }) => [
                fullscreenStyles.bottomNavButton,
                page <= 1 && { opacity: 0.3 },
                pressed && page > 1 && { opacity: 0.7 },
              ]}
              hitSlop={8}
            >
              <ChevronLeft color="#fff" size={16} />
            </Pressable>

            <Text style={fullscreenStyles.bottomPageText}>
              {`${pageLabel} ${page} ${ofLabel} ${total}`}
            </Text>

            <Pressable
              onPress={handleNext}
              disabled={page >= total}
              style={({ pressed }) => [
                fullscreenStyles.bottomNavButton,
                page >= total && { opacity: 0.3 },
                pressed && page < total && { opacity: 0.7 },
              ]}
              hitSlop={8}
            >
              <ChevronRight color="#fff" size={16} />
            </Pressable>
          </View>
        )}
      </View>
    </Modal>
  );
}

const fullscreenStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "#000",
  },
  pdf: {
    flex: 1,
    backgroundColor: "#000",
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 56,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "center",
    // gradient-like feel via semi-transparent background
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  closeButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  closeText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingTop: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  bottomNavButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  bottomPageText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    minWidth: 100,
    textAlign: "center",
  },
});

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
}: ViewerProps) {
  const { t } = useI18n();
  const [fileState, setFileState] = useState<FileState>({ status: "idle" });
  const [textContent, setTextContent] = useState<string | null>(null);
  const lastLoadedUriRef = useRef<string | null>(null);

  // PDF-specific state
  const pdfRef = useRef<PdfRef>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loadProgress, setLoadProgress] = useState(0);
  const [fullscreenVisible, setFullscreenVisible] = useState(false);

  const canPreview = isPdf(mimeType) || isImage(mimeType) || isText(mimeType);

  useEffect(() => {
    setFileState({ status: "idle" });
    setTextContent(null);
    lastLoadedUriRef.current = null;
    setCurrentPage(1);
    setTotalPages(0);
    setLoadProgress(0);
  }, [documentId, mimeType]);

  // Download file to local cache for PDF/image rendering
  const downloadFile = useCallback(async () => {
    if (localFileUri && fileState.status === "ready" && fileState.uri === localFileUri) {
      return;
    }

    setFileState({ status: "loading" });
    try {
      if (localFileUri) {
        const info = await FileSystem.getInfoAsync(localFileUri);
        if (info.exists) {
          lastLoadedUriRef.current = localFileUri;
          setFileState({ status: "ready", uri: localFileUri });
          return;
        }
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
  }, [authFetch, documentId, hasLocalFile, localFileUri, mimeType, offlineMode, onPersistOnlineFile, searchablePdfAvailable, t]);

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
  }, [authFetch, documentId, hasLocalFile, localFileUri, offlineMode, onPersistOnlineFile, t]);

  // Auto-load on mount when previewable
  useEffect(() => {
    if (!canPreview) return;
    if (fileState.status !== "idle") return;
    if (localFileUri && lastLoadedUriRef.current === localFileUri) return;
    if (isText(mimeType)) {
      void fetchText();
    } else {
      void downloadFile();
    }
  }, [canPreview, fileState.status, mimeType, localFileUri, fetchText, downloadFile]);

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

  // PDF navigation handlers
  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) pdfRef.current?.setPage(currentPage - 1);
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) pdfRef.current?.setPage(currentPage + 1);
  }, [currentPage, totalPages]);

  const handleOpenFullscreen = useCallback(() => {
    setFullscreenVisible(true);
  }, []);

  const handleCloseFullscreen = useCallback(() => {
    setFullscreenVisible(false);
  }, []);

  const handleFullscreenPageChanged = useCallback((page: number, _total: number) => {
    setCurrentPage(page);
    // Sync inline viewer to the same page when fullscreen closes
    pdfRef.current?.setPage(page);
  }, []);

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
            <ActivityIndicator color={colors.primary} size="small" />
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
        <ActivityIndicator color={colors.primary} size="large" />
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
        <Pressable
          onPress={handleOpenFullscreen}
          style={styles.pdfTapTarget}
        >
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
            }}
            onPageChanged={(page, numberOfPages) => {
              setCurrentPage(page);
              setTotalPages(numberOfPages);
            }}
            onError={(error) => {
              setFileState({
                status: "error",
                message: t("documentViewer.pdfRenderError"),
              });
            }}
            onPageSingleTap={() => {
              handleOpenFullscreen();
            }}
            renderActivityIndicator={(progress) => (
              <PdfProgressBar progress={progress} />
            )}
          />
        </Pressable>

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

        {/* Share button */}
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

        {/* Fullscreen modal */}
        <FullscreenPdfModal
          visible={fullscreenVisible}
          uri={fileState.uri}
          initialPage={currentPage}
          onClose={handleCloseFullscreen}
          onPageChanged={handleFullscreenPageChanged}
          closeLabel={t("documentViewer.closeFullscreen")}
          pageLabel={t("documentViewer.page")}
          ofLabel={t("documentViewer.of")}
        />
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

const styles = StyleSheet.create({
  loadingContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 12,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
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
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  fallbackIconText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
    letterSpacing: 0.5,
  },
  fallbackTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  fallbackBody: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 18,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
    maxWidth: 280,
  },
  shareButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
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
    color: colors.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  pdfContainer: {
    alignItems: "center",
    gap: 4,
  },
  pdfTapTarget: {
    borderRadius: 8,
    overflow: "hidden",
  },
  imageContainer: {
    alignItems: "center",
    gap: 8,
  },
  image: {
    width: "100%",
    aspectRatio: 0.707, // ~A4 portrait ratio
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
  },
  textContainer: {
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  textScroll: {
    maxHeight: 320,
    padding: 16,
  },
  textContent: {
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
});
