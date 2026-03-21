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
    }),
  );

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
