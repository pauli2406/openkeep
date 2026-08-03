import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { AiProvidersSection } from "@/components/settings/providers-section";
import { ProcessingActivitySection } from "@/components/settings/processing-section";

export const Route = createFileRoute("/settings/providers")({
  component: ProvidersSettingsPage,
});

function ProvidersSettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      {/* Section cards render a div title, so each destination needs its own
          page heading for assistive technology. */}
      <h1 className="ok-page-title">{t("settingsNav.providers")}</h1>
      <AiProvidersSection />
      <ProcessingActivitySection />
    </div>
  );
}
