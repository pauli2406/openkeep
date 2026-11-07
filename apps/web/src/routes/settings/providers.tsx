import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { AiProvidersSection } from "@/components/settings/providers-section";
import { SettingsHeading } from "@/components/settings/shared";

export const Route = createFileRoute("/settings/providers")({
  component: ProvidersSettingsPage,
});

function ProvidersSettingsPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <SettingsHeading
        title={t("settingsNav.providers")}
        description={t("settingsNav.providersDescription")}
      />
      <AiProvidersSection />
    </div>
  );
}
