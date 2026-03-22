import "reflect-metadata";

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFile } from "node:fs/promises";

import { loadConfig } from "@openkeep/config";
import { SwaggerModule } from "@nestjs/swagger";
import fastifyStatic from "@fastify/static";

import { createApp } from "./bootstrap";

async function bootstrap() {
  const config = loadConfig();
  const { app, document } = await createApp();
  SwaggerModule.setup("docs", app, document);

  // Serve the web app's static files in production.
  // In development, the Vite dev server handles this via proxy.
  const webDistPath = resolve(__dirname, "../../web/dist");
  if (existsSync(webDistPath)) {
    const fastifyInstance = app.getHttpAdapter().getInstance();

    // Serve static assets (JS, CSS, images, etc.)
    await fastifyInstance.register(fastifyStatic, {
      root: webDistPath,
      prefix: "/",
      decorateReply: false,
      wildcard: false,
    });

    // SPA fallback: serve index.html for any non-API, non-docs GET request
    // that doesn't match a static file. Uses a wildcard route instead of
    // setNotFoundHandler to avoid conflicting with NestJS's own handler.
    const indexHtml = await readFile(join(webDistPath, "index.html"));
    fastifyInstance.get("*", (request, reply) => {
      const url = request.url;
      if (url.startsWith("/api/") || url.startsWith("/docs")) {
        reply.callNotFound();
      } else {
        reply.type("text/html").send(indexHtml);
      }
    });
  }

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

void bootstrap();
