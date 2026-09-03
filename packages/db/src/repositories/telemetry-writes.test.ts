import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type TransactionSettings
} from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import type { Database } from "../schema.js";
import { insertSpan } from "./telemetry-writes.js";

class RecordingDriver implements Driver {
  readonly queries: CompiledQuery[] = [];

  readonly connection: DatabaseConnection = {
    executeQuery: async <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
      this.queries.push(query);
      if (query.sql.includes('from "environments"')) {
        return { rows: [{ id: "env_span_jsonb" } as R] };
      }
      if (query.sql.startsWith('insert into "spans"')) {
        return { rows: [{ id: "spn_jsonb" } as R] };
      }
      return { rows: [] };
    },
    streamQuery: async function* <R>(): AsyncIterableIterator<QueryResult<R>> {
      yield { rows: [] };
    }
  };

  async init(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> { return this.connection; }
  async beginTransaction(_connection: DatabaseConnection, _settings: TransactionSettings): Promise<void> {}
  async commitTransaction(_connection: DatabaseConnection): Promise<void> {}
  async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {}
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
  async destroy(): Promise<void> {}
}

function createRecordingDb(): { db: Kysely<Database>; driver: RecordingDriver } {
  const driver = new RecordingDriver();
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  });
  return { db, driver };
}

describe("insertSpan JSONB parameters", () => {
  const databases: Array<Kysely<Database>> = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((db) => db.destroy()));
  });

  it("serializes non-null JSON roots exactly once and casts their parameters to jsonb", async () => {
    const { db, driver } = createRecordingDb();
    databases.push(db);
    const timestamp = new Date("2026-09-03T12:00:00.000Z");
    const receivedAt = new Date("2026-09-03T12:00:01.000Z");

    await insertSpan(db, {
      id: "spn_jsonb",
      projectId: "prj_span_jsonb",
      environmentId: "env_span_jsonb",
      traceId: "trc_span_jsonb",
      timestamp,
      receivedAt,
      name: "json roots",
      status: "success",
      startedAt: timestamp,
      input: ["visible", { nested: true }],
      output: "visible",
      error: { kind: "failure" }
    });

    const query = driver.queries.find((candidate) => candidate.sql.startsWith('insert into "spans"'));
    expect(query).toBeDefined();
    expect(query!.sql).toContain('"input", "output", "error"');
    expect(query!.sql).toContain("$19::jsonb, $20::jsonb, $21::jsonb");
    expect(query!.parameters).toEqual([
      "spn_jsonb",
      "prj_span_jsonb",
      "env_span_jsonb",
      null,
      null,
      null,
      "trc_span_jsonb",
      timestamp,
      receivedAt,
      null,
      null,
      {},
      null,
      "json roots",
      "success",
      timestamp,
      null,
      null,
      '["visible",{"nested":true}]',
      '"visible"',
      '{"kind":"failure"}',
      null
    ]);
  });

  it("binds omitted and explicit-null optional payloads as SQL null", async () => {
    const { db, driver } = createRecordingDb();
    databases.push(db);
    const timestamp = new Date("2026-09-03T12:00:00.000Z");

    await insertSpan(db, {
      id: "spn_jsonb_null",
      projectId: "prj_span_jsonb",
      environmentId: "env_span_jsonb",
      traceId: "trc_span_jsonb",
      timestamp,
      receivedAt: timestamp,
      name: "null roots",
      status: "success",
      startedAt: timestamp,
      input: null,
      error: null
    });

    const query = driver.queries.find((candidate) => candidate.sql.startsWith('insert into "spans"'));
    expect(query).toBeDefined();
    expect(query!.parameters.slice(18, 21)).toEqual([null, null, null]);
    expect(query!.sql).not.toContain("$19::jsonb");
  });
});
