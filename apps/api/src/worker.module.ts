import { Module } from "@nestjs/common";

import { AppConfigModule } from "./common/config/app-config.module";
import { DatabaseModule } from "./common/db/database.module";
import { StorageModule } from "./common/storage/storage.module";
import { ProcessingModule } from "./processing/processing.module";
import { ProcessingWorker } from "./processing/processing.worker";

@Module({
  imports: [AppConfigModule, DatabaseModule, StorageModule, ProcessingModule],
  providers: [ProcessingWorker],
})
export class WorkerModule {}
