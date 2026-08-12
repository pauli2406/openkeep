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
  let dataLines: string[] = [];

  const dispatch = () => {
    if (dataLines.length === 0) {
      currentEvent = "";
      return;
    }
    onEvent(currentEvent, dataLines.join("\n"));
    currentEvent = "";
    dataLines = [];
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0) {
      dispatch();
    } else if (line.startsWith(":")) {
      return;
    } else if (line === "event" || line.startsWith("event:")) {
      currentEvent = line.slice(6).replace(/^ /, "").trim();
    } else if (line === "data" || line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
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
      if (buffer.length > 0) {
        for (const line of buffer.split("\n")) {
          processLine(line);
        }
      }
      dispatch();
      buffer = "";
    },
  };
};
