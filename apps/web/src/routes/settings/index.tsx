import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { LanguagePreferencesSection } from "@/components/settings/language-section";
import { ArchiveOperationsSection } from "@/components/settings/archive-section";
import { SystemHealthSection } from "@/components/settings/health-section";
import { ProcessingActivitySection } from "@/components/settings/processing-section";
import { SettingsHeading } from "@/components/settings/shared";

export const Route = createFileRoute("/settings/")({
  component: GeneralSettingsPage,
});

function GeneralSettingsPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <SettingsHeading
        title={t("settingsNav.general")}
        description={t("settingsNav.generalDescription")}
      />
      <LanguagePreferencesSection />
      <SystemHealthSection />
      <ProcessingActivitySection />
      <ArchiveOperationsSection />
    </div>
  );
}
