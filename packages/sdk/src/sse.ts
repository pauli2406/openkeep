/**
 * Minimal SSE line parser shared by all client streams (web/mobile × answer/QA).
 * Previously each stream hand-rolled the same buffer handling — including the
 * "carry currentEvent across network chunks" fix — in four separate copies.
 */
export interface SseParser {
  /** Feed a decoded network chunk; fires onEvent for each complete data line. */
  push(chunk: string): void;
  /** Process whatever is left in the buffer (call once after the stream ends). */
  flush(): void;
}

export const createSseParser = (
  onEvent: (event: string, data: string) => void,
): SseParser => {
  let buffer = "";
  let currentEvent = "";

  const processLine = (line: string) => {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      onEvent(currentEvent, line.slice(6));
      currentEvent = "";
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
      }
    },
    flush() {
      if (buffer.trim().length > 0) {
        for (const line of buffer.split("\n")) {
          processLine(line);
        }
      }
      buffer = "";
    },
  };
};
