import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiUrl } from "./api-url";
import { server } from "./msw-server";
import {
  api,
  authFetch,
  clearTokens,
  configureApiAuthMode,
  hasTokens,
  setApiFailureHandler,
  setTokens,
  syncTokensFromStorage,
} from "@/lib/api";

describe("API auth mode", () => {
  afterEach(() => {
    setApiFailureHandler(null);
    configureApiAuthMode("browser");
  });

  it("reports host-owned authentication and transport failures once observed", async () => {
    const onFailure = vi.fn();
    setApiFailureHandler(onFailure);
    configureApiAuthMode("main-owned");
    server.use(
      http.get(apiUrl("/api/protected"), () =>
        new HttpResponse(null, { status: 401 }),
      ),
      http.get(apiUrl("/api/health"), () =>
        new HttpResponse(null, {
          status: 502,
          headers: { "x-openkeep-desktop-error": "archive-unavailable" },
        }),
      ),
    );

    await authFetch("/api/protected");
    await api.GET("/api/health");

    expect(onFailure).toHaveBeenNthCalledWith(1, "unauthorized");
    expect(onFailure).toHaveBeenNthCalledWith(2, "unavailable");
  });

  it("does not treat an archive's own gateway response as a desktop transport failure", async () => {
    const onFailure = vi.fn();
    setApiFailureHandler(onFailure);
    configureApiAuthMode("main-owned");
    server.use(
      http.get(apiUrl("/api/health"), () =>
        new HttpResponse(null, { status: 502 }),
      ),
    );

    await api.GET("/api/health");

    expect(onFailure).not.toHaveBeenCalled();
  });

  it("keeps browser token storage and refresh behavior as the default", async () => {
    let requestAttempts = 0;
    let refreshAttempts = 0;
    server.use(
      http.get(apiUrl("/api/protected"), ({ request }) => {
        requestAttempts += 1;
        if (requestAttempts === 1) {
          expect(request.headers.get("authorization")).toBe(
            "Bearer expired-access-token",
          );
          return new HttpResponse(null, { status: 401 });
        }

        expect(request.headers.get("authorization")).toBe(
          "Bearer renewed-access-token",
        );
        return HttpResponse.json({ ok: true });
      }),
      http.post(apiUrl("/api/auth/refresh"), () => {
        refreshAttempts += 1;
        return HttpResponse.json({
          accessToken: "renewed-access-token",
          refreshToken: "renewed-refresh-token",
        });
      }),
    );
    localStorage.setItem("openkeep.access-token", "expired-access-token");
    localStorage.setItem("openkeep.refresh-token", "expired-refresh-token");
    syncTokensFromStorage();

    const response = await authFetch("/api/protected");

    expect(response.ok).toBe(true);
    expect(requestAttempts).toBe(2);
    expect(refreshAttempts).toBe(1);
    expect(localStorage.getItem("openkeep.access-token")).toBe(
      "renewed-access-token",
    );
    expect(localStorage.getItem("openkeep.refresh-token")).toBe(
      "renewed-refresh-token",
    );
  });

  it("leaves credentials and 401 handling to the host in main-owned mode", async () => {
    localStorage.setItem(
      "openkeep.access-token",
      "renderer-must-not-read-this",
    );
    localStorage.setItem(
      "openkeep.refresh-token",
      "renderer-must-not-read-this",
    );
    const getItem = vi.spyOn(localStorage, "getItem");
    const setItem = vi.spyOn(localStorage, "setItem");
    const removeItem = vi.spyOn(localStorage, "removeItem");
    let requestAttempts = 0;
    let refreshAttempts = 0;
    server.use(
      http.get(apiUrl("/api/protected"), ({ request }) => {
        requestAttempts += 1;
        expect(request.headers.has("authorization")).toBe(false);
        return new HttpResponse(null, { status: 401 });
      }),
      http.get(apiUrl("/api/health"), ({ request }) => {
        requestAttempts += 1;
        expect(request.headers.has("authorization")).toBe(false);
        return new HttpResponse(null, { status: 401 });
      }),
      http.post(apiUrl("/api/auth/refresh"), () => {
        refreshAttempts += 1;
        return HttpResponse.json({
          accessToken: "unexpected",
          refreshToken: "unexpected",
        });
      }),
    );

    configureApiAuthMode("main-owned");
    syncTokensFromStorage();
    setTokens("renderer-access", "renderer-refresh");
    clearTokens();
    expect(hasTokens()).toBe(false);
    const response = await authFetch("/api/protected");
    const { response: clientResponse } = await api.GET("/api/health");

    expect(response.status).toBe(401);
    expect(clientResponse.status).toBe(401);
    expect(requestAttempts).toBe(2);
    expect(refreshAttempts).toBe(0);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
