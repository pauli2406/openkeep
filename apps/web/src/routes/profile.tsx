import { createFileRoute } from "@tanstack/react-router";
import { UserProfileSection } from "@/components/settings/profile-section";
import { TwoFactorSection } from "@/components/settings/two-factor-section";
import { ApiTokensSection } from "@/components/settings/api-tokens-section";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

/**
 * Interim host for the account sections moved out of settings (#55).
 * #58 turns this into the dedicated account screen.
 */
function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-5">
      <UserProfileSection />
      <TwoFactorSection />
      <ApiTokensSection />
    </div>
  );
}
