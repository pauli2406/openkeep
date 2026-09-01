import { DynamicModule, Module } from "@nestjs/common";

import { ProcessingModule } from "../processing/processing.module";
import {
  HEARTBEAT_PROCESS,
  HEARTBEAT_TRANSPORT,
  HeartbeatProcess,
  HeartbeatService,
  defaultHeartbeatTransport,
} from "./heartbeat.service";
import { ReadinessService } from "./readiness.service";

/**
 * Readiness probing plus the outbound heartbeat. Both the API and the worker
 * import it, each naming the process so the heartbeat picks its own URL.
 */
@Module({})
export class HealthModule {
  static forProcess(process: HeartbeatProcess): DynamicModule {
    return {
      module: HealthModule,
      imports: [ProcessingModule],
      providers: [
        ReadinessService,
        HeartbeatService,
        { provide: HEARTBEAT_PROCESS, useValue: process },
        { provide: HEARTBEAT_TRANSPORT, useValue: defaultHeartbeatTransport },
      ],
      exports: [ReadinessService],
    };
  }
}
