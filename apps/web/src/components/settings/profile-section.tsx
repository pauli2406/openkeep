import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueries, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { api, authFetch, getApiErrorMessage } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Shield,
  } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";

export function UserProfileSection() {
  const auth = useAuth();
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Shield className="h-5 w-5" />
          {t("settings.userProfile")}
        </CardTitle>
        <CardDescription>{t("settings.accountInfo")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {t("settings.displayName")}
            </Label>
            <p className="text-sm font-medium">
              {auth.user?.displayName ?? t("settings.unknown")}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("settings.email")}</Label>
            <p className="text-sm font-medium">
              {auth.user?.email ?? t("settings.unknown")}
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">{t("settings.role")}</Label>
            <div>
              {auth.user?.isOwner ? (
                <Badge variant="default">{t("settings.owner")}</Badge>
              ) : (
                <Badge variant="secondary">{t("settings.user")}</Badge>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}



