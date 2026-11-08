import { useEffect, useState } from "react";
import type { UserLanguagePreferences } from "@openkeep/types";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SectionCard, SettingRow } from "./shared";

type LanguageField = "uiLanguage" | "aiProcessingLanguage" | "aiChatLanguage";

export function LanguagePreferencesSection() {
  const auth = useAuth();
  const { t } = useI18n();
  const [preferences, setPreferences] = useState<UserLanguagePreferences>(
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

  const languageRows: Array<{ field: LanguageField; label: string; hint: string }> = [
    {
      field: "uiLanguage",
      label: t("settings.uiLanguage"),
      hint: t("settings.uiLanguageHint"),
    },
    {
      field: "aiProcessingLanguage",
      label: t("settings.aiProcessingLanguage"),
      hint: t("settings.aiProcessingLanguageHint"),
    },
    {
      field: "aiChatLanguage",
      label: t("settings.aiChatLanguage"),
      hint: t("settings.aiChatLanguageHint"),
    },
  ];

  return (
    <SectionCard
      icon={<Languages />}
      title={t("settings.languagePreferences")}
      description={t("settings.languagePreferencesDescription")}
      footer={
        <>
          <Button onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <Spinner /> : null}
            {isSaving ? t("settings.saving") : t("settings.savePreferences")}
          </Button>
          {statusMessage ? (
            <p
              role={statusTone === "destructive" ? "alert" : "status"}
              className={cn(
                "text-sm",
                statusTone === "destructive" ? "text-destructive" : "text-success",
              )}
            >
              {statusMessage}
            </p>
          ) : null}
        </>
      }
    >
      <div className="divide-y">
        {languageRows.map((row) => (
          <SettingRow
            key={row.field}
            label={row.label}
            description={row.hint}
            htmlFor={`preference-${row.field}`}
          >
            <Select
              value={preferences[row.field]}
              onValueChange={(value: "en" | "de") =>
                setPreferences((current) => ({ ...current, [row.field]: value }))
              }
            >
              <SelectTrigger id={`preference-${row.field}`} className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("settings.english")}</SelectItem>
                <SelectItem value="de">{t("settings.german")}</SelectItem>
              </SelectContent>
            </Select>
          </SettingRow>
        ))}
        <SettingRow
          label={t("settings.emailDigest")}
          description={t("settings.emailDigestDescription")}
          htmlFor="preference-email-digest"
        >
          <Switch
            id="preference-email-digest"
            checked={preferences.emailDigestEnabled ?? false}
            onCheckedChange={(checked) =>
              setPreferences((current) => ({ ...current, emailDigestEnabled: checked }))
            }
          />
        </SettingRow>
      </div>
    </SectionCard>
  );
}
