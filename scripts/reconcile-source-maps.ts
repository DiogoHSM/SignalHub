import { pathToFileURL } from "node:url";
import { loadConfig } from "../packages/config/src/index.js";
import { createDb, type Db } from "../packages/db/src/client.js";
import {
  findActiveSourceMapMetadataByStoragePaths,
  listActiveSourceMapMetadataPage,
  softDeleteSourceMapMetadataForReconciliation,
  withSourceMapStorageLock
} from "../packages/db/src/repositories/source-maps.js";
import {
  openSourceMapStorageSession,
  type SourceMapArtifactDeleteResult,
  type SourceMapArtifactFile,
  type SourceMapArtifactInspection,
  type SourceMapStorageSession
} from "../apps/api/src/source-maps/storage-root.js";

const RECONCILIATION_BATCH_SIZE = 100;
const ORPHAN_GRACE_MS = 60 * 60 * 1000;
const MAX_REPORTED_METADATA_IDS = 100;

export type ReconciliationMetadata = { id: string; storagePath: string };

export type ReconciliationDatabase = {
  listMetadataPage: (input: { afterId: string | null; batchSize: number }) => Promise<ReconciliationMetadata[]>;
  findActiveMetadataByStoragePaths: (storagePaths: string[]) => Promise<ReconciliationMetadata[]>;
  softDeleteMetadata: (candidate: ReconciliationMetadata) => Promise<boolean>;
};

export type ReconciliationStorage = {
  assertAuthority: () => Promise<void>;
  inspectArtifact: (storagePath: string) => Promise<SourceMapArtifactInspection>;
  listArtifactFilesPage: (input: {
    afterStoragePath: string | null;
    batchSize: number;
  }) => Promise<SourceMapArtifactFile[]>;
  deleteArtifactIfOlderThan: (storagePath: string, cutoff: Date) => Promise<SourceMapArtifactDeleteResult>;
};

type StorageLock = <T>(
  run: (lockedDatabase: ReconciliationDatabase) => Promise<T>
) => Promise<{ locked: false } | { locked: true; result: T }>;

export type SourceMapReconciliationResult = {
  apply: boolean;
  metadataScanned: number;
  filesScanned: number;
  metadataWithoutFile: number;
  filesWithoutMetadata: number;
  metadataDeleted: number;
  filesDeleted: number;
  metadataIds: {
    withoutFile: string[];
    deleted: string[];
    truncated: boolean;
  };
};

export function parseReconcileSourceMapsArgs(args: string[]): { apply: boolean } {
  if (args.length === 0) return { apply: false };
  if (args.length === 1 && args[0] === "--apply") return { apply: true };
  throw new Error("source_map_reconciliation_argument_invalid");
}

function appendReportedId(ids: string[], id: string): boolean {
  if (ids.length >= MAX_REPORTED_METADATA_IDS) return false;
  ids.push(id);
  return true;
}

function assertMetadataPage(
  rows: ReconciliationMetadata[],
  afterId: string | null
): void {
  if (rows.length > RECONCILIATION_BATCH_SIZE) throw new Error("source_map_reconciliation_batch_size_invalid");
  let previous = afterId;
  for (const row of rows) {
    if (!row.id || !row.storagePath || (previous !== null && row.id <= previous)) {
      throw new Error("source_map_reconciliation_metadata_order_invalid");
    }
    previous = row.id;
  }
}

function assertFilePage(rows: SourceMapArtifactFile[], afterStoragePath: string | null): void {
  if (rows.length > RECONCILIATION_BATCH_SIZE) throw new Error("source_map_reconciliation_batch_size_invalid");
  let previous = afterStoragePath;
  for (const row of rows) {
    if (!row.storagePath || Number.isNaN(row.modifiedAt.getTime()) || (previous !== null && row.storagePath <= previous)) {
      throw new Error("source_map_reconciliation_file_order_invalid");
    }
    previous = row.storagePath;
  }
}

