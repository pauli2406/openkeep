import { createFileRoute } from "@tanstack/react-router";
import { TaxonomyManagementSection } from "@/components/settings/taxonomy-section";

export const Route = createFileRoute("/settings/taxonomy")({
  component: TaxonomySettingsPage,
});

function TaxonomySettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <TaxonomyManagementSection />
    </div>
  );
}
