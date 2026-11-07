import { useState } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import type { AppStackParamList } from "../../../App";
import {
  fetchEmailIngestStatus,
  fetchWatchFolderStatus,
  importArchiveSnapshot,
  parseArchiveSnapshot,
  pollEmailInbox,
  scanWatchFolder,
  shareArchiveExport,
  type ArchiveImportMode,
  type ParsedSnapshot,
  type WatchFolderAction,
  type WatchFolderScan,
  type WatchFolderScanItem,
} from "../../api/admin";
import { useAuth } from "../../auth";
import { IconTile, Segmented, Skeleton } from "../../components/layout";
import { Button, Pill, type PillTone } from "../../components/ui";
import { useI18n } from "../../i18n";
import { responseToMessage, type ArchiveDocument } from "../../lib";
import { createThemedStyles, radii, useColors } from "../../theme";
import { text } from "../../typography";
import {
  Fact,
  InlineError,
  SectionCard,
  StatTile,
  StatusBadge,
  SubHeading,
  TileGrid,
  errorText,
  fill,
  formatDateTime,
  labelize,
} from "./shared";

function SourceHead({
  icon,
  title,
  description,
  status,
}: {
  icon: string;
  title: string;
  description: string;
  status: { configured: boolean; label: string } | null;
}) {
  const styles = useStyles();
  const colors = useColors();
  return (
    <View style={styles.sourceHead}>
      <IconTile size="sm">
        <MaterialCommunityIcons name={icon as never} size={15} color={colors.accentSoftInk} />
      </IconTile>
      <View style={styles.sourceText}>
        <View style={styles.sourceTitleRow}>
          <Text style={styles.sourceTitle}>{title}</Text>
          {status ? (
            <StatusBadge tone={status.configured ? "ok" : "muted"} label={status.label} />
          ) : null}
        </View>
        <Text style={styles.sourceBody}>{description}</Text>
      </View>
    </View>
  );
}

const ACTION_TONES: Record<WatchFolderAction, PillTone> = {
  imported: "ok",
  duplicate: "soft",
  unsupported: "bad",
  failed: "bad",
  planned: "outline",
};

function actionLabel(action: WatchFolderAction) {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function fieldValue(document: ArchiveDocument, field: string): string | null {
  switch (field) {
    case "correspondent":
      return document.correspondent?.name ?? null;
    case "issueDate":
      return document.issueDate ?? null;
    case "dueDate":
      return document.dueDate ?? null;
    case "expiryDate":
      return document.expiryDate ?? null;
    case "amount":
      return document.amount !== null && document.amount !== undefined
        ? `${document.amount.toFixed(2)} ${document.currency ?? ""}`.trim()
        : null;
    case "currency":
      return document.currency ?? null;
    case "referenceNumber":
      return document.referenceNumber ?? null;
    case "holderName":
      return document.holderName ?? null;
    case "issuingAuthority":
      return document.issuingAuthority ?? null;
    default:
      return null;
  }
}

/** What extraction found in a document a scan just imported. */
function ExtractedFields({ documentId }: { documentId: string }) {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ["settings", "scan-document", auth.apiUrl, documentId],
    queryFn: async () => {
      const response = await auth.authFetch(`/api/documents/${documentId}`);
      if (!response.ok) throw new Error(await responseToMessage(response));
      return (await response.json()) as ArchiveDocument;
    },
  });

  if (query.isLoading) {
    return <Text style={styles.detail}>{t("settings.loadingExtractedFields")}</Text>;
  }
  if (query.isError) {
    return <Text style={styles.detailBad}>{t("settings.failedToLoadExtractedFields")}</Text>;
  }
  const document = query.data;
  if (!document) {
    return <Text style={styles.detail}>{t("settings.noExtractedFieldsYet")}</Text>;
  }
  const evidence = document.metadata?.reviewEvidence;
  const required = evidence?.requiredFields ?? [];
  if (required.length === 0) {
    return <Text style={styles.detail}>{t("settings.keyFieldExtractionUnavailable")}</Text>;
  }
  const missing = new Set(
    evidence?.missingFields ?? required.filter((field) => !fieldValue(document, field)),
  );
  const found = required
    .map((field) => ({ field, value: fieldValue(document, field) }))
    .filter((entry) => !missing.has(entry.field) && entry.value !== null);

  return (
    <View style={styles.fields}>
      {evidence?.confidence != null ? (
        <Text style={styles.detail}>
          {`${t("settings.confidence")}: ${(evidence.confidence * 100).toFixed(0)}%`}
          {evidence.confidenceThreshold != null
            ? ` · ${t("settings.threshold")}: ${(evidence.confidenceThreshold * 100).toFixed(0)}%`
            : ""}
        </Text>
      ) : null}
      <SubHeading>{t("settings.foundValues")}</SubHeading>
      {found.length > 0 ? (
        found.map(({ field, value }) => (
          <View key={field} style={styles.foundField}>
            <Text style={styles.detail}>{labelize(field)}</Text>
            <Text style={styles.foundValue}>{value}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.detail}>{t("settings.noKeyFieldsFound")}</Text>
      )}
      <SubHeading>{t("settings.missingKeyFields")}</SubHeading>
      {missing.size > 0 ? (
        <View style={styles.pills}>
          {Array.from(missing).map((field) => (
            <Pill key={field} tone="warn" label={labelize(field)} />
          ))}
        </View>
      ) : (
        <Text style={styles.detail}>{t("settings.noneMissing")}</Text>
      )}
    </View>
  );
}

