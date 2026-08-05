import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Pressable,
  Text,
  TextInput,
  TurboModuleRegistry,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth";
import {
  Button,
  ErrorCard,
  Notice,
  Row,
  Screen,
  SectionHeader,
} from "../components/ui";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { AppStackParamList } from "../../App";
import { createThemedStyles, radii, useColors } from "../theme";
import { text } from "../typography";
import { createPdfFromImages, responseToMessage } from "../lib";

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

type DraftAsset = {
  id: string;
  uri: string;
};

/** `1,2 MB` — the row states what each captured page costs. */
function formatBytes(bytes: number | undefined) {
  if (bytes === undefined) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ScanScreen() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const insets = useSafeAreaInsets();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<DraftAsset[]>([]);
  const [pdfUri, setPdfUri] = useState("");
  const [error, setError] = useState("");

  const pageUris = useMemo(() => pages.map((page) => page.uri), [pages]);
  const [sizes, setSizes] = useState<Record<string, number>>({});

  // Sizes come from the filesystem, once per draft page.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      pages.map(async (page) => {
        const info = await FileSystem.getInfoAsync(page.uri).catch(() => null);
        return [page.id, info && info.exists ? (info.size ?? 0) : 0] as const;
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

  const uploadMutation = useMutation({
    mutationFn: async () => {
      let fileUri = pdfUri;
      let filename = fileUri ? `openkeep-import-${Date.now()}.pdf` : "";
      let mimeType = fileUri ? "application/pdf" : "";

      if (!fileUri && pageUris.length > 0) {
        fileUri = await createPdfFromImages(pageUris);
        filename = `openkeep-scan-${Date.now()}.pdf`;
        mimeType = "application/pdf";
      }

      if (!fileUri) {
        throw new Error(t("scan.addBeforeUpload"));
      }

      const formData = new FormData();
      formData.append("file", {
        uri: fileUri,
        name: filename,
        type: mimeType,
      } as unknown as Blob);

      if (title.trim()) {
        formData.append("title", title.trim());
      }

      const response = await auth.authFetch("/api/documents", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        throw new Error(await responseToMessage(response));
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["documents"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["review"] }),
      ]);
      setTitle("");
      setPages([]);
      setPdfUri("");
      setError("");
      navigation.navigate("Home", { screen: "Documents" } as never);
    },
  });

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
      setPdfUri("");
      setPages(scannedImages.map((uri: string, index: number) => ({ id: `${Date.now()}-${index}`, uri })));
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

    setPdfUri("");
    setPages(result.assets.map((asset, index) => ({ id: `${asset.name}-${index}`, uri: asset.uri })));
  }

  async function handlePickFile() {
    setError("");
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf"],
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    setPages([]);
    setPdfUri(asset.uri);
    if (!title.trim()) {
      setTitle(asset.name.replace(/\.pdf$/i, ""));
    }
  }

  function removePage(id: string) {
    setPages((current) => current.filter((page) => page.id !== id));
  }

  const canUpload = (pages.length > 0 || Boolean(pdfUri)) && !shouldUseCache;

  return (
    <Screen
      padded={false}
      scroll={false}
      title={t("scan.import")}
      onBack={() => navigation.goBack()}
      backIcon="close"
      right={
        pages.length > 0 ? (
          <Text style={styles.pageCount}>{`${pages.length} ${t("scan.pages")}`}</Text>
        ) : undefined
      }
      notice={shouldUseCache ? <Notice label={t("state.offlineScan")} tone="warn" /> : undefined}
    >
      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        {/* Optional title — everything else is read off the document */}
        <View style={styles.titleBlock}>
          <Text style={styles.titleLabel}>{t("scan.titleOptional")}</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={t("scan.titleDetected")}
            placeholderTextColor={colors.dim}
            style={styles.titleInput}
          />
        </View>

        {pages.length > 0 ? (
          <>
            <SectionHeader
              label={t("scan.capturedPages")}
              right={
                <Pressable onPress={() => void handleScan()} hitSlop={12}>
                  <Text style={styles.headerLink}>{t("scan.rescan")}</Text>
                </Pressable>
              }
            />
            {pages.map((page, index) => (
              <Row
                key={page.id}
                minHeight={72}
                leading={<Image source={{ uri: page.uri }} style={styles.thumb} />}
                title={`${t("scan.page")} ${index + 1}`}
                meta={formatBytes(sizes[page.id])}
                metaMono
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t("scan.removePage")}
                    onPress={() => removePage(page.id)}
                    hitSlop={12}
                  >
                    <MaterialCommunityIcons
                      name="trash-can-outline"
                      size={19}
                      color={colors.red}
                    />
                  </Pressable>
                }
              />
            ))}
          </>
        ) : null}

        {pdfUri ? (
          <>
            <SectionHeader label={t("scan.importedPdf")} />
            <Row
              minHeight={62}
              leading={
                <MaterialCommunityIcons
                  name="file-document-outline"
                  size={19}
                  color={colors.muted}
                />
              }
              title={pdfUri.split("/").pop() ?? pdfUri}
              trailing={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("scan.shareCopy")}
                  onPress={() => void Sharing.shareAsync(pdfUri)}
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
          </>
        ) : null}

        {/* Import is the alternative, not a competing primary action */}
        <SectionHeader label={t("scan.importInstead")} />
        {/* Captured pages have their own Rescan link in the section header; a PDF
            draft has nothing, so the camera row stays for it. */}
        {pages.length === 0 ? (
          <Row
            leading={
              <MaterialCommunityIcons name="line-scan" size={19} color={colors.muted} />
            }
            title={t("scan.scanNow")}
            chevron
            onPress={() => void handleScan()}
          />
        ) : null}
        <Row
          leading={<MaterialCommunityIcons name="image-outline" size={19} color={colors.muted} />}
          title={t("scan.pickImages")}
          chevron
          onPress={() => void handlePickImages()}
        />
        <Row
          leading={
            <MaterialCommunityIcons name="file-outline" size={19} color={colors.muted} />
          }
          title={t("scan.pickPdf")}
          chevron
          onPress={() => void handlePickFile()}
        />

        <Text style={styles.cameraHint}>{t("scan.cameraHint")}</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {uploadMutation.isError ? (
          <View style={styles.gutter}>
            <ErrorCard
              message={
                uploadMutation.error instanceof Error
                  ? uploadMutation.error.message
                  : t("scan.uploadFailed")
              }
            />
          </View>
        ) : null}
      </ScrollView>

      {/* One primary action */}
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Button
          label={pdfUri ? t("scan.uploadPdfFile") : t("scan.createAndUpload")}
          onPress={() => void uploadMutation.mutateAsync()}
          loading={uploadMutation.isPending}
          disabled={!canUpload}
        />
        {pages.length > 0 ? (
          <Text style={styles.footerNote}>
            {`${pages.length} ${t("scan.pages")} → ${t("scan.toOnePdf")}`}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  scrollFlex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: 16,
  },
  gutter: {
    padding: 16,
  },
  pageCount: {
    ...text.numericMeta,
    color: c.dim,
  },
  titleBlock: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: c.border,
  },
  titleLabel: {
    ...text.meta,
    color: c.muted,
  },
  titleInput: {
    ...text.body,
    height: 44,
    borderWidth: 1,
    borderColor: c.borderStrong,
    borderRadius: 9,
    backgroundColor: c.panel,
    color: c.ink,
    paddingHorizontal: 12,
  },
  headerLink: {
    ...text.smallStrong,
    color: c.accent,
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
  cameraHint: {
    ...text.meta,
    paddingHorizontal: 16,
    paddingTop: 14,
    color: c.dim,
  },
  error: {
    ...text.meta,
    paddingHorizontal: 16,
    paddingTop: 10,
    color: c.red,
  },
  footer: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  footerNote: {
    ...text.numeric,
    fontSize: 10.5,
    lineHeight: 14,
    color: c.faint,
    textAlign: "center",
  },
}));
