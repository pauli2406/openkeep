import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useI18n } from "../i18n";
import type { DashboardInsights, FacetsResponse } from "../lib";

export function useSuggestions(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  enabled: boolean,
) {
  const { t } = useI18n();

  const facetsQuery = useQuery({
    queryKey: ["search", "facets"],
    queryFn: async () => {
      const response = await authFetch("/api/documents/facets");
      if (!response.ok) throw new Error("Failed to load facets");
      return (await response.json()) as FacetsResponse;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const insightsQuery = useQuery({
    queryKey: ["search", "dashboard-insights"],
    queryFn: async () => {
      const response = await authFetch("/api/dashboard/insights");
      if (!response.ok) throw new Error("Failed to load insights");
      return (await response.json()) as DashboardInsights;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const suggestions = useMemo(() => {
    const facets = facetsQuery.data;
    const insights = insightsQuery.data;
    if (!facets && !insights) return [];

    const items: string[] = [];

    if (insights?.overdueItems && insights.overdueItems.length > 0) {
      items.push(t("suggestions.overdue"));
    }

    if (insights?.upcomingDeadlines && insights.upcomingDeadlines.length > 0) {
      items.push(t("suggestions.upcomingDeadlines"));
    }

    const topCorrespondent = facets?.correspondents[0];
    if (topCorrespondent) {
      items.push(`${t("suggestions.summarizeFrom")} ${topCorrespondent.name}`);
    }

    const secondCorrespondent = facets?.correspondents[1];
    if (secondCorrespondent) {
      items.push(`${t("suggestions.keyTopics")} ${secondCorrespondent.name} ${t("suggestions.documentsSuffix")}`);
    }

    const topDocType = facets?.documentTypes[0];
    if (topDocType) {
      items.push(`${t("suggestions.showAll")} ${topDocType.name.toLowerCase()} ${t("correspondents.documents")}`);
    }

    const topTag = facets?.tags[0];
    if (topTag) {
      items.push(`${t("suggestions.tagged")} "${topTag.name}"?`);
    }

    return items.slice(0, 5);
  }, [facetsQuery.data, insightsQuery.data, t]);

  const isLoading = facetsQuery.isLoading || insightsQuery.isLoading;

  return { suggestions, isLoading };
}
