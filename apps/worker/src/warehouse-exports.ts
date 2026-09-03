import { lookup as dnsLookup } from "node:dns";
import { Socket, type LookupFunction } from "node:net";
import { Client, type ClientConfig } from "pg";
import type {
  WarehouseDestinationRecord,
  WarehouseExportBatch,
  WarehouseExportCounts,
  WarehouseCursor,
  WarehouseExportRunTrigger
} from "@sigmon/db/repositories/warehouse-exports.js";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";
import {
  createSafeLookup,
  OutboundPolicy,
  parseWarehousePostgresUrl
} from "@sigmon/config";

export type WarehousePostgresTimeouts = {
  connectionTimeoutMs: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  queryTimeoutMs: number;
  totalTimeoutMs: number;
};

export type WarehouseExportRuntime = {
  now: () => Date;
  withLock: <T>(run: () => Promise<T>) => Promise<{ locked: false } | { locked: true; result: T }>;
  listActiveDestinations: () => Promise<WarehouseDestinationRecord[]>;
  selectBatch: (destination: WarehouseDestinationRecord, input: { now: Date }) => Promise<WarehouseExportBatch>;
  writeBatch: (input: WarehousePostgresWriteInput) => Promise<void>;
  postgresOptions?: Pick<WarehousePostgresWriteInput, "outboundPolicy" | "timeouts">;
  updateCursor: (input: {
    id: string;
    projectId: string;
    environmentId: string;
    cursor: WarehouseCursor;
    now: Date;
    status: "success" | "failed";
    errorMessage?: string | null;
  }) => Promise<unknown>;
  recordRun: (input: {
    destinationId: string;
    projectId: string;
    environmentId: string;
    trigger: WarehouseExportRunTrigger;
    status: "success" | "failed";
    startedAt: Date;
    finishedAt: Date;
    cursorBefore: WarehouseCursor;
    cursorAfter: WarehouseCursor;
    exported: WarehouseExportCounts;
    errorMessage?: string | null;
  }) => Promise<unknown>;
};

export type WarehousePostgresWriteInput = {
  destinationId: string;
  connectionUrl: string;
  batch: WarehouseExportBatch;
  outboundPolicy?: OutboundPolicy;
  timeouts?: WarehousePostgresTimeouts;
  lookup?: LookupFunction;
};

export type WarehouseExportResult = {
  ran: boolean;
  skipped: boolean;
  destinations: number;
  exported: number;
  failed: number;
};

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

const warehouseCredentialPattern = /\b((?:(?:access|refresh)[_-]?)?token|api[_-]?key|password|secret|(?:access|private|secret)[_-]?key(?:[_-]?id)?|ssl[_-]?(?:key|cert(?:ificate)?))\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;'"})\]]+)/gi;
const defaultWarehousePostgresTimeouts: WarehousePostgresTimeouts = {
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 30_000,
  lockTimeoutMs: 5_000,
  queryTimeoutMs: 35_000,
  totalTimeoutMs: 60_000
};

function isSensitiveWarehouseUrlParameter(key: string): boolean {
  const normalized = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return normalized.endsWith("token") ||
    normalized.includes("apikey") ||
    normalized.endsWith("password") ||
    normalized.endsWith("secret") ||
    normalized.includes("accesskey") ||
    normalized.includes("privatekey") ||
    (normalized.startsWith("ssl") && (normalized.includes("key") || normalized.includes("cert")));
}

function redactConfiguredCredentialValues(message: string, values: Iterable<string>): string {
  const variants = new Set<string>();
  for (const value of values) {
    if (!value || value === "[REDACTED]") continue;
    variants.add(value);
    variants.add(encodeURIComponent(value));
    try {
      variants.add(decodeURIComponent(value));
    } catch {
      // The configured value is already decoded or contains a literal percent sign.
    }
  }

  return [...variants]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .reduce((sanitized, value) => sanitized.replaceAll(value, "[REDACTED]"), message);
}