function ScanItem({ item, first }: { item: WatchFolderScanItem; first: boolean }) {
  const styles = useStyles();
  const colors = useColors();
  const { t } = useI18n();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.item, first ? null : styles.itemRule]}>
      <View style={styles.pills}>
        <Pill tone={ACTION_TONES[item.action]} label={actionLabel(item.action)} />
      </View>
      <Text selectable style={styles.mono}>
        {item.path}
      </Text>
      <Text style={styles.detail}>{`${t("settings.reason")}: ${labelize(item.reason)}`}</Text>
      {item.failureCode ? (
        <Text style={styles.detail}>{`${t("settings.code")}: ${item.failureCode}`}</Text>
      ) : null}
      {item.mimeType ? <Text style={styles.detail}>{`${t("settings.mime")}: ${item.mimeType}`}</Text> : null}
      {item.destinationPath ? (
        <Text style={styles.detail}>{`${t("settings.destination")}: ${item.destinationPath}`}</Text>
      ) : null}
      {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
      {item.documentId ? (
        <>
          <View style={styles.itemActions}>
            <Button
              size="sm"
              variant="secondary"
              label={t("settings.openDocument")}
              onPress={() => navigation.navigate("DocumentDetail", { documentId: item.documentId! })}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((value) => !value)}
            style={styles.disclosure}
          >
            <MaterialCommunityIcons
              name={open ? "chevron-down" : "chevron-right"}
              size={16}
              color={colors.muted}
            />
            <Text style={styles.disclosureText}>{t("settings.inspectExtractedFields")}</Text>
          </Pressable>
          {open ? <ExtractedFields documentId={item.documentId} /> : null}
        </>
      ) : null}
    </View>
  );
}

