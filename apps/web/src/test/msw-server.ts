import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { apiUrl } from "./api-url";
import { makeHealthProvidersResponse } from "./fixtures";

export const server = setupServer(
  http.get(apiUrl("/api/dashboard/insights"), () =>
    HttpResponse.json({
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
    }),
  ),
  http.get(apiUrl("/api/health/providers"), () =>
    HttpResponse.json(makeHealthProvidersResponse()),
  ),
  http.get(apiUrl("/api/documents/:id/qa-history"), () => HttpResponse.json([])),
);
