import { Module } from "@nestjs/common";

import { AppConfigModule } from "./common/config/app-config.module";
import { DatabaseModule } from "./common/db/database.module";
import { MetricsModule } from "./common/metrics/metrics.module";
import { StorageModule } from "./common/storage/storage.module";
import { EmailIngestModule } from "./email-ingest/email-ingest.module";
import { EmailIngestWorker } from "./email-ingest/email-ingest.worker";
import { ExplorerModule } from "./explorer/explorer.module";
import { ExplorerWorker } from "./explorer/explorer.worker";
import { HealthModule } from "./health/health.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { NotificationsWorker } from "./notifications/notifications.worker";
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
    EmailIngestModule,
    NotificationsModule,
    // The worker has no HTTP surface, so its heartbeat is the only way an
    // external monitor learns that this container is alive.
    HealthModule.forProcess("worker"),
  ],
  providers: [ProcessingWorker, ExplorerWorker, NotificationsWorker, EmailIngestWorker],
})
export class WorkerModule {}