async function scanMetadata(input: {
  database: ReconciliationDatabase;
  storage: ReconciliationStorage;
  mutate: boolean;
  reportMissingIds?: string[];
  reportDeletedIds?: string[];
}): Promise<{ scanned: number; missing: number; deleted: number; idsTruncated: boolean }> {
  let afterId: string | null = null;
  let scanned = 0;
  let missing = 0;
  let deleted = 0;
  let idsTruncated = false;

  while (true) {
    const rows = await input.database.listMetadataPage({
      afterId,
      batchSize: RECONCILIATION_BATCH_SIZE
    });
    assertMetadataPage(rows, afterId);
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const inspected = await input.storage.inspectArtifact(row.storagePath);
      if (!inspected.exists) {
        missing += 1;
        if (input.reportMissingIds && !appendReportedId(input.reportMissingIds, row.id)) idsTruncated = true;
        if (input.mutate && await input.database.softDeleteMetadata(row)) {
          deleted += 1;
          if (input.reportDeletedIds && !appendReportedId(input.reportDeletedIds, row.id)) idsTruncated = true;
        }
      }
      afterId = row.id;
    }
    if (rows.length < RECONCILIATION_BATCH_SIZE) break;
  }
  return { scanned, missing, deleted, idsTruncated };
}

async function scanFiles(input: {
  database: ReconciliationDatabase;
  storage: ReconciliationStorage;
  mutate: boolean;
  cutoff: Date;
}): Promise<{ scanned: number; orphaned: number; deleted: number }> {
  let afterStoragePath: string | null = null;
  let scanned = 0;
  let orphaned = 0;
  let deleted = 0;

  while (true) {
    const rows = await input.storage.listArtifactFilesPage({
      afterStoragePath,
      batchSize: RECONCILIATION_BATCH_SIZE
    });
    assertFilePage(rows, afterStoragePath);
    if (rows.length === 0) break;

    const storagePaths = rows.map((row) => row.storagePath);
    const active = await input.database.findActiveMetadataByStoragePaths(storagePaths);
    const requested = new Set(storagePaths);
    const activePaths = new Set<string>();
    for (const row of active) {
      if (!requested.has(row.storagePath)) throw new Error("source_map_reconciliation_membership_invalid");
      activePaths.add(row.storagePath);
    }

    for (const row of rows) {
      scanned += 1;
      if (!activePaths.has(row.storagePath)) {
        orphaned += 1;
        if (input.mutate) {
          const result = await input.storage.deleteArtifactIfOlderThan(row.storagePath, input.cutoff);
          if (result === "deleted") deleted += 1;
        }
      }
      afterStoragePath = row.storagePath;
    }
    if (rows.length < RECONCILIATION_BATCH_SIZE) break;
  }
  return { scanned, orphaned, deleted };
}

export async function reconcileSourceMaps(input: {
  apply: boolean;
  now: () => Date;
  database: ReconciliationDatabase;
  storage: ReconciliationStorage;
  withStorageLock: StorageLock;
}): Promise<SourceMapReconciliationResult> {
  const scanStartedAt = input.now();
  if (Number.isNaN(scanStartedAt.getTime())) throw new Error("source_map_reconciliation_time_invalid");
  const cutoff = new Date(scanStartedAt.getTime() - ORPHAN_GRACE_MS);
  await input.storage.assertAuthority();

  const withoutFile: string[] = [];
  const preflightMetadata = await scanMetadata({
    database: input.database,
    storage: input.storage,
    mutate: false,
    reportMissingIds: withoutFile
  });
  const preflightFiles = await scanFiles({
    database: input.database,
    storage: input.storage,
    mutate: false,
    cutoff
  });
  const result: SourceMapReconciliationResult = {
    apply: input.apply,
    metadataScanned: preflightMetadata.scanned,
    filesScanned: preflightFiles.scanned,
    metadataWithoutFile: preflightMetadata.missing,
    filesWithoutMetadata: preflightFiles.orphaned,
    metadataDeleted: 0,
    filesDeleted: 0,
    metadataIds: {
      withoutFile,
      deleted: [],
      truncated: preflightMetadata.idsTruncated
    }
  };
  if (!input.apply) return result;

  const locked = await input.withStorageLock(async (lockedDatabase) => {
    await input.storage.assertAuthority();
    const metadataResult = await scanMetadata({
      database: lockedDatabase,
      storage: input.storage,
      mutate: true,
      reportDeletedIds: result.metadataIds.deleted
    });
    const fileResult = await scanFiles({
      database: lockedDatabase,
      storage: input.storage,
      mutate: true,
      cutoff
    });
    return { metadataResult, fileResult };
  });
  if (!locked.locked) throw new Error("source_map_reconciliation_lock_busy");
  result.metadataDeleted = locked.result.metadataResult.deleted;
  result.filesDeleted = locked.result.fileResult.deleted;
  result.metadataIds.truncated ||= locked.result.metadataResult.idsTruncated;
  return result;
}

