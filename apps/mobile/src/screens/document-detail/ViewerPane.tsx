import { useCallback, useState } from "react";
import { ScrollView, Text, useWindowDimensions, View } from "react-native";
import { DocumentViewer, openInNativeViewer } from "../../components/DocumentViewer";
import { PassagePaper, type Passage } from "../../components/Passage";
import { useI18n } from "../../i18n";
import { useOfflineArchive } from "../../offline-archive";
import { createThemedStyles } from "../../theme";
import { text } from "../../typography";
import { titleForDocument, type ArchiveDocument } from "../../lib";
import type { AuthFetch, DownloadVariant } from "../../api/document";
import { IconButton } from "./parts";

const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_STEP = 25;

/**
 * The document on its stage, the web's left pane: a toolbar, then a sheet of paper
 * on a sunken surface. On a phone it stacks above the inspector at the same 62% of
 * the viewport the web gives it below `lg`.
 */
export function ViewerPane({
  document,
  authFetch,
  localFileUri,
  hasLocalFile,
  localFilePending,
  offlineMode,
  textBlocks,
  page,
  onPageChange,
  passage,
  onDismissPassage,
  canDownload,
  onDownload,
  onFullScreenFailed,
}: {
  document: ArchiveDocument;
  authFetch: AuthFetch;
  localFileUri: string | null;
  hasLocalFile: boolean;
  localFilePending: boolean;
  offlineMode: boolean;
  textBlocks?: Array<{ page: number; text: string }>;
  page: number;
  onPageChange: (page: number) => void;
  passage: Passage | null;
  onDismissPassage: () => void;
  canDownload: boolean;
  onDownload: (variant: DownloadVariant) => void;
  onFullScreenFailed: () => void;
}) {
  const styles = useStyles();
  const { t } = useI18n();
  const { height: windowHeight } = useWindowDimensions();
  const { ensureCachedFile, isConnected } = useOfflineArchive();

  /** What the PDF itself reports, which beats a missing `metadata.pageCount`. */
  const [viewerPages, setViewerPages] = useState(0);
  const [zoom, setZoom] = useState(100);
  /** Where a pinch left it. Shown, and stepped from, but never fed back as `scale`. */
  const [settledZoom, setSettledZoom] = useState<number | null>(null);
  const [fileUri, setFileUri] = useState<string | null>(null);

  const persistOnlineFile = useCallback(
    () => ensureCachedFile(authFetch, document),
    [authFetch, document, ensureCachedFile],
  );

  const isPdf = document.mimeType === "application/pdf";
  const zoomable = isPdf || document.mimeType.startsWith("image/");
  const pageCount = Math.max(document.metadata?.pageCount ?? 1, viewerPages, 1);
  const shownZoom = settledZoom ?? zoom;
  const stepZoom = (delta: number) => {
    setSettledZoom(null);
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, shownZoom + delta)));
  };

  return (
    <View>
      <View style={styles.toolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.toolbarContent}
        >
          {isPdf && pageCount > 1 ? (
            <>
              <IconButton
                icon="chevron-left"
                label={t("documentDetail.previousPage")}
                disabled={page <= 1}
                onPress={() => onPageChange(Math.max(1, page - 1))}
                size={34}
              />
              <Text style={styles.readout} numberOfLines={1}>{`${page} / ${pageCount}`}</Text>
              <IconButton
                icon="chevron-right"
                label={t("documentDetail.nextPage")}
                disabled={page >= pageCount}
                onPress={() => onPageChange(Math.min(pageCount, page + 1))}
                size={34}
              />
              <View style={styles.separator} />
            </>
          ) : null}
          {zoomable ? (
            <>
              <IconButton
                icon="magnify-minus-outline"
                label={t("documentDetail.zoomOut")}
                disabled={shownZoom <= ZOOM_MIN}
                onPress={() => stepZoom(-ZOOM_STEP)}
                size={34}
              />
              <Text style={styles.readout} numberOfLines={1}>{`${shownZoom}%`}</Text>
              <IconButton
                icon="magnify-plus-outline"
                label={t("documentDetail.zoomIn")}
                disabled={shownZoom >= ZOOM_MAX}
                onPress={() => stepZoom(ZOOM_STEP)}
                size={34}
              />
            </>
          ) : null}

          <View style={styles.trailing}>
            <IconButton
              icon="fullscreen"
              label={t("documentDetail.openFullScreen")}
              disabled={!fileUri}
              onPress={() => {
                if (fileUri) {
                  openInNativeViewer(fileUri, titleForDocument(document)).catch(onFullScreenFailed);
                }
              }}
              size={34}
            />
            <IconButton
              icon="download-outline"
              label={t("documentDetail.downloadOriginal")}
              disabled={!canDownload}
              onPress={() => onDownload("original")}
              size={34}
            />
            {document.searchablePdfAvailable && !offlineMode ? (
              <IconButton
                icon="file-search-outline"
                label={t("documentDetail.downloadSearchable")}
                onPress={() => onDownload("searchable")}
                size={34}
              />
            ) : null}
          </View>
        </ScrollView>
      </View>

      {/* A citation's passage. The native PDF view has no text layer to mark, so the
          highlight lives on its own sheet above the page it jumped to. */}
      {passage ? (
        <View style={styles.passage}>
          <View style={styles.passageHead}>
            <Text style={styles.passagePage}>{`${t("documentDetail.pageWord")} ${passage.page}`}</Text>
            <IconButton
              icon="close"
              label={t("documentDetail.dismissPassage")}
              onPress={onDismissPassage}
              size={28}
            />
          </View>
          <PassagePaper passage={passage} />
        </View>
      ) : null}

      <View style={[styles.stage, { height: Math.max(320, windowHeight * 0.62) - 44 }]}>
        <DocumentViewer
          embedded
          authFetch={authFetch}
          documentId={document.id}
          mimeType={document.mimeType}
          searchablePdfAvailable={document.searchablePdfAvailable}
          localFileUri={localFileUri}
          hasLocalFile={hasLocalFile}
          localFilePending={localFilePending}
          offlineMode={offlineMode}
          canFetchOnline={!offlineMode || isConnected}
          onPersistOnlineFile={persistOnlineFile}
          textBlocks={textBlocks}
          page={page}
          onPageChange={onPageChange}
          onTotalPagesChange={setViewerPages}
          zoom={zoom}
          onZoomSettled={setSettledZoom}
          onFileReady={setFileUri}
        />
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((c) => ({
  toolbar: {
    height: 44,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
    backgroundColor: c.panel,
  },
  toolbarContent: {
    flexGrow: 1,
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
  },
  readout: {
    ...text.numeric,
    minWidth: 38,
    color: c.muted,
    textAlign: "center",
  },
  separator: {
    width: 1,
    height: 20,
    marginHorizontal: 2,
    backgroundColor: c.border,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginLeft: "auto",
    paddingLeft: 4,
  },
  passage: {
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    backgroundColor: c.sunken,
  },
  passageHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  passagePage: {
    ...text.numericStrong,
    color: c.muted,
  },
  stage: {
    padding: 12,
    backgroundColor: c.sunken,
  },
}));
