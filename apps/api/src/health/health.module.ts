import { DynamicModule, Module } from "@nestjs/common";

import { ProcessingModule } from "../processing/processing.module";
import { ReadinessService } from "./readiness.service";

export type HealthProcess = "api" | "worker";

/**
 * Readiness probing. Both the API and the worker import it, each naming the
 * process so process-specific behaviour can hang off it.
 */
@Module({})
export class HealthModule {
  static forProcess(_process: HealthProcess): DynamicModule {
    return {
      module: HealthModule,
      imports: [ProcessingModule],
      providers: [ReadinessService],
      exports: [ReadinessService],
    };
  }
}
