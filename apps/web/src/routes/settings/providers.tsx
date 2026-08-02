import { createFileRoute } from "@tanstack/react-router";
import { AiProvidersSection } from "@/components/settings/providers-section";
import { ProcessingActivitySection } from "@/components/settings/processing-section";

export const Route = createFileRoute("/settings/providers")({
  component: ProvidersSettingsPage,
});

function ProvidersSettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <AiProvidersSection />
      <ProcessingActivitySection />
    </div>
  );
}
