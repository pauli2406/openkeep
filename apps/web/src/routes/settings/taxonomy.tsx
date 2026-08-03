import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { TaxonomyManagementSection } from "@/components/settings/taxonomy-section";

export const Route = createFileRoute("/settings/taxonomy")({
  component: TaxonomySettingsPage,
});

function TaxonomySettingsPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      {/* Section cards render a div title, so each destination needs its own
          page heading for assistive technology. */}
      <h1 className="ok-page-title">{t("settingsNav.taxonomy")}</h1>
      <TaxonomyManagementSection />
    </div>
  );
}
