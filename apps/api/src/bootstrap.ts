import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { loadConfig } from "@openkeep/config";
import { patchNestJsSwagger, ZodValidationPipe } from "nestjs-zod";

import { AppModule } from "./app.module";

export const createApp = async () => {
  const config = loadConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: {
        level: config.LOG_LEVEL,
      },
      // The API only ever receives traffic through the Traefik/Cloudflare
      // reverse proxy, so we trust X-Forwarded-* to derive the real client
      // IP. This is required for per-IP rate limiting to work correctly.
      trustProxy: true,
    }),
  );

  // Baseline security response headers. TLS is terminated by the reverse
  // proxy; these harden the browser side (clickjacking, MIME sniffing,
  // referrer leakage) and instruct browsers to stay on HTTPS.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", (_request, reply, payload, done) => {
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("X-Frame-Options", "DENY");
      reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
      reply.header("Content-Security-Policy", "frame-ancestors 'none'");
      reply.header(
        "Strict-Transport-Security",
        "max-age=63072000; includeSubDomains",
      );
      done(null, payload);
    });

  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_UPLOAD_BYTES,
    },
  });

  app.useGlobalPipes(new ZodValidationPipe());
  app.setGlobalPrefix("api");
  patchNestJsSwagger();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("OpenKeep API")
      .setDescription("Self-hosted AI document archive API")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build(),
  );

  return {
    app,
    document,
  };
};
