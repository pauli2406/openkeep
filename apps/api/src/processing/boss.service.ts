import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import PgBoss from "pg-boss";

import { AppConfigService } from "../common/config/app-config.service";
import { DatabaseService } from "../common/db/database.service";
import {
  CORRESPONDENT_SUMMARY_QUEUE,
  DOCUMENT_EMBEDDING_QUEUE,
  DOCUMENT_PROCESSING_QUEUE,
} from "./constants";

@Injectable()
export class BossService implements OnModuleInit, OnModuleDestroy {
  private readonly boss: PgBoss;
  private started = false;
  private readonly skipExternalInit: boolean;
  private readonly schema: string;
  private readonly retryLimit: number;
  private readonly retryDelaySeconds: number;

  constructor(
    @Inject(AppConfigService) private readonly configService: AppConfigService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {
    this.skipExternalInit = configService.get("SKIP_EXTERNAL_INIT");
    this.schema = configService.get("PG_BOSS_SCHEMA");
    this.retryLimit = configService.get("PROCESSING_RETRY_LIMIT");
    this.retryDelaySeconds = configService.get("PROCESSING_RETRY_DELAY_SECONDS");
    this.boss = new PgBoss({
      connectionString: configService.get("DATABASE_URL"),
      schema: this.schema,
    });
  }

  async onModuleInit(): Promise<void> {
    if (this.skipExternalInit) {
      return;
    }

    await this.boss.start();
    await this.boss.createQueue(DOCUMENT_PROCESSING_QUEUE);
    await this.boss.createQueue(DOCUMENT_EMBEDDING_QUEUE);
    await this.boss.createQueue(CORRESPONDENT_SUMMARY_QUEUE);
    this.started = true;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.started) {
      return;
    }

    await this.boss.stop();
  }

  async publish<T extends object>(queueName: string, payload: T): Promise<string | null> {
    const jobId = await this.boss.send(queueName, payload, {
      retryLimit: this.retryLimit,
      retryDelay: this.retryDelaySeconds,
      retryBackoff: true,
    });

    if (!jobId) {
      throw new Error(`Failed to publish job to queue: ${queueName}`);
    }

    return jobId;
  }

  async work<T extends object>(
    queueName: string,
    handler: (payload: T, bossJobId: string, retryCount: number) => Promise<void>,
  ): Promise<void> {
    await this.boss.work<T>(queueName, async (job) => {
      const item = Array.isArray(job) ? job[0] : job;
      if (!item) {
        return;
      }

      await handler(
        item.data,
        item.id,
        Number((item as { retrycount?: number }).retrycount ?? 0),
      );
    });
  }

  async ensureReady(): Promise<void> {
    if (this.skipExternalInit) {
      return;
    }

    const query = `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'job'`;
    const result = await this.databaseService.pool.query(query, [this.schema]);
    if (result.rowCount === 0) {
      throw new Error(`pg-boss schema ${this.schema} is not ready`);
    }
  }

  async getQueueDepth(queueName: string): Promise<number> {
    if (this.skipExternalInit) {
      return 0;
    }

    const schema = this.assertSafeSchema(this.schema);
    const query = `
      SELECT count(*)::int AS count
      FROM "${schema}".job
      WHERE name = $1
        AND state IN ('created', 'retry')
    `;
    const result = await this.databaseService.pool.query<{ count: string }>(query, [queueName]);
    return Number(result.rows[0]?.count ?? 0);
  }

  private assertSafeSchema(schema: string): string {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw new Error(`Unsafe pg-boss schema name: ${schema}`);
    }

    return schema;
  }
}
