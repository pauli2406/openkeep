import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type {
  ArchiveImportResult,
  ArchiveSnapshot,
  ArchiveSnapshot as ArchiveSnapshotType,
  Correspondent,
  Document,
  DocumentType,
  HealthProvidersResponse,
  HealthResponse,
  ProcessingStatusResponse,
  ProviderConfig,
  ReadinessResponse,
  Tag,
  WatchFolderScanResponse,
} from "@openkeep/types";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Server,
  CheckCircle,
  AlertCircle,
  Loader2,
  } from "lucide-react";
import { useI18n } from "@/lib/i18n";

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Server className="h-5 w-5" />
          {t("settings.systemHealth")}
        </CardTitle>
        <CardDescription>{t("settings.systemHealthDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Health status */}
        {healthQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.checkingHealth")}
          </div>
        )}

        {healthQuery.isError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {t("settings.unableToReachServer")}
          </div>
        )}

        {healthQuery.data && (
          <div className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                healthQuery.data.status === "ok" ||
                healthQuery.data.status === "healthy"
                  ? "bg-[var(--ok-green)]"
                  : "bg-[var(--ok-amber)]"
              }`}
            />
            <div>
              <p className="text-sm font-medium">
                {t("settings.server")}:{" "}
                <span className="capitalize">{healthQuery.data.status}</span>
              </p>
            </div>
          </div>
        )}

        {/* Readiness checks */}
        {readinessQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("settings.runningReadinessChecks")}
          </div>
        )}

        {readinessQuery.data && readinessQuery.data.checks && (
          <>
            <Separator />
            <div>
              <p className="mb-2 text-sm font-medium">{t("settings.readinessChecks")}</p>
              <div className="space-y-2">
                {Object.entries(readinessQuery.data.checks).map(
                  ([name, healthy]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        {healthy ? (
                          <CheckCircle className="h-4 w-4 text-[var(--ok-green)]" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-destructive" />
                        )}
                        <span className="text-sm capitalize">{name}</span>
                      </div>
                      <Badge variant={healthy ? "success" : "destructive"}>
                        {healthy ? t("settings.ok") : t("settings.fail")}
                      </Badge>
                    </div>
                  ),
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
