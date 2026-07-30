import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema.js";

export type Db = Kysely<Database>;

export type CreateDbOptions = {
  onPoolError?: (error: Error) => void;
  /**
   * Postgres `statement_timeout` (ms) applied to every connection this pool opens. Undefined or 0
   * disables it. PER-449: callers that share this pool with migrations or long-lived worker jobs
   * (rollups, retention, backups) must pass 0/omit here and enforce a timeout only on the pool
   * that serves read routes - `statement_timeout` is a per-connection setting with no per-query
   * override available through this pool.
   */
  statementTimeoutMs?: number;
};

export function createDb(databaseUrl: string, options: CreateDbOptions = {}): Db {
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(options.statementTimeoutMs ? { statement_timeout: options.statementTimeoutMs } : {})
  });
  if (options.onPoolError) {
    pool.on("error", options.onPoolError);
  }

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool
    })
  });
}