function sanitizeWarehouseError(error: unknown, destination: WarehouseDestinationRecord): string {
  let message = error instanceof Error ? error.message : String(error);
  if (destination.connectionUrl) {
    message = message.replaceAll(destination.connectionUrl, destination.connectionUrlPreview);
    try {
      const parsed = new URL(destination.connectionUrl);
      const credentialValues = [parsed.password];
      for (const [key, value] of parsed.searchParams) {
        if (isSensitiveWarehouseUrlParameter(key)) credentialValues.push(value);
      }
      message = redactConfiguredCredentialValues(message, credentialValues);
    } catch {
      // Best effort only.
    }
  }
  message = message.replace(warehouseCredentialPattern, "$1=[REDACTED]");
  return sanitizePreviewText(message) ?? "Warehouse export failed";
}

function rowCount(batch: WarehouseExportBatch): number {
  return Object.values(batch.counts).reduce((sum, count) => sum + (count ?? 0), 0);
}

export async function runWarehouseExportOnce(
  runtime: WarehouseExportRuntime,
  trigger: WarehouseExportRunTrigger = "scheduled"
): Promise<WarehouseExportResult> {
  const lockResult = await runtime.withLock(async () => {
    const destinations = await runtime.listActiveDestinations();
    let exported = 0;
    let failed = 0;

    for (const destination of destinations) {
      const startedAt = runtime.now();
      let batch: WarehouseExportBatch | null = null;

      try {
        batch = await runtime.selectBatch(destination, { now: startedAt });
        if (batch.rowCount > 0) {
          if (!destination.connectionUrl) throw new Error("warehouse_destination_missing_connection_url");
          await runtime.writeBatch({
            destinationId: destination.id,
            connectionUrl: destination.connectionUrl,
            batch,
            ...runtime.postgresOptions
          });
        }

        const finishedAt = runtime.now();
        await runtime.updateCursor({
          id: destination.id,
          projectId: destination.projectId,
          environmentId: destination.environmentId,
          cursor: batch.nextCursor,
          now: finishedAt,
          status: "success"
        });
        exported += rowCount(batch);
        try {
          await runtime.recordRun({
            destinationId: destination.id,
            projectId: destination.projectId,
            environmentId: destination.environmentId,
            trigger,
            status: "success",
            startedAt,
            finishedAt,
            cursorBefore: batch.cursorBefore,
            cursorAfter: batch.nextCursor,
            exported: batch.counts
          });
        } catch (error) {
          console.error("Could not record successful warehouse export run");
        }
      } catch (error) {
        failed += 1;
        const finishedAt = runtime.now();
        const errorMessage = sanitizeWarehouseError(error, destination);
        try {
          await runtime.updateCursor({
            id: destination.id,
            projectId: destination.projectId,
            environmentId: destination.environmentId,
            cursor: destination.cursor,
            now: finishedAt,
            status: "failed",
            errorMessage
          });
        } catch {
          console.error("Could not record failed warehouse export cursor state");
        }
        try {
          await runtime.recordRun({
            destinationId: destination.id,
            projectId: destination.projectId,
            environmentId: destination.environmentId,
            trigger,
            status: "failed",
            startedAt,
            finishedAt,
            cursorBefore: batch?.cursorBefore ?? destination.cursor,
            cursorAfter: destination.cursor,
            exported: batch?.counts ?? {},
            errorMessage
          });
        } catch {
          console.error("Could not record failed warehouse export run");
        }
      }
    }

    return { destinations: destinations.length, exported, failed };
  });

  if (!lockResult.locked) {
    return { ran: false, skipped: true, destinations: 0, exported: 0, failed: 0 };
  }

  return { ran: true, skipped: false, ...lockResult.result };
}

function serializeRow(row: unknown): string {
  return JSON.stringify(row);
}

async function ensureWarehouseLandingTable(client: Client): Promise<void> {
  await client.query(`
    create table if not exists sigmon_telemetry_export (
      dataset text not null,
      source_id text not null,
      project_id text not null,
      environment_id text not null,
      occurred_at timestamptz not null,
      received_at timestamptz,
      payload jsonb not null,
      exported_at timestamptz not null default now(),
      primary key (dataset, source_id)
    )
  `);
}

