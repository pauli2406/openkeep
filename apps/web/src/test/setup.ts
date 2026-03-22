import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { syncTokensFromStorage } from "@/lib/api";
import { server } from "./msw-server";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });

  if (process.env.DEBUG_MSW_REQUESTS === "1") {
    server.events.on("request:start", ({ request }) => {
      console.log("[msw:start]", request.method, request.url);
    });
    server.events.on("request:match", ({ request }) => {
      console.log("[msw:match]", request.method, request.url);
    });
    server.events.on("request:unhandled", ({ request }) => {
      console.log("[msw:unhandled]", request.method, request.url);
    });
  }

  if (process.env.DEBUG_FETCH_REQUESTS === "1") {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method =
        init?.method ??
        (typeof input === "string" || input instanceof URL ? "GET" : input.method);
      console.log("[fetch]", method, url);
      return originalFetch(input, init);
    }) as typeof fetch;
  }

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(window, "scrollTo", {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window.HTMLElement.prototype, "hasPointerCapture", {
    writable: true,
    value: vi.fn(() => false),
  });

  Object.defineProperty(window.HTMLElement.prototype, "setPointerCapture", {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window.HTMLElement.prototype, "releasePointerCapture", {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window.URL, "createObjectURL", {
    writable: true,
    value: vi.fn(() => "blob:mock-object-url"),
  });

  Object.defineProperty(window.URL, "revokeObjectURL", {
    writable: true,
    value: vi.fn(),
  });

  Object.defineProperty(window, "ResizeObserver", {
    writable: true,
    value: ResizeObserverMock,
  });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  syncTokensFromStorage();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

afterAll(() => {
  server.close();
});