function databaseRuntime(db: Db): ReconciliationDatabase {
  return {
    listMetadataPage: (input) => listActiveSourceMapMetadataPage(db, input),
    findActiveMetadataByStoragePaths: (storagePaths) => findActiveSourceMapMetadataByStoragePaths(db, storagePaths),
    softDeleteMetadata: async (candidate) =>
      (await softDeleteSourceMapMetadataForReconciliation(db, candidate)) !== null
  };
}

type DatabaseHandle = { destroy: () => Promise<void> };
type ClosableReconciliationStorage = ReconciliationStorage & { close: () => Promise<void> };
type MainDependencies = {
  loadRuntimeConfig?: () => { databaseUrl: string; localDir: string; nodeEnv?: string };
  openStorage?: (input: { localDir: string; mode: "require"; nodeEnv: string }) => Promise<ClosableReconciliationStorage>;
  createDatabase?: (databaseUrl: string) => DatabaseHandle;
  createDatabaseRuntime?: (database: DatabaseHandle) => ReconciliationDatabase;
  withDatabaseStorageLock?: <T>(
    database: DatabaseHandle,
    run: (lockedDatabase: ReconciliationDatabase) => Promise<T>
  ) => Promise<{ locked: false } | { locked: true; result: T }>;
};

export async function main(
  args = process.argv.slice(2),
  dependencies: MainDependencies = {}
): Promise<SourceMapReconciliationResult> {
  const { apply } = parseReconcileSourceMapsArgs(args);
  const runtimeConfig = dependencies.loadRuntimeConfig?.() ?? (() => {
    const config = loadConfig();
    return { databaseUrl: config.databaseUrl, localDir: config.sourceMaps.localDir, nodeEnv: config.nodeEnv };
  })();
  const openStorage = dependencies.openStorage ?? ((input) => openSourceMapStorageSession(input));
  const storage = await openStorage({
    localDir: runtimeConfig.localDir,
    mode: "require",
    nodeEnv: runtimeConfig.nodeEnv ?? process.env.NODE_ENV ?? "production"
  });
  let database: DatabaseHandle | undefined;
  let result: SourceMapReconciliationResult | undefined;
  let failed = false;
  try {
    database = (dependencies.createDatabase ?? createDb)(runtimeConfig.databaseUrl);
    const createRuntime = dependencies.createDatabaseRuntime ?? ((handle) => databaseRuntime(handle as Db));
    const runtime = createRuntime(database);
    const lock = dependencies.withDatabaseStorageLock ?? (async <T>(
      handle: DatabaseHandle,
      run: (lockedDatabase: ReconciliationDatabase) => Promise<T>
    ) => withSourceMapStorageLock(handle as Db, (lockedDb) => run(databaseRuntime(lockedDb as Db))));
    result = await reconcileSourceMaps({
      apply,
      now: () => new Date(),
      database: runtime,
      storage,
      withStorageLock: (run) => lock(database!, run)
    });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    const cleanupResults = await Promise.allSettled([
      database?.destroy(),
      storage.close()
    ]);
    if (!failed) {
      const cleanupFailure = cleanupResults.find((entry) => entry.status === "rejected");
      if (cleanupFailure?.status === "rejected") throw cleanupFailure.reason;
    }
  }
  console.log(JSON.stringify(result));
  return result!;
}

const safeErrorCodes = new Set([
  "source_map_reconciliation_argument_invalid",
  "source_map_reconciliation_batch_size_invalid",
  "source_map_reconciliation_file_order_invalid",
  "source_map_reconciliation_lock_busy",
  "source_map_reconciliation_membership_invalid",
  "source_map_reconciliation_metadata_order_invalid",
  "source_map_reconciliation_time_invalid",
  "source_map_storage_capability_unavailable",
  "source_map_storage_unavailable",
  "source_map_storage_unsupported_platform"
]);

export function safeReconciliationErrorCode(error: unknown): string {
  return error instanceof Error && safeErrorCodes.has(error.message)
    ? error.message
    : "source_map_reconciliation_failed";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ error: safeReconciliationErrorCode(error) }));
    process.exitCode = 1;
  });
}
