/**
 * fetch with an enforced timeout, composed with an optional caller signal.
 * Providers must never issue an unbounded outbound request: a hung upstream
 * otherwise blocks a worker slot (queue consumers) or an SSE response forever.
 */
export const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> => {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) {
    signals.push(signal);
  }

  return fetch(url, {
    ...init,
    signal: AbortSignal.any(signals),
  });
};

export const isAbortError = (error: unknown): boolean =>
  error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