function ScanResult({ result }: { result: WatchFolderScan }) {
  const styles = useStyles();
  const { t, language } = useI18n();
  const { summary } = result;
  const problems = result.items.filter(
    (item) => item.action === "failed" || item.action === "unsupported",
  );
  return (
    <View style={styles.result}>
      <View style={styles.resultHead}>
        <Text style={styles.sourceTitle}>{t("settings.watchFolderScan")}</Text>
        <Text selectable style={styles.mono}>{`${t("settings.path")}: ${result.configuredPath}`}</Text>
      </View>
      <TileGrid>
        {[
          <StatTile
            key="imported"
            label={t("settings.imported")}
            value={summary.imported}
            tone={summary.imported > 0 ? "brand" : "default"}
          />,
          <StatTile
            key="duplicate"
            label={t("settings.duplicates")}
            value={summary.duplicate}
            tone={summary.duplicate > 0 ? "brand" : "default"}
          />,
          <StatTile
            key="unsupported"
            label={t("settings.unsupported")}
            value={summary.unsupported}
            tone={summary.unsupported > 0 ? "warning" : "default"}
          />,
          <StatTile
            key="failed"
            label={t("settings.failures")}
            value={summary.failed}
            tone={summary.failed > 0 ? "warning" : "default"}
          />,
          <StatTile
            key="total"
            label={result.dryRun ? t("settings.planned") : t("settings.total")}
            value={result.dryRun ? summary.planned : summary.total}
            tone={(result.dryRun ? summary.planned : summary.total) > 0 ? "brand" : "default"}
          />,
        ]}
      </TileGrid>
      {result.items.length > 0 ? (
        <View style={styles.block}>
          <SubHeading
            right={
              <Text style={styles.detail}>
                {`${result.items.length} ${t(result.items.length === 1 ? "settings.itemOne" : "settings.itemOther")}`}
              </Text>
            }
          >
            {t("settings.currentScanResults")}
          </SubHeading>
          <View style={styles.list}>
            {result.items.map((item, index) => (
              <ScanItem key={`${item.path}:${item.action}:${item.reason}`} item={item} first={index === 0} />
            ))}
          </View>
        </View>
      ) : null}
      {problems.length > 0 ? (
        <View style={styles.block}>
          <SubHeading>{t("settings.currentScanIssues")}</SubHeading>
          <View style={styles.list}>
            {problems.map((item, index) => (
              <View key={`${item.path}:${item.reason}`} style={[styles.item, index === 0 ? null : styles.itemRule]}>
                <View style={styles.pills}>
                  <Pill tone="bad" label={actionLabel(item.action)} />
                </View>
                <Text selectable style={styles.mono}>
                  {item.path}
                </Text>
                <Text style={styles.detail}>{`${t("settings.reason")}: ${labelize(item.reason)}`}</Text>
                {item.failureCode ? (
                  <Text style={styles.detail}>{`${t("settings.code")}: ${item.failureCode}`}</Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}
      {result.history.length > 0 ? (
        <View style={styles.block}>
          <SubHeading>{t("settings.recentScans")}</SubHeading>
          <View style={styles.list}>
            {result.history.map((entry, index) => (
              <View key={entry.scannedAt} style={[styles.item, index === 0 ? null : styles.itemRule]}>
                <Text style={styles.foundValue}>{formatDateTime(entry.scannedAt, language)}</Text>
                <Text style={styles.detail}>
                  {entry.dryRun ? t("settings.dryRunEnabled") : t("settings.liveScan")}
                </Text>
                <Text style={styles.detail}>
                  {[
                    `${t("settings.imported")}: ${entry.imported}`,
                    `${t("settings.duplicates")}: ${entry.duplicate}`,
                    `${t("settings.unsupported")}: ${entry.unsupported}`,
                    `${t("settings.failures")}: ${entry.failed}`,
                    `${t("settings.planned")}: ${entry.planned}`,
                  ].join(" · ")}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function ArchiveSection() {
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { t, language } = useI18n();
  const focused = useIsFocused();
  const [dryRun, setDryRun] = useState(true);
  const [mode, setMode] = useState<ArchiveImportMode>("replace");
  const [scan, setScan] = useState<WatchFolderScan | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const watchQuery = useQuery({
    queryKey: ["settings", "watch-folder", auth.apiUrl],
    queryFn: () => fetchWatchFolderStatus(auth.authFetch, t("settings.watchFolderStatusFailed")),
    refetchInterval: focused ? 30_000 : false,
  });
  const emailQuery = useQuery({
    queryKey: ["settings", "email-ingest", auth.apiUrl],
    queryFn: () => fetchEmailIngestStatus(auth.authFetch, t("settings.emailInboxStatusFailed")),
    refetchInterval: focused ? 30_000 : false,
  });

  const scanMutation = useMutation({
    mutationFn: () => scanWatchFolder(auth.authFetch, dryRun, t("settings.failedToScanWatchFolder")),
    onSuccess: (data) => {
      setScan(data);
      void queryClient.invalidateQueries({ queryKey: ["settings", "watch-folder"] });
    },
  });
  const pollMutation = useMutation({
    mutationFn: () => pollEmailInbox(auth.authFetch, t("settings.emailInboxPollFailed")),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["settings", "email-ingest"] });
    },
  });
  const exportMutation = useMutation({
    mutationFn: () =>
      shareArchiveExport(auth.authFetch, {
        failed: t("settings.exportArchiveFailed"),
        shareUnavailable: t("settings.shareUnavailable"),
        dialogTitle: t("settings.exportSnapshot"),
      }),
  });
  const importMutation = useMutation({
    mutationFn: (parsed: ParsedSnapshot) =>
      importArchiveSnapshot(
        auth.authFetch,
        { mode, snapshot: parsed.snapshot },
        t("settings.importArchiveFailed"),
      ),
    // Everything may have changed, so nothing on any screen can be trusted.
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });

  async function pickAndImport() {
    setPickError(null);
    importMutation.reset();
    setPicking(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/plain", "application/octet-stream"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets[0]) return;
      const asset = picked.assets[0];
      const parsed = parseArchiveSnapshot(await FileSystem.readAsStringAsync(asset.uri));
      if (!parsed) {
        setPickError(t("settings.importInvalidFile"));
        return;
      }
      const values = { file: asset.name, count: parsed.documentCount };
      Alert.alert(
        t(mode === "replace" ? "settings.importConfirmReplaceTitle" : "settings.importConfirmMergeTitle"),
        fill(t(mode === "replace" ? "settings.importConfirmReplace" : "settings.importConfirmMerge"), values),
        [
          { text: t("settings.cancel"), style: "cancel" },
          {
            text: mode === "replace" ? t("settings.replace") : t("settings.importModeMerge"),
            style: mode === "replace" ? "destructive" : "default",
            onPress: () => importMutation.mutate(parsed),
          },
        ],
      );
    } catch (error) {
      setPickError(errorText(error, t("settings.importArchiveFailed")));
    } finally {
      setPicking(false);
    }
  }

  const watch = watchQuery.data;
  const email = emailQuery.data;
  const lastPoll = typeof email?.lastPoll?.at === "string" ? (email.lastPoll.at as string) : null;

  return (
    <SectionCard
      icon="archive-outline"
      title={t("settings.archivePortability")}
      description={t("settings.archivePortabilityDescription")}
    >
      <View style={styles.block}>
        <SubHeading>{t("settings.sources")}</SubHeading>

        <View style={styles.source}>
          <View style={styles.sourceBodyWrap}>
            {watchQuery.isLoading ? <Skeleton style={styles.sourceSkeleton} /> : null}
            {watchQuery.isError ? (
              <InlineError
                message={errorText(watchQuery.error, t("settings.watchFolderStatusFailed"))}
                onRetry={() => void watchQuery.refetch()}
              />
            ) : null}
            {watch ? (
              <>
                <SourceHead
                  icon="folder-search-outline"
                  title={t("settings.watchFolderServer")}
                  description={t("settings.watchFolderServerDescriptionMobile")}
                  status={{
                    configured: watch.configured,
                    label: watch.configured ? t("settings.configured") : t("settings.notConfigured"),
                  }}
                />
                {watch.configuredPath ? (
                  <Text selectable style={styles.mono}>{`${t("settings.path")}: ${watch.configuredPath}`}</Text>
                ) : null}
                <Fact
                  label={t("settings.lastScan")}
                  value={
                    formatDateTime(watch.lastScan?.scannedAt, language) ?? t("settings.neverScanned")
                  }
                />
                <Fact
                  label={t("settings.lastImport")}
                  value={
                    formatDateTime(watch.lastImport?.scannedAt, language) ?? t("settings.neverScanned")
                  }
                />
              </>
            ) : null}
          </View>
          <View style={styles.sourceFooter}>
            <View style={styles.dryRun}>
              <Switch
                accessibilityLabel={t("settings.dryRun")}
                value={dryRun}
                onValueChange={setDryRun}
                trackColor={{ false: colors.borderStrong, true: colors.accentFill }}
                thumbColor={colors.onGradient}
              />
              <Text style={styles.dryRunText} numberOfLines={2}>
                {dryRun ? t("settings.dryRunEnabled") : t("settings.dryRunDisabled")}
              </Text>
            </View>
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              label={t("settings.scanWatchFolder")}
              loading={scanMutation.isPending}
              onPress={() => scanMutation.mutate()}
            />
          </View>
        </View>

        {scanMutation.isError ? (
          <InlineError message={errorText(scanMutation.error, t("settings.failedToScanWatchFolder"))} />
        ) : null}
        {scan ? <ScanResult result={scan} /> : null}

        {emailQuery.isError ? (
          <InlineError
            message={errorText(emailQuery.error, t("settings.emailInboxStatusFailed"))}
            onRetry={() => void emailQuery.refetch()}
          />
        ) : null}
        {emailQuery.isLoading ? <Skeleton style={styles.sourceSkeleton} /> : null}
        {email ? (
          <View style={[styles.source, styles.sourceBodyWrap]}>
            <SourceHead
              icon="email-outline"
              title={t("settings.emailInbox")}
              description={t("settings.emailInboxDescription")}
              status={{
                configured: email.configured,
                label: email.configured ? t("settings.configured") : t("settings.notConfigured"),
              }}
            />
            {email.mailbox ? (
              <Text selectable style={styles.mono}>
                {`${email.mailbox.user}@${email.mailbox.host} · ${email.mailbox.folder}`}
              </Text>
            ) : null}
            <Fact
              label={t("settings.lastPoll")}
              value={formatDateTime(lastPoll, language) ?? t("settings.neverPolled")}
            />
            <Text style={styles.detail}>
              {[
                `${t("settings.emailImported")}: ${email.counts.imported}`,
                `${t("settings.emailSkipped")}: ${email.counts.skipped}`,
                `${t("settings.emailRejected")}: ${email.counts.rejected}`,
              ].join(" · ")}
            </Text>
            {email.recentRejections.length > 0 ? (
              <View style={styles.rejections}>
                <Text style={styles.rejectionsTitle}>{t("settings.recentRejections")}</Text>
                {email.recentRejections.slice(0, 5).map((rejection) => (
                  <Text
                    key={`${rejection.fromAddress}-${rejection.createdAt}`}
                    style={styles.detail}
                  >
                    {`${rejection.fromAddress || "?"} — ${rejection.reason ?? rejection.status}${
                      rejection.subject ? ` (${rejection.subject})` : ""
                    }`}
                  </Text>
                ))}
              </View>
            ) : null}
            {email.configured ? (
              <View style={styles.itemActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="refresh"
                  label={t("settings.pollNow")}
                  loading={pollMutation.isPending}
                  onPress={() => pollMutation.mutate()}
                />
              </View>
            ) : null}
            {pollMutation.isSuccess ? <Text style={styles.okText}>{t("settings.pollQueued")}</Text> : null}
            {pollMutation.isError ? (
              <InlineError message={errorText(pollMutation.error, t("settings.emailInboxPollFailed"))} />
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.block}>
        <SubHeading>{t("settings.snapshotSection")}</SubHeading>
        <Text style={styles.detail}>{t("settings.snapshotHint")}</Text>
        <Text style={styles.modeLabel}>{t("settings.importMode")}</Text>
        <Segmented<ArchiveImportMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "replace", label: t("settings.replace") },
            { value: "merge", label: t("settings.importModeMerge") },
          ]}
        />
        <View style={styles.snapshotActions}>
          <Button
            icon="download"
            label={t("settings.exportSnapshot")}
            loading={exportMutation.isPending}
            onPress={() => exportMutation.mutate()}
          />
          <Button
            variant="secondary"
            icon="upload"
            label={t("settings.importSnapshot")}
            loading={importMutation.isPending || picking}
            onPress={() => void pickAndImport()}
          />
        </View>
        {exportMutation.isError ? (
          <InlineError message={errorText(exportMutation.error, t("settings.exportArchiveFailed"))} />
        ) : null}
        {importMutation.isError ? (
          <InlineError message={errorText(importMutation.error, t("settings.importArchiveFailed"))} />
        ) : null}
        {pickError ? <InlineError message={pickError} /> : null}
        {importMutation.data ? (
          <View style={styles.importResult}>
            <SubHeading>{t("settings.lastImportResult")}</SubHeading>
            <Text style={styles.foundValue}>
              {fill(t("settings.importResultBody"), {
                mode: importMutation.data.mode === "replace" ? t("settings.replace") : t("settings.importModeMerge"),
                documents: importMutation.data.documentCount,
                files: importMutation.data.fileCount,
              })}
            </Text>
          </View>
        ) : null}
      </View>
    </SectionCard>
  );
}

const useStyles = createThemedStyles((c) => ({
  block: {
    gap: 10,
  },
  source: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  sourceBodyWrap: {
    gap: 8,
    padding: 14,
  },
  sourceSkeleton: {
    height: 64,
    borderRadius: radii.lg,
  },
  sourceHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  sourceText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  sourceTitleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  sourceTitle: {
    ...text.bodyStrong,
    color: c.ink,
  },
  sourceBody: {
    ...text.meta,
    color: c.muted,
  },
  sourceFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bar,
  },
  dryRun: {
    flex: 1,
    flexBasis: 150,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
  },
  dryRunText: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  mono: {
    ...text.mono,
    color: c.muted,
  },
  detail: {
    ...text.small,
    color: c.muted,
  },
  detailBad: {
    ...text.small,
    color: c.red,
  },
  okText: {
    ...text.small,
    color: c.green,
  },
  result: {
    gap: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.xl,
  },
  resultHead: {
    gap: 2,
  },
  list: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
    overflow: "hidden",
  },
  item: {
    gap: 4,
    padding: 12,
  },
  itemRule: {
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  itemActions: {
    flexDirection: "row",
    marginTop: 6,
  },
  pills: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  disclosure: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
  },
  disclosureText: {
    ...text.bodyStrong,
    color: c.ink,
  },
  fields: {
    gap: 8,
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
  },
  foundField: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.md,
    backgroundColor: c.panel,
  },
  foundValue: {
    ...text.amount,
    color: c.ink,
  },
  rejections: {
    gap: 4,
    padding: 10,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
  },
  rejectionsTitle: {
    ...text.smallStrong,
    color: c.ink,
  },
  modeLabel: {
    ...text.metaStrong,
    color: c.ink,
  },
  snapshotActions: {
    gap: 8,
    marginTop: 4,
  },
  importResult: {
    gap: 6,
    padding: 12,
    borderRadius: radii.lg,
    backgroundColor: c.bar,
  },
}));
