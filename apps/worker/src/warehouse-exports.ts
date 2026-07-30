import { Client } from "pg";
import type {
  WarehouseDestinationRecord,
  WarehouseExportBatch,
  WarehouseExportCounts,
  WarehouseCursor,
  WarehouseExportRunTrigger
} from "@sigmon/db/repositories/warehouse-exports.js";
import { sanitizePreviewText } from "@sigmon/telemetry/sanitization";

export type WarehouseExportRuntime = {
  now: () => Date;
  withLock: <T>(run: () => Promise<T>) => Promise<{ locked: false } | { locked: true; result: T }>;
  listActiveDestinations: () => Promise<WarehouseDestinationRecord[]>;
  selectBatch: (destination: WarehouseDestinationRecord, input: { now: Date }) => Promise<WarehouseExportBatch>;
  writeBatch: (input: WarehousePostgresWriteInput) => Promise<void>;
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
            batch
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
          console.error("Could not record successful warehouse export run", error);
        }
      } catch (error) {
        failed += 1;
        const finishedAt = runtime.now();
        const errorMessage = sanitizeWarehouseError(error, destination);
        await runtime.updateCursor({
          id: destination.id,
          projectId: destination.projectId,
          environmentId: destination.environmentId,
          cursor: destination.cursor,
          now: finishedAt,
          status: "failed",
          errorMessage
        });
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
  const client = new Client({ connectionString: input.connectionUrl });
  await client.connect();
  try {
    await ensureWarehouseLandingTable(client);
    await client.query("begin");
    await writeDataset(client, "events", input.batch.rows.events);
    await writeDataset(client, "errors", input.batch.rows.errors);
    await writeDataset(client, "traces", input.batch.rows.traces);
    await writeDataset(client, "llm_calls", input.batch.rows.llmCalls);
    await writeDataset(client, "user_profiles", input.batch.rows.userProfiles);
    await writeDataset(client, "tenant_profiles", input.batch.rows.tenantProfiles);
    await client.query("commit");
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // Ignore rollback failures and report the original error.
    }
    throw error;
  } finally {
    await client.end();
  }
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
