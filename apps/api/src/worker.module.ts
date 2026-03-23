import { Module } from "@nestjs/common";

import { AppConfigModule } from "./common/config/app-config.module";
import { DatabaseModule } from "./common/db/database.module";
import { MetricsModule } from "./common/metrics/metrics.module";
import { StorageModule } from "./common/storage/storage.module";
import { ExplorerModule } from "./explorer/explorer.module";
import { ExplorerWorker } from "./explorer/explorer.worker";
import { ProcessingModule } from "./processing/processing.module";
import { ProcessingWorker } from "./processing/processing.worker";

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    MetricsModule,
    StorageModule,
    ProcessingModule,
    ExplorerModule,
  ],
  providers: [ProcessingWorker, ExplorerWorker],
})
export class WorkerModule {}
