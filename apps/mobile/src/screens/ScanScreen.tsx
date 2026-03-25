import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { useNavigation } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
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
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useAuth } from "../auth";
import { Button, Card, EmptyState, ErrorCard, Field, Screen, SectionTitle } from "../components/ui";
import type { AppStackParamList } from "../../App";
import { colors } from "../theme";
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

export function ScanScreen() {
  const auth = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [pages, setPages] = useState<DraftAsset[]>([]);
  const [pdfUri, setPdfUri] = useState("");
  const [error, setError] = useState("");

  const pageUris = useMemo(() => pages.map((page) => page.uri), [pages]);

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
        throw new Error("Add a scan, image, or PDF before uploading.");
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
      setError("Camera permission is required to scan documents.");
      return;
    }

    const scanner = getScannerModule();
    if (!scanner) {
      setError(
        "The native scanner module is not available in this build yet. Reinstall the dev client after the native rebuild.",
      );
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

  return (
    <Screen includeTopSafeArea={false} title="Scan and upload" subtitle="Capture multi-page paper documents, or import an existing PDF from your device.">
      <Card>
        <Field label="Title override" value={title} onChangeText={setTitle} placeholder="Optional document title" />
        <View style={styles.buttonStack}>
          <Button label="Scan with camera" onPress={() => void handleScan()} />
          <Button label="Import images" variant="secondary" onPress={() => void handlePickImages()} />
          <Button label="Import PDF" variant="secondary" onPress={() => void handlePickFile()} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {pdfUri ? (
        <Card>
          <SectionTitle title="Imported PDF" hint="This file will upload exactly as selected." />
          <Text style={styles.fileText}>{pdfUri.split("/").pop() ?? pdfUri}</Text>
          <View style={styles.buttonStack}>
            <Button label="Share copy" variant="secondary" onPress={() => void Sharing.shareAsync(pdfUri)} />
            <Button label="Upload PDF" onPress={() => void uploadMutation.mutateAsync()} loading={uploadMutation.isPending} />
          </View>
        </Card>
      ) : null}

      {pages.length > 0 ? (
        <>
          <SectionTitle title={`Captured pages (${pages.length})`} hint="Each scan becomes a page in one uploaded PDF." />
          {pages.map((page, index) => (
            <Card key={page.id}>
              <Image source={{ uri: page.uri }} style={styles.previewImage} resizeMode="cover" />
              <View style={styles.pageRow}>
                <Text style={styles.pageTitle}>Page {index + 1}</Text>
                <Button label="Remove" variant="danger" onPress={() => removePage(page.id)} />
              </View>
            </Card>
          ))}
          {uploadMutation.isError ? <ErrorCard message={uploadMutation.error instanceof Error ? uploadMutation.error.message : "Upload failed."} /> : null}
          <Button label="Create PDF and upload" onPress={() => void uploadMutation.mutateAsync()} loading={uploadMutation.isPending} />
        </>
      ) : null}

      {!pdfUri && pages.length === 0 ? (
        <EmptyState title="Nothing queued yet" body="Use the camera for paper capture, or import an existing PDF from your device." />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  buttonStack: {
    gap: 10,
  },
  error: {
    color: colors.danger,
    fontWeight: "600",
  },
  previewImage: {
    width: "100%",
    height: 240,
    borderRadius: 18,
    backgroundColor: colors.surfaceMuted,
  },
  pageRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  fileText: {
    color: colors.text,
    lineHeight: 20,
  },
});
