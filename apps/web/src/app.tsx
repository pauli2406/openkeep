import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AuthProvider as BrowserAuthProvider, useAuth } from "./hooks/use-auth";
import {
  ShellAccessoryProvider,
  type HostFileSaver,
  type HostPlatform,
  type HostSessionMode,
  type ShellAccessory,
} from "./lib/host-shell";
import { I18nProvider } from "./lib/i18n";
import {
  HostImportsProvider,
  type HostImportAdapter,
} from "./lib/host-imports";

export type {
  HostImportAdapter,
  HostImportDelivery,
  HostImportFile,
  HostImportRejection,
} from "./lib/host-imports";

export type {
  HostSaveRequest,
  HostSaveResult,
  HostSessionMode,
} from "./lib/host-shell";

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

export interface AppProps {
  AuthProvider?: ComponentType<{ children: ReactNode }>;
  ShellAccessory?: ShellAccessory;
  hostImports?: HostImportAdapter;
  platform?: HostPlatform;
  fileSaver?: HostFileSaver;
  sessionMode?: HostSessionMode;
}

export function App({
  AuthProvider = BrowserAuthProvider,
  ShellAccessory,
  hostImports,
  platform,
  fileSaver,
  sessionMode,
}: AppProps = {}) {
  const [appInstance] = useState(() => createAppInstance());

  return (
    <QueryClientProvider client={appInstance.queryClient}>
      <AuthProvider>
        <HostImportsProvider adapter={hostImports}>
          <ShellAccessoryProvider
            accessory={ShellAccessory}
            platform={platform}
            fileSaver={fileSaver}
            sessionMode={sessionMode}
          >
            <AppRouter {...appInstance} />
          </ShellAccessoryProvider>
        </HostImportsProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
