import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";

configure({ asyncUtilTimeout: 5_000 });

// Node 25 exposes an incomplete localStorage global ahead of jsdom's Storage.
// The shared web shell uses it for theme and omnibar recents, so desktop
// renderer tests install the same deterministic shim as the web smoke suite.
const localStorageValues = new Map<string, string>();
const localStorageShim: Storage = {
  getItem: (key) => localStorageValues.get(key) ?? null,
  setItem: (key, value) => localStorageValues.set(key, String(value)),
  removeItem: (key) => localStorageValues.delete(key),
  clear: () => localStorageValues.clear(),
  key: (index) => [...localStorageValues.keys()][index] ?? null,
  get length() {
    return localStorageValues.size;
  },
};
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: localStorageShim,
});
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageShim,
});

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(min-width: 1024px)",
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
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: ResizeObserverMock,
  });

  for (const [property, size] of [
    ["offsetWidth", 1280],
    ["offsetHeight", 800],
    ["clientWidth", 1280],
    ["clientHeight", 800],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, property, {
      configurable: true,
      get: () => size,
    });
  }
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});
