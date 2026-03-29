import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Pdf from "react-native-pdf";
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
// Component
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

  const canPreview = isPdf(mimeType) || isImage(mimeType) || isText(mimeType);

  useEffect(() => {
    setFileState({ status: "idle" });
    setTextContent(null);
    lastLoadedUriRef.current = null;
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
        <Pdf
          source={{ uri: fileState.uri }}
          style={{ width: pdfWidth, height: pdfWidth * 1.4 }}
          enablePaging
          trustAllCerts={false}
        />
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
    gap: 8,
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
