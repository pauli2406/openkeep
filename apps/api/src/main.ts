import "reflect-metadata";

import { loadConfig } from "@openkeep/config";
import { SwaggerModule } from "@nestjs/swagger";

import { createApp } from "./bootstrap";

async function bootstrap() {
  const config = loadConfig();
  const { app, document } = await createApp();
  SwaggerModule.setup("docs", app, document);
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

void bootstrap();
