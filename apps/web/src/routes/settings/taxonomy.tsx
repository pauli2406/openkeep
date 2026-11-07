import { createFileRoute } from "@tanstack/react-router";
import { useI18n } from "@/lib/i18n";
import { TaxonomyManagementSection } from "@/components/settings/taxonomy-section";
import { SettingsHeading } from "@/components/settings/shared";

export const Route = createFileRoute("/settings/taxonomy")({
  component: TaxonomySettingsPage,
});

function TaxonomySettingsPage() {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-5">
      <SettingsHeading
        title={t("settingsNav.taxonomy")}
        description={t("settingsNav.taxonomyDescription")}
      />
      <TaxonomyManagementSection />
    </div>
  );
}