async function writeDataset(
  client: Client,
  dataset: string,
  rows: Array<{
    id: string;
    project_id: string;
    environment_id: string;
    timestamp: Date;
    received_at?: Date | null;
  }>
): Promise<void> {
  if (rows.length === 0) return;

  const values: unknown[] = [];
  const tuples = rows.map((row, index) => {
    const offset = index * 7;
    values.push(dataset, row.id, row.project_id, row.environment_id, row.timestamp, row.received_at ?? null, serializeRow(row));
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}::jsonb, now())`;
  });

  await client.query(
    `
      insert into sigmon_telemetry_export (
        dataset,
        source_id,
        project_id,
        environment_id,
        occurred_at,
        received_at,
        payload,
        exported_at
      )
      values ${tuples.join(", ")}
      on conflict (dataset, source_id) do update set
        project_id = excluded.project_id,
        environment_id = excluded.environment_id,
        occurred_at = excluded.occurred_at,
        received_at = excluded.received_at,
        payload = excluded.payload,
        exported_at = now()
    `,
    values
  );
}

export async function writePostgresWarehouseBatch(input: WarehousePostgresWriteInput): Promise<void> {
  const timeouts = input.timeouts ?? defaultWarehousePostgresTimeouts;
  const bundle = createWarehousePostgresClientConfig({
    connectionUrl: input.connectionUrl,
    outboundPolicy: input.outboundPolicy ?? new OutboundPolicy(),
    timeouts,
    lookup: input.lookup
  });

  let client: Client;
  try {
    client = new Client(bundle.config);
  } catch {
    bundle.socket.destroy();
    throw new Error("warehouse_connection_failed");
  }
  client.on?.("error", () => {
    // The operation promise reports the stable connection/write category. This listener
    // prevents a late socket event after hard deadline teardown from becoming unhandled.
  });

  let stage: "connect" | "write" = "connect";
  let connected = false;
  let transactionOpen = false;
  let timedOut = false;
  let closePromise: Promise<void> | undefined;
  const closeClient = (): Promise<void> => {
    if (!closePromise) {
      try {
        closePromise = Promise.resolve(client.end()).then(() => undefined, () => undefined);
      } catch {
        closePromise = Promise.resolve();
      }
    }
    return closePromise;
  };

  let deadlineHandle: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineHandle = setTimeout(() => {
      timedOut = true;
      bundle.socket.destroy();
      void closeClient();
      reject(new Error("warehouse_destination_timeout"));
    }, timeouts.totalTimeoutMs);
    deadlineHandle.unref?.();
  });

  const operation = (async () => {
    try {
      await client.connect();
      connected = true;
      stage = "write";
      await ensureWarehouseLandingTable(client);
      await client.query("begin");
      transactionOpen = true;
      await writeDataset(client, "events", input.batch.rows.events);
      await writeDataset(client, "errors", input.batch.rows.errors);
      await writeDataset(client, "traces", input.batch.rows.traces);
      await writeDataset(client, "llm_calls", input.batch.rows.llmCalls);
      await writeDataset(client, "user_profiles", input.batch.rows.userProfiles);
      await writeDataset(client, "tenant_profiles", input.batch.rows.tenantProfiles);
      await client.query("commit");
      transactionOpen = false;
    } catch (error) {
      if (connected && transactionOpen && !timedOut && !bundle.socket.destroyed) {
        try {
          await client.query("rollback");
          transactionOpen = false;
        } catch {
          // Rollback is best effort; the original stable failure category wins.
        }
      }
      throw error;
    } finally {
      await closeClient();
    }
  })();
  void operation.catch(() => undefined);

  try {
    await Promise.race([operation, deadline]);
  } catch (error) {
    if (timedOut || (error instanceof Error && error.message === "warehouse_destination_timeout")) {
      throw new Error("warehouse_destination_timeout");
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "outbound_address_forbidden") {
      throw new Error("warehouse_destination_forbidden");
    }
    throw new Error(stage === "connect" ? "warehouse_connection_failed" : "warehouse_write_failed");
  } finally {
    if (deadlineHandle) clearTimeout(deadlineHandle);
  }
}

export type BuildWarehousePostgresClientConfigInput = {
  connectionUrl: string;
  outboundPolicy: OutboundPolicy;
  timeouts: WarehousePostgresTimeouts;
  lookup?: LookupFunction;
};

export function buildWarehousePostgresClientConfig(input: BuildWarehousePostgresClientConfigInput): ClientConfig {
  return createWarehousePostgresClientConfig(input).config;
}

function createWarehousePostgresClientConfig(input: BuildWarehousePostgresClientConfigInput): {
  config: ClientConfig;
  socket: Socket;
} {
  const target = parseWarehousePostgresUrl(input.connectionUrl, input.outboundPolicy);
  const socket = createWarehousePostgresSocket(
    input.outboundPolicy,
    input.lookup ?? dnsLookup
  );
  const config: ClientConfig & { replication: string } = {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    ssl: target.ssl,
    stream: () => socket,
    connectionTimeoutMillis: input.timeouts.connectionTimeoutMs,
    statement_timeout: input.timeouts.statementTimeoutMs,
    lock_timeout: input.timeouts.lockTimeoutMs,
    query_timeout: input.timeouts.queryTimeoutMs,
    idle_in_transaction_session_timeout: input.timeouts.totalTimeoutMs,
    application_name: target.applicationName ?? "sigmon-warehouse-export",
    client_encoding: "UTF8",
    options: `-c statement_timeout=${input.timeouts.statementTimeoutMs} -c lock_timeout=${input.timeouts.lockTimeoutMs} -c idle_in_transaction_session_timeout=${input.timeouts.totalTimeoutMs}`,
    replication: "false"
  };
  Object.defineProperty(config, "password", {
    value: async () => target.password,
    enumerable: false,
    configurable: false,
    writable: false
  });
  return { config, socket };
}

function createWarehousePostgresSocket(policy: OutboundPolicy, lookup: LookupFunction): Socket {
  const socket = new Socket();
  const connect = socket.connect.bind(socket);
  const safeLookup = createSafeLookup(policy, lookup);

  // node-postgres 8.20 invokes a supplied stream with the positional
  // connect(port, host) overload. Adapt that exact supported path so the lookup
  // used by the actual TCP socket enforces the shared outbound policy.
  socket.connect = ((port: number, host: string, listener?: () => void) => {
    if (!Number.isInteger(port) || typeof host !== "string" || host.length === 0) {
      throw new Error("warehouse_connection_failed");
    }
    return connect({ port, host, lookup: safeLookup, autoSelectFamily: false }, listener);
  }) as Socket["connect"];

  return socket;
}

export function startWarehouseExportScheduler(input: {
  intervalMinutes: number;
  runOnce: () => Promise<unknown>;
  setIntervalFn?: (callback: () => void, delay: number) => IntervalHandle;
  setTimeoutFn?: (callback: () => void, delay: number) => TimeoutHandle;
  clearIntervalFn?: (handle: IntervalHandle) => void;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
}): () => Promise<void> {
  const setIntervalFn = input.setIntervalFn ?? setInterval;
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout;
  const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout;
  let stopped = false;
  let activeRun: Promise<void> | null = null;

  const tick = () => {
    if (stopped || activeRun) return;
    activeRun = (async () => {
      try {
        await input.runOnce();
      } catch (error) {
        console.error("Warehouse export scheduler run failed", error);
      } finally {
        activeRun = null;
      }
    })();
  };

  const startupTimer = setTimeoutFn(tick, 1000);
  const interval = setIntervalFn(tick, input.intervalMinutes * 60 * 1000);

  return async () => {
    stopped = true;
    clearTimeoutFn(startupTimer);
    clearIntervalFn(interval);
    await activeRun;
  };
}
