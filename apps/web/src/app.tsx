import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AuthProvider, useAuth } from "./hooks/use-auth";
import { I18nProvider } from "./lib/i18n";

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: {
      queryClient,
      auth: undefined!,
    },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });
}

export function createAppInstance() {
  const queryClient = createAppQueryClient();
  const router = createAppRouter(queryClient);
  return { queryClient, router };
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

export function AppRouter({
  router,
  queryClient,
}: ReturnType<typeof createAppInstance>) {
  const auth = useAuth();

  useEffect(() => {
    router.invalidate();
  }, [auth.isAuthenticated, auth.isLoading, auth.needsSetup, router]);

  return (
    <I18nProvider language={auth.user?.preferences.uiLanguage}>
      <RouterProvider router={router} context={{ auth, queryClient }} />
    </I18nProvider>
  );
}

export function App() {
  const [appInstance] = useState(() => createAppInstance());

  return (
    <QueryClientProvider client={appInstance.queryClient}>
      <AuthProvider>
        <AppRouter {...appInstance} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
