import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { createDatabase, type OpenKeepDatabase } from "@openkeep/db";
import type { Pool } from "pg";

import { AppConfigService } from "../config/app-config.service";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: OpenKeepDatabase;
  readonly pool: Pool;

  constructor(@Inject(AppConfigService) configService: AppConfigService) {
    const instance = createDatabase(configService.get("DATABASE_URL"));
    this.db = instance.db;
    this.pool = instance.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
