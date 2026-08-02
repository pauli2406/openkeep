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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  Brain,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";

export function LanguagePreferencesSection() {
  const auth = useAuth();
  const { t } = useI18n();
  const [preferences, setPreferences] = useState(
    auth.user?.preferences ?? {
      uiLanguage: "en" as const,
      aiProcessingLanguage: "en" as const,
      aiChatLanguage: "en" as const,
    },
  );
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"default" | "destructive">("default");

  useEffect(() => {
    if (auth.user?.preferences) {
      setPreferences(auth.user.preferences);
    }
  }, [auth.user?.preferences]);

  async function handleSave() {
    setIsSaving(true);
    setStatusMessage(null);

    try {
      await auth.updatePreferences(preferences);
      setStatusTone("default");
      setStatusMessage(t("settings.preferencesSaved"));
    } catch (error) {
      setStatusTone("destructive");
      setStatusMessage(
        error instanceof Error ? error.message : t("settings.preferencesSaveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Brain className="h-5 w-5" />
          {t("settings.languagePreferences")}
        </CardTitle>
        <CardDescription>{t("settings.languagePreferencesDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("settings.uiLanguage")}</Label>
            <Select
              value={preferences.uiLanguage}
              onValueChange={(value: "en" | "de") =>
                setPreferences((current) => ({ ...current, uiLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
                <SelectItem value="de">{t("settings.german")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("settings.aiProcessingLanguage")}</Label>
            <Select
              value={preferences.aiProcessingLanguage}
              onValueChange={(value: "en" | "de") =>
                setPreferences((current) => ({ ...current, aiProcessingLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
                <SelectItem value="de">{t("settings.german")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("settings.aiChatLanguage")}</Label>
            <Select
              value={preferences.aiChatLanguage}
              onValueChange={(value: "en" | "de") =>
                setPreferences((current) => ({ ...current, aiChatLanguage: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
                <SelectItem value="de">{t("settings.german")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? t("settings.saving") : t("settings.savePreferences")}
          </Button>
          {statusMessage ? (
            <p className={`text-sm ${statusTone === "destructive" ? "text-destructive" : "text-muted-foreground"}`}>
              {statusMessage}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

