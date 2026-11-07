import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "../auth";
import { buildSuggestions } from "../components/chat/palette";
import { useI18n } from "../i18n";
import type { DashboardInsights, FacetsResponse } from "../lib";

export function useSuggestions(
  authFetch: (path: string, init?: RequestInit) => Promise<Response>,
  enabled: boolean,
) {
  const { t } = useI18n();
  const { apiUrl } = useAuth();

  const facetsQuery = useQuery({
    queryKey: ["search", "facets", apiUrl],
    queryFn: async () => {
      const response = await authFetch("/api/documents/facets");
      if (!response.ok) throw new Error("Failed to load facets");
      return (await response.json()) as FacetsResponse;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const insightsQuery = useQuery({
    queryKey: ["search", "dashboard-insights", apiUrl],
    queryFn: async () => {
      const response = await authFetch("/api/dashboard/insights");
      if (!response.ok) throw new Error("Failed to load insights");
      return (await response.json()) as DashboardInsights;
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  });

  const suggestions = useMemo(
    () => buildSuggestions(facetsQuery.data, insightsQuery.data, t),
    [facetsQuery.data, insightsQuery.data, t],
  );

  const isLoading = enabled && (facetsQuery.isLoading || insightsQuery.isLoading);

  return { suggestions, isLoading, facets: facetsQuery.data };
}
