import { Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import { fetchHealth, fetchReadiness } from "../../api/admin";
import { useAuth } from "../../auth";
import { Skeleton } from "../../components/layout";
import { useI18n, type TranslationKey } from "../../i18n";
import { createThemedStyles, radii } from "../../theme";
import { text } from "../../typography";
import { InlineError, SectionCard, StatusBadge, SubHeading, fill, labelize } from "./shared";

const CHECK_LABELS: Record<string, TranslationKey> = {
  database: "settings.readinessDatabase",
  objectStorage: "settings.readinessObjectStorage",
  queue: "settings.readinessQueue",
};

export function HealthSection() {
  const styles = useStyles();
  const auth = useAuth();
  const { t } = useI18n();
  const focused = useIsFocused();

  const healthQuery = useQuery({
    queryKey: ["settings", "health", auth.apiUrl],
    queryFn: () => fetchHealth(auth.authFetch, t("settings.unableToReachServer")),
    refetchInterval: focused ? 30_000 : false,
  });
  const readinessQuery = useQuery({
    queryKey: ["settings", "readiness", auth.apiUrl],
    queryFn: () => fetchReadiness(auth.authFetch, t("settings.failedToFetchReadiness")),
    refetchInterval: focused ? 30_000 : false,
  });

  const healthy = healthQuery.data?.status === "ok" || healthQuery.data?.status === "healthy";

  return (
    <SectionCard
      icon="server"
      title={t("settings.systemHealth")}
      description={t("settings.systemHealthDescription")}
      action={
        healthQuery.isLoading ? (
          <Skeleton style={styles.badgeSkeleton} />
        ) : healthQuery.data ? (
          <StatusBadge
            tone={healthy ? "ok" : "warn"}
            label={fill(t("settings.serverStatus"), {
              status:
                healthQuery.data.status.charAt(0).toUpperCase() + healthQuery.data.status.slice(1),
            })}
          />
        ) : null
      }
    >
      {healthQuery.isError ? (
        <InlineError
          message={t("settings.unableToReachServer")}
          onRetry={() => void healthQuery.refetch()}
        />
      ) : null}
      {readinessQuery.isLoading ? (
        <View style={styles.checks}>
          <Skeleton style={styles.checkSkeleton} />
          <Skeleton style={styles.checkSkeleton} />
          <Skeleton style={styles.checkSkeleton} />
        </View>
      ) : null}
      {readinessQuery.isError ? (
        <InlineError
          message={t("settings.failedToFetchReadiness")}
          onRetry={() => void readinessQuery.refetch()}
        />
      ) : null}
      {readinessQuery.data?.checks ? (
        <View style={styles.checksBlock}>
          <SubHeading>{t("settings.readinessChecks")}</SubHeading>
          <View style={styles.checks}>
            {Object.entries(readinessQuery.data.checks).map(([name, ok]) => (
              <View key={name} style={styles.check}>
                <Text style={styles.checkName} numberOfLines={1}>
                  {CHECK_LABELS[name] ? t(CHECK_LABELS[name]) : labelize(name)}
                </Text>
                <StatusBadge
                  tone={ok ? "ok" : "bad"}
                  label={ok ? t("settings.ok") : t("settings.fail")}
                />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </SectionCard>
  );
}

const useStyles = createThemedStyles((c) => ({
  badgeSkeleton: {
    width: 72,
    height: 22,
    borderRadius: radii.pill,
  },
  checksBlock: {
    gap: 8,
  },
  checks: {
    gap: 8,
  },
  check: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radii.lg,
  },
  checkName: {
    ...text.body,
    flex: 1,
    color: c.ink,
  },
  checkSkeleton: {
    height: 44,
    borderRadius: radii.lg,
  },
}));
