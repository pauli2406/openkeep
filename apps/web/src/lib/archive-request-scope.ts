import { useCallback, useEffect, useRef } from "react";

/**
 * Owns renderer requests for the lifetime of the currently mounted archive
 * route. Desktop profile changes remount the shared app, so every mutation
 * using this signal is cancelled before another archive can become active.
 *
 * A getter keeps the hook safe under React Strict Mode: the development-only
 * effect cleanup may abort the first controller, and the next setup replaces
 * it before a user can start a mutation.
 */
export function useArchiveRequestScope(): () => AbortSignal {
  const controllerRef = useRef(new AbortController());

  useEffect(() => {
    if (controllerRef.current.signal.aborted) {
      controllerRef.current = new AbortController();
    }
    return () => controllerRef.current.abort();
  }, []);

  return useCallback(() => {
    if (controllerRef.current.signal.aborted) {
      controllerRef.current = new AbortController();
    }
    return controllerRef.current.signal;
  }, []);
}

/**
 * Combines lifecycle signals only when the active Fetch implementation accepts
 * their realm. Embedders and test runners can expose DOM and Fetch globals from
 * different realms; Electron and browsers use the combined signal normally.
 */
export function asFetchSignal(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const available = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (available.length === 0) return undefined;
  const signal =
    available.length === 1 ? available[0] : AbortSignal.any(available);
  try {
    new Request("https://openkeep.invalid", { signal });
    return signal;
  } catch {
    return undefined;
  }
}
