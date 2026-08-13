import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth";
import { processingRefetchInterval } from "../document-processing";
import { useI18n } from "../i18n";
import { useOfflineArchive } from "../offline-archive";
import type { DashboardInsights } from "../lib";

/**
 * The dashboard insights payload. Today's screen and the tab bar both need it —
 * the tab bar for the Review dot and the Documents count — and they share one
 * query key so there is still only one request. (#107)
 */
export function useDashboardInsights() {
  const auth = useAuth();
  const { t } = useI18n();
  const offline = useOfflineArchive();
  const shouldUseCache = offline.shouldUseCache || auth.isOfflineSession;

  return useQuery({
    queryKey: ["dashboard", auth.apiUrl, shouldUseCache, offline.cacheSummary.revision],
    queryFn: async () => {
      if (shouldUseCache) {
        return offline.loadCachedDashboard();
      }

      const response = await auth.authFetch("/api/dashboard/insights");
      if (!response.ok) {
        throw new Error(t("dashboard.screen.loadInsights"));
      }
      return (await response.json()) as DashboardInsights;
    },
    refetchInterval: shouldUseCache
      ? false
      : (query) => processingRefetchInterval(query.state.data, (data) => data?.recentDocuments),
  });
}
