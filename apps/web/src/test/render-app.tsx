import { render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/history";
import userEvent from "@testing-library/user-event";
import { AppRouter, createAppInstance } from "@/app";
import {
  AuthContext,
  AuthProvider,
  type AuthState,
} from "@/hooks/use-auth";
import { syncTokensFromStorage } from "@/lib/api";
import type { QueryClient } from "@tanstack/react-query";

const ACCESS_TOKEN_STORAGE_KEY = "openkeep.access-token";
const REFRESH_TOKEN_STORAGE_KEY = "openkeep.refresh-token";

interface RenderAppOptions {
  route?: string;
  accessToken?: string;
  refreshToken?: string;
}

interface RenderAuthenticatedAppOptions extends RenderAppOptions {
  authState?: Partial<AuthState>;
}

function applyStoredTokens(accessToken: string | null, refreshToken: string | null) {
  if (accessToken === null) {
    localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
  } else {
    localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  }

  if (refreshToken === null) {
    localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
  } else {
    localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  }

  syncTokensFromStorage();
}

function configureTestQueryClient(queryClient: QueryClient) {
  const defaultOptions = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaultOptions,
    queries: {
      ...defaultOptions.queries,
      retry: false,
    },
    mutations: {
      ...defaultOptions.mutations,
      retry: false,
    },
  });
}

export function renderApp(options: RenderAppOptions = {}) {
  const { route = "/", accessToken = null, refreshToken = null } = options;

  applyStoredTokens(accessToken, refreshToken);

  const appInstance = createAppInstance();
  configureTestQueryClient(appInstance.queryClient);
  appInstance.router.update({
    ...appInstance.router.options,
    history: createMemoryHistory({ initialEntries: [route] }),
  });

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={appInstance.queryClient}>
        <AuthProvider>
          <AppRouter {...appInstance} />
        </AuthProvider>
      </QueryClientProvider>,
    ),
  };
}

export function renderAuthenticatedApp(
  options: RenderAuthenticatedAppOptions = {},
) {
  const {
    route = "/",
    accessToken = "access-token",
    refreshToken = "refresh-token",
    authState,
  } = options;

  applyStoredTokens(accessToken, refreshToken);

  const appInstance = createAppInstance();
  configureTestQueryClient(appInstance.queryClient);
  appInstance.router.update({
    ...appInstance.router.options,
    history: createMemoryHistory({ initialEntries: [route] }),
  });
  const authenticatedState: AuthState = {
    user: {
      id: "11111111-1111-1111-1111-111111111111",
      email: "owner@example.com",
      displayName: "Owner",
      isOwner: true,
    },
    isAuthenticated: true,
    isLoading: false,
    needsSetup: false,
    login: async () => {},
    setup: async () => {},
    logout: () => {},
    ...authState,
  };

  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={appInstance.queryClient}>
        <AuthContext.Provider value={authenticatedState}>
          <AppRouter {...appInstance} />
        </AuthContext.Provider>
      </QueryClientProvider>,
    ),
  };
}
