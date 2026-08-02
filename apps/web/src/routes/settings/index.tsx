import { createFileRoute } from "@tanstack/react-router";
import { LanguagePreferencesSection } from "@/components/settings/language-section";
import { ArchiveOperationsSection } from "@/components/settings/archive-section";
import { SystemHealthSection } from "@/components/settings/health-section";

export const Route = createFileRoute("/settings/")({
  component: GeneralSettingsPage,
});

function GeneralSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <LanguagePreferencesSection />
      <ArchiveOperationsSection />
      <SystemHealthSection />
    </div>
  );
}
