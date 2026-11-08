import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { shareArchiveExport } from "../api/admin";
import { useAuth } from "../auth";
import { GradientPanel, Skeleton } from "../components/layout";
import { Button, EmptyState, Panel, Screen } from "../components/ui";
import { useDashboardInsights } from "../hooks/useDashboardInsights";
import { useI18n } from "../i18n";
import { purgeExports } from "../lib";
import { clearLocalHistory } from "../local-history";
import { useOfflineArchive } from "../offline-archive";
import { createThemedStyles, radii, useColors } from "../theme";
import { fonts, tabular, text } from "../typography";
import { ApiTokensSection } from "./settings/ApiTokensSection";
import { InlineError, SectionCard, errorText, fill, useIsOffline } from "./settings/shared";
import { TwoFactorSection } from "./settings/TwoFactorSection";

function initialsOf(name: string) {
  return (
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function ProfileScreen() {
  const queryClient = useQueryClient();
  const styles = useStyles();
  const colors = useColors();
  const auth = useAuth();
  const offline = useOfflineArchive();
  const isOffline = useIsOffline();
  const { t } = useI18n();
  const insights = useDashboardInsights();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const user = auth.user;
  const stats = insights.data?.stats;
  // Not "reviewed by you": `not_required` documents are in here too, and the API
  // exposes no resolved-review count. Say what the number is instead.
  const notAwaitingReview = stats ? Math.max(0, stats.totalDocuments - stats.pendingReview) : null;

  const tiles = [
    { label: t("profile.documents"), value: stats?.totalDocuments, note: null },
    {
      label: t("profile.notAwaitingReview"),
      value: notAwaitingReview,
      note: stats ? fill(t("profile.stillOpen"), { count: stats.pendingReview }) : null,
    },
    { label: t("profile.correspondents"), value: stats?.correspondentsCount, note: null },
    { label: t("profile.documentTypes"), value: stats?.documentTypesCount, note: null },
  ];

  function handleSignOut() {
    Alert.alert(t("profile.signOut"), t("profile.signOutConfirmText"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("profile.signOut"),
        style: "destructive",
        // Everything local belongs to this account, so it goes with the session.
        onPress: () =>
          void Promise.allSettled([
            offline.clearCachedDocuments(),
            clearLocalHistory(),
            purgeExports(),
          ]).finally(() => {
            queryClient.clear();
            return auth.logout();
          }),
      },
    ]);
  }

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      await shareArchiveExport(auth.authFetch, {
        failed: t("profile.exportFailed"),
        shareUnavailable: t("settings.shareUnavailable"),
        dialogTitle: t("profile.exportArchive"),
      });
    } catch (error) {
      setExportError(errorText(error, t("profile.exportFailed")));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Screen title={t("tabs.profile")} hideHeader>
      <GradientPanel>
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initialsOf(user?.displayName ?? user?.email ?? "?")}</Text>
          </View>
          <View style={styles.identityText}>
            <View style={styles.nameLine}>
              <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
                {user?.displayName ?? "—"}
              </Text>
              {user?.isOwner ? (
                <View style={styles.ownerBadge}>
                  <Text style={styles.ownerText}>{t("profile.owner")}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.email} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={handleSignOut}
          style={({ pressed }) => [styles.signOut, pressed ? styles.signOutPressed : null]}
        >
          <MaterialCommunityIcons name="logout" size={16} color={colors.onGradient} />
          <Text style={styles.signOutText}>{t("profile.signOut")}</Text>
        </Pressable>

        <View style={styles.tiles}>
          {[tiles.slice(0, 2), tiles.slice(2)].map((row, rowIndex) => (
            <View key={rowIndex} style={styles.tilesRow}>
              {row.map((tile) => (
                <View key={tile.label} style={styles.tile}>
                  <Text style={styles.tileLabel}>{tile.label}</Text>
                  {insights.isLoading ? (
                    <Skeleton style={styles.tileSkeleton} />
                  ) : (
                    <Text style={styles.tileValue}>{tile.value?.toLocaleString() ?? "—"}</Text>
                  )}
                  {tile.note ? <Text style={styles.tileNote}>{tile.note}</Text> : null}
                </View>
              ))}
            </View>
          ))}
        </View>
      </GradientPanel>

      {insights.isError ? (
        <InlineError message={t("profile.statsLoadFailed")} onRetry={() => void insights.refetch()} />
      ) : null}

      {isOffline ? (
        <Panel>
          <EmptyState
            icon="cloud-off-outline"
            title={t("profile.onlineOnly")}
            body={t("profile.securityOffline")}
          />
        </Panel>
      ) : (
        <>
          <TwoFactorSection />
          <ApiTokensSection />
          <SectionCard icon="archive-outline" title={t("profile.yourData")}>
            <Text style={styles.exportNote}>{t("profile.exportNote")}</Text>
            <Button
              variant="secondary"
              icon="download"
              label={t("profile.exportArchive")}
              loading={exporting}
              onPress={() => void handleExport()}
            />
            {exportError ? <InlineError message={exportError} /> : null}
          </SectionCard>
        </>
      )}
    </Screen>
  );
}

const useStyles = createThemedStyles((c) => ({
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  avatar: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: c.tile,
    backgroundColor: c.tile,
  },
  avatarText: {
    fontFamily: fonts.sans.semibold,
    fontSize: 18,
    lineHeight: 24,
    color: c.onGradient,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  nameLine: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
  },
  name: {
    ...text.screenTitle,
    flexShrink: 1,
    color: c.onGradient,
  },
  ownerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: c.tile,
  },
  ownerText: {
    ...text.smallStrong,
    color: c.onGradient,
  },
  email: {
    ...text.body,
    marginTop: 2,
    color: c.onGradientMuted,
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 44,
    marginTop: 14,
    borderRadius: radii.lg,
    backgroundColor: c.tile,
  },
  signOutPressed: {
    opacity: 0.85,
  },
  signOutText: {
    ...text.bodyStrong,
    color: c.onGradient,
  },
  tiles: {
    gap: 10,
    marginTop: 14,
  },
  tilesRow: {
    flexDirection: "row",
    gap: 10,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    padding: 14,
    borderRadius: radii.xl,
    backgroundColor: c.tile,
  },
  tileLabel: {
    ...text.bodyStrong,
    color: c.onGradient,
  },
  tileValue: {
    fontFamily: fonts.sans.semibold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    marginTop: 6,
    color: c.onGradient,
    ...tabular,
  },
  tileNote: {
    ...text.small,
    marginTop: 2,
    color: c.onGradientMuted,
  },
  tileSkeleton: {
    width: 56,
    height: 32,
    marginTop: 8,
    backgroundColor: c.tile,
  },
  exportNote: {
    ...text.body,
    color: c.muted,
  },
}));
