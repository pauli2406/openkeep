import { EmptyState, Screen } from "../components/ui";
import { useI18n } from "../i18n";

export function ProfileScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t("tabs.profile")}>
      <EmptyState title={t("common.comingSoon")} />
    </Screen>
  );
}
