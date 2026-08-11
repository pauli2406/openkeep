import { createSseParser } from "@openkeep/sdk";

export type JsonSseEventHandler = (
  event: string,
  payload: Record<string, unknown>,
) => "stop" | void;

function responseErrorMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Archive authentication expired. Reconnect this archive.";
  }
  if (status === 502 || status === 503 || status === 504) {
    return "The archive or its AI provider is currently unavailable.";
  }
  return `The archive returned HTTP ${status}.`;
}

/**
 * Consume the canonical OpenKeep JSON-over-SSE contract without buffering the
 * response. Network chunks can split event fields, JSON, or UTF-8 code points;
 * the TextDecoder and shared SSE parser retain those partial values until the
 * following chunk arrives.
 */
export async function consumeJsonSseResponse(
  response: Response,
  onEvent: JsonSseEventHandler,
): Promise<void> {
  if (!response.ok) {
    throw new Error(responseErrorMessage(response.status));
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error("The archive returned an invalid answer stream.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("The archive returned an empty answer stream.");
  }

  let shouldStop = false;
  const decoder = new TextDecoder();
  const parser = createSseParser((event, data) => {
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error("The archive returned a malformed answer stream.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("The archive returned a malformed answer stream.");
    }
    shouldStop = onEvent(event, payload as Record<string, unknown>) === "stop";
  });

  try {
    while (!shouldStop) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }

    if (!shouldStop) {
      parser.push(decoder.decode());
      parser.flush();
    }
  } finally {
    if (shouldStop) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

export function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}
