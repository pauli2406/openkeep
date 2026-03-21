import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { WorkerModule } from "../../api/src/worker.module";

async function bootstrap() {
  await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
}

void bootstrap();
