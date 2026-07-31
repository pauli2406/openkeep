import type { FastifyReply } from "fastify";

import { isAbortError } from "../processing/http.util";

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Runs an SSE response with the plumbing every streaming endpoint needs:
 * - client disconnect aborts the provided signal so upstream LLM calls stop
 *   (previously an abandoned tab kept paying for tokens until the stream ended)
 * - comment-frame heartbeats keep idle proxies from dropping the connection
 *   during a slow first token
 * - abort errors are not reported as stream errors
 */
export const streamSseResponse = async (
  reply: FastifyReply,
  produce: (signal: AbortSignal) => AsyncGenerator<string>,
): Promise<void> => {
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const controller = new AbortController();
  const onClose = () => controller.abort();
  reply.raw.on("close", onClose);

  const heartbeat = setInterval(() => {
    if (!reply.raw.writableEnded && !controller.signal.aborted) {
      reply.raw.write(": ping\n\n");
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  try {
    for await (const chunk of produce(controller.signal)) {
      if (controller.signal.aborted) {
        break;
      }
      reply.raw.write(chunk);
    }
  } catch (error) {
    if (!controller.signal.aborted && !isAbortError(error)) {
      const message = error instanceof Error ? error.message : "Internal error";
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    }
  } finally {
    clearInterval(heartbeat);
    reply.raw.off("close", onClose);
    reply.raw.end();
  }
};
