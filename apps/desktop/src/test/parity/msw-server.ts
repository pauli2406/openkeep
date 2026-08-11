import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

export function desktopApiUrl(path: string) {
  return new URL(path, window.location.origin).toString();
}

export const emptyFacets = {
  years: [],
  correspondents: [],
  documentTypes: [],
  tags: [],
  amountRange: { min: null, max: null },
  statuses: [],
};

export const emptyInsights = {
  stats: {
    totalDocuments: 0,
    pendingReview: 0,
    documentTypesCount: 0,
    correspondentsCount: 0,
  },
  topCorrespondents: [],
  upcomingDeadlines: [],
  overdueItems: [],
  recentDocuments: [],
  monthlyActivity: [],
};

export const desktopParityServer = setupServer(
  http.get(desktopApiUrl("/api/dashboard/insights"), () =>
    HttpResponse.json(emptyInsights),
  ),
  http.get(desktopApiUrl("/api/documents/facets"), () =>
    HttpResponse.json(emptyFacets),
  ),
  http.get(desktopApiUrl("/api/documents/:id/qa-history"), () =>
    HttpResponse.json([]),
  ),
);
