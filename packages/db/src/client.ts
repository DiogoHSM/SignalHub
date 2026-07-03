import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema.js";

export type Db = Kysely<Database>;

export type CreateDbOptions = {
  onPoolError?: (error: Error) => void;
};

export function createDb(databaseUrl: string, options: CreateDbOptions = {}): Db {
  const pool = new Pool({ connectionString: databaseUrl });
  if (options.onPoolError) {
    pool.on("error", options.onPoolError);
  }

  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool
    })
  });
}
