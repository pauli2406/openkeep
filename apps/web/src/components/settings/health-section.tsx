import { useQuery } from "@tanstack/react-query";
import type { HealthResponse, ReadinessResponse } from "@openkeep/types";
import { Server } from "lucide-react";
import { api } from "@/lib/api";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import {
  RetryAlert,
  SectionCard,
  StatusBadge,
  formatWatchFolderFieldLabel,
} from "./shared";

export function SystemHealthSection() {
  const { t } = useI18n();
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchHealth"));
      }
      return data as HealthResponse;
    },
    refetchInterval: 30000,
  });

  const readinessQuery = useQuery({
    queryKey: ["health", "ready"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/api/health/ready");
      if (!response.ok || error || !data) {
        throw error ?? new Error(t("settings.failedToFetchReadiness"));
      }
      return data as ReadinessResponse;
    },
    refetchInterval: 30000,
  });

  const serverHealthy =
    healthQuery.data?.status === "ok" || healthQuery.data?.status === "healthy";

  return (
    <SectionCard
      icon={<Server />}
      title={t("settings.systemHealth")}
      description={t("settings.systemHealthDescription")}
      action={
        healthQuery.isLoading ? (
          <Skeleton
            className="h-5.5 w-16 rounded-full"
            aria-label={t("settings.checkingHealth")}
          />
        ) : healthQuery.data ? (
          <StatusBadge tone={serverHealthy ? "ok" : "warn"}>
            {t("settings.server")}: <span className="capitalize">{healthQuery.data.status}</span>
          </StatusBadge>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        {healthQuery.isError ? (
          <RetryAlert
            message={t("settings.unableToReachServer")}
            onRetry={() => void healthQuery.refetch()}
          />
        ) : null}

        {readinessQuery.isLoading ? (
          <div
            className="grid gap-2 sm:grid-cols-3"
            role="status"
            aria-label={t("settings.runningReadinessChecks")}
          >
            <Skeleton className="h-11 rounded-lg" />
            <Skeleton className="h-11 rounded-lg" />
            <Skeleton className="h-11 rounded-lg" />
          </div>
        ) : null}

        {readinessQuery.isError ? (
          <RetryAlert
            message={t("settings.failedToFetchReadiness")}
            onRetry={() => void readinessQuery.refetch()}
          />
        ) : null}

        {readinessQuery.data?.checks ? (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t("settings.readinessChecks")}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {Object.entries(readinessQuery.data.checks).map(([name, healthy]) => (
                <Item key={name} variant="outline" size="sm" className="flex-nowrap">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="truncate font-normal">
                      {formatWatchFolderFieldLabel(name)}
                    </ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <StatusBadge tone={healthy ? "ok" : "bad"}>
                      {healthy ? t("settings.ok") : t("settings.fail")}
                    </StatusBadge>
                  </ItemActions>
                </Item>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
