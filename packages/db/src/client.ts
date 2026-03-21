import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type OpenKeepDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseInstance {
  pool: Pool;
  db: OpenKeepDatabase;
}

export const createDatabase = (connectionString: string): DatabaseInstance => {
  const pool = new Pool({ connectionString });

  return {
    pool,
    db: drizzle(pool, { schema }),
  };
};

