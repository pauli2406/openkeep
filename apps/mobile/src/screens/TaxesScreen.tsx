import { EmptyState, Screen } from "../components/ui";
import { useI18n } from "../i18n";

export function TaxesScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t("tabs.taxes")}>
      <EmptyState title={t("common.comingSoon")} />
    </Screen>
  );
}
