import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rm, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";

export const SOURCE_MAP_STORAGE_MARKER_NAME = ".sigmon-source-map-storage";
export const SOURCE_MAP_STORAGE_MARKER_CONTENT = "sigmon-source-map-storage-v1\n";
export type SourceMapStorageRootMode = "create" | "require";

export class SourceMapStorageRootError extends Error {
  constructor(cause?: unknown) {
    super("source_map_storage_unavailable", cause === undefined ? undefined : { cause });
    this.name = "SourceMapStorageRootError";
  }
}

export class SourceMapStorageUnsupportedPlatformError extends Error {
  constructor() {
    super("source_map_storage_unsupported_platform");
    this.name = "SourceMapStorageUnsupportedPlatformError";
  }
}

export class SourceMapStorageCapabilityError extends Error {
  constructor(cause?: unknown) {
    super("source_map_storage_capability_unavailable", cause === undefined ? undefined : { cause });
    this.name = "SourceMapStorageCapabilityError";
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
function isInvalidEntryError(error: unknown): boolean {
  return isErrorCode(error, "ELOOP") || isErrorCode(error, "ENOTDIR");
}
function unavailable(cause?: unknown): SourceMapStorageRootError {
  return cause instanceof SourceMapStorageRootError ? cause : new SourceMapStorageRootError(cause);
}
function invalidStoragePath(): Error {
  return new Error("source_map_storage_path_invalid");
}
function sameIdentity(left: { dev: number | bigint; ino: number | bigint }, right: { dev: number | bigint; ino: number | bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function assertInsideSourceMapStorageRoot(canonicalRoot: string, candidatePath: string): void {
  const relativePath = path.relative(canonicalRoot, candidatePath);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw invalidStoragePath();
  }
}

async function validateMarker(canonicalRoot: string): Promise<void> {
  const markerPath = path.join(canonicalRoot, SOURCE_MAP_STORAGE_MARKER_NAME);
  const before = await lstat(markerPath);
  if (before.isSymbolicLink() || !before.isFile()) throw unavailable();
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(markerPath, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(opened, before)) throw unavailable();
    if (!(await handle.readFile()).equals(Buffer.from(SOURCE_MAP_STORAGE_MARKER_CONTENT))) throw unavailable();
  } finally {
    await handle.close();
  }
}

type RootOptions = {
  syncDirectory?: (directory: string) => Promise<void>;
  platform?: NodeJS.Platform;
  nodeEnv?: string;
};

async function defaultSyncDirectory(directory: string, options: RootOptions): Promise<void> {
  const directoryFlag = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY | directoryFlag);
    await handle.sync();
  } catch (error) {
    const platform = options.platform ?? process.platform;
    const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
    if (!(platform === "win32" && nodeEnv !== "production" && isErrorCode(error, "EPERM"))) throw error;
  } finally {
    await handle?.close();
  }
}

async function createMarkerExclusively(canonicalRoot: string, options: RootOptions): Promise<void> {
  const markerPath = path.join(canonicalRoot, SOURCE_MAP_STORAGE_MARKER_NAME);
  const tempPath = path.join(canonicalRoot, `${SOURCE_MAP_STORAGE_MARKER_NAME}.${randomUUID()}.tmp`);
  const syncDirectory = options.syncDirectory ?? ((directory: string) => defaultSyncDirectory(directory, options));
  let tempCreated = false;
  let primaryError: unknown;
  try {
    const handle = await open(tempPath, "wx", 0o600);
    tempCreated = true;
    try {
      await handle.writeFile(SOURCE_MAP_STORAGE_MARKER_CONTENT);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(tempPath, markerPath);
      await syncDirectory(canonicalRoot);
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) primaryError = error;
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (tempCreated) {
      try {
        await rm(tempPath, { force: true });
        await syncDirectory(canonicalRoot);
      } catch (error) {
        if (primaryError === undefined) primaryError = error;
      }
    }
  }
  if (primaryError !== undefined) throw primaryError;
}

export async function assertSourceMapStorageRoot(
  localDir: string,
  mode: SourceMapStorageRootMode,
  options: RootOptions = {}
): Promise<string> {
  try {
    if (mode === "create") await mkdir(localDir, { recursive: true, mode: 0o700 });
    const rootStats = await lstat(localDir);
    if (!rootStats.isDirectory() && !rootStats.isSymbolicLink()) throw unavailable();
    const canonicalRoot = await realpath(localDir);
    const canonicalStats = await lstat(canonicalRoot);
    if (canonicalStats.isSymbolicLink() || !canonicalStats.isDirectory()) throw unavailable();
    if (mode === "create") {
      try {
        await validateMarker(canonicalRoot);
      } catch (error) {
        if (!isErrorCode((error as Error & { cause?: unknown }).cause, "ENOENT") && !isErrorCode(error, "ENOENT")) throw error;
        await createMarkerExclusively(canonicalRoot, options);
      }
    }
    await validateMarker(canonicalRoot);
    return canonicalRoot;
  } catch (error) {
    throw unavailable(error);
  }
}

export type SourceMapStorageOperationHooks = {
  afterParentPinned?: () => Promise<void>;
  afterCreateBeforeRootCheck?: () => Promise<void>;
};
export type OpenSourceMapStorageSessionInput = {
  localDir: string;
  mode: SourceMapStorageRootMode;
  nodeEnv: string;
  platform?: NodeJS.Platform;
  procFdRoot?: string;
  hooks?: SourceMapStorageOperationHooks;
};

const STORAGE_SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]{1,160}$/;
const FLAT_ARTIFACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.map$/i;
type ParsedStoragePath = { segments: string[]; flat: boolean };

function parseStoragePath(canonicalRoot: string, storagePath: string): ParsedStoragePath {
  if (!path.isAbsolute(storagePath)) throw invalidStoragePath();
  const candidate = path.resolve(storagePath);
  assertInsideSourceMapStorageRoot(canonicalRoot, candidate);
  const segments = path.relative(canonicalRoot, candidate).split(path.sep);
  if (segments.some((segment) => !STORAGE_SEGMENT.test(segment))) throw invalidStoragePath();
  const flat = segments.length === 1 && FLAT_ARTIFACT.test(segments[0]);
  const legacy = segments.length === 4 && /^(?!\.+$)[A-Za-z0-9._-]{1,160}\.map$/.test(segments[3]);
  if (!flat && !legacy) throw invalidStoragePath();
  return { segments, flat };
}

function assertOpaqueArtifactName(fileName: string): void {
  if (!FLAT_ARTIFACT.test(fileName) || path.basename(fileName) !== fileName) throw invalidStoragePath();
}

type ParentCapability = { parent: FileHandle; finalName: string; handles: FileHandle[] };

export class SourceMapStorageSession {
  readonly canonicalRoot: string;
  readonly platform: NodeJS.Platform;
  private readonly configuredRoot: string;
  private readonly rootHandle: FileHandle;
  private readonly rootIdentity: { dev: number | bigint; ino: number | bigint };
  private readonly procFdRoot: string;
  private readonly defaultHooks: SourceMapStorageOperationHooks;
  private closed = false;

  constructor(input: {
    configuredRoot: string;
    canonicalRoot: string;
    platform: NodeJS.Platform;
    rootHandle: FileHandle;
    rootIdentity: { dev: number | bigint; ino: number | bigint };
    procFdRoot: string;
    hooks?: SourceMapStorageOperationHooks;
  }) {
    this.configuredRoot = input.configuredRoot;
    this.canonicalRoot = input.canonicalRoot;
    this.platform = input.platform;
    this.rootHandle = input.rootHandle;
    this.rootIdentity = input.rootIdentity;
    this.procFdRoot = input.procFdRoot;
    this.defaultHooks = input.hooks ?? {};
  }

  private hooks(overrides?: SourceMapStorageOperationHooks): SourceMapStorageOperationHooks {
    return { ...this.defaultHooks, ...overrides };
  }

  private async assertConfiguredRootIdentity(): Promise<void> {
    try {
      const canonical = await realpath(this.configuredRoot);
      const current = await lstat(canonical);
      const opened = await this.rootHandle.stat();
      if (canonical !== this.canonicalRoot || !current.isDirectory() || !sameIdentity(current, opened) || !sameIdentity(opened, this.rootIdentity)) throw unavailable();
    } catch (error) {
      throw unavailable(error);
    }
  }

  async assertAuthority(): Promise<void> {
    if (this.closed) throw unavailable();
    await this.assertConfiguredRootIdentity();
    const markerRoot = this.platform === "linux"
      ? path.posix.join(this.procFdRoot, String(this.rootHandle.fd))
      : this.canonicalRoot;
    try {
      await validateMarker(markerRoot);
      await this.assertConfiguredRootIdentity();
    } catch (error) {
      throw unavailable(error);
    }
  }

  private async pinLinuxParent(segments: string[]): Promise<ParentCapability> {
    const handles: FileHandle[] = [];
    let parent = this.rootHandle;
    const directoryFlag = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;
    const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
    try {
      for (const segment of segments.slice(0, -1)) {
        const child = await open(path.posix.join(this.procFdRoot, String(parent.fd), segment), constants.O_RDONLY | directoryFlag | noFollow);
        const stats = await child.stat();
        if (!stats.isDirectory()) {
          await child.close();
          throw invalidStoragePath();
        }
        handles.push(child);
        parent = child;
      }
      return { parent, finalName: segments.at(-1)!, handles };
    } catch (error) {
      await Promise.allSettled(handles.map((handle) => handle.close()));
      if (isInvalidEntryError(error)) throw invalidStoragePath();
      throw error;
    }
  }

  private linuxFinalPath(capability: ParentCapability): string {
    return path.posix.join(this.procFdRoot, String(capability.parent.fd), capability.finalName);
  }

  async createArtifact(fileName: string, content: Buffer, hookOverrides?: SourceMapStorageOperationHooks): Promise<string> {
    assertOpaqueArtifactName(fileName);
    if (this.closed) throw unavailable();
    const hooks = this.hooks(hookOverrides);
    await this.assertConfiguredRootIdentity();
    if (this.platform === "linux") {
      const capability = await this.pinLinuxParent([fileName]);
      const finalPath = this.linuxFinalPath(capability);
      let created = false;
      try {
        await hooks.afterParentPinned?.();
        const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
        const handle = await open(finalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
        created = true;
        try {
          await handle.writeFile(content);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await hooks.afterCreateBeforeRootCheck?.();
        await this.assertConfiguredRootIdentity();
      } catch (error) {
        if (created) {
          try { await unlink(finalPath); } catch (cleanupError) { if (!isErrorCode(cleanupError, "ENOENT")) { /* keep primary */ } }
        }
        throw error;
      } finally {
        await Promise.allSettled(capability.handles.map((handle) => handle.close()));
      }
    } else {
      const finalPath = path.join(this.canonicalRoot, fileName);
      const handle = await open(finalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await hooks.afterCreateBeforeRootCheck?.();
      try {
        await this.assertConfiguredRootIdentity();
      } catch (error) {
        try {
          await this.assertConfiguredRootIdentity();
          await unlink(finalPath);
        } catch { /* do not follow a replacement root during cleanup */ }
        throw error;
      }
    }
    return path.join(this.canonicalRoot, fileName);
  }

  async readArtifact(storagePath: string, hookOverrides?: SourceMapStorageOperationHooks): Promise<Buffer> {
    if (this.closed) throw unavailable();
    const parsed = parseStoragePath(this.canonicalRoot, storagePath);
    if (this.platform !== "linux" && !parsed.flat) throw invalidStoragePath();
    await this.assertConfiguredRootIdentity();
    const hooks = this.hooks(hookOverrides);
    if (this.platform === "linux") {
      const capability = await this.pinLinuxParent(parsed.segments);
      try {
        await hooks.afterParentPinned?.();
        const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
        const finalPath = this.linuxFinalPath(capability);
        const before = await lstat(finalPath);
        if (before.isSymbolicLink() || !before.isFile()) throw invalidStoragePath();
        let handle: FileHandle;
        try {
          handle = await open(finalPath, constants.O_RDONLY | noFollow);
        } catch (error) {
          if (isInvalidEntryError(error)) throw invalidStoragePath();
          throw error;
        }
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || !sameIdentity(before, opened)) throw invalidStoragePath();
          return await handle.readFile();
        } finally { await handle.close(); }
      } finally {
        await Promise.allSettled(capability.handles.map((handle) => handle.close()));
      }
    }
    const finalPath = path.join(this.canonicalRoot, parsed.segments[0]);
    const before = await lstat(finalPath);
    if (before.isSymbolicLink() || !before.isFile()) throw invalidStoragePath();
    const handle = await open(finalPath, constants.O_RDONLY);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameIdentity(before, opened)) throw invalidStoragePath();
      await this.assertConfiguredRootIdentity();
      return await handle.readFile();
    } finally { await handle.close(); }
  }

  async deleteArtifact(storagePath: string, hookOverrides?: SourceMapStorageOperationHooks): Promise<boolean> {
    if (this.closed) throw unavailable();
    const parsed = parseStoragePath(this.canonicalRoot, storagePath);
    if (this.platform !== "linux" && !parsed.flat) throw invalidStoragePath();
    await this.assertConfiguredRootIdentity();
    const hooks = this.hooks(hookOverrides);
    if (this.platform === "linux") {
      let capability: ParentCapability;
      try { capability = await this.pinLinuxParent(parsed.segments); }
      catch (error) { if (isErrorCode(error, "ENOENT")) return false; throw error; }
      try {
        await hooks.afterParentPinned?.();
        const finalPath = this.linuxFinalPath(capability);
        let stats;
        try { stats = await lstat(finalPath); }
        catch (error) { if (isErrorCode(error, "ENOENT")) return false; throw error; }
        if (stats.isSymbolicLink() || !stats.isFile()) throw invalidStoragePath();
        try { await unlink(finalPath); return true; }
        catch (error) { if (isErrorCode(error, "ENOENT")) return false; throw error; }
      } finally {
        await Promise.allSettled(capability.handles.map((handle) => handle.close()));
      }
    }
    const finalPath = path.join(this.canonicalRoot, parsed.segments[0]);
    let before;
    try { before = await lstat(finalPath); }
    catch (error) { if (isErrorCode(error, "ENOENT")) return false; throw error; }
    if (before.isSymbolicLink() || !before.isFile()) throw invalidStoragePath();
    const handle = await open(finalPath, constants.O_RDONLY);
    try {
      const opened = await handle.stat();
      if (!sameIdentity(before, opened)) throw invalidStoragePath();
      await hooks.afterParentPinned?.();
      await this.assertConfiguredRootIdentity();
    } finally { await handle.close(); }
    await this.assertConfiguredRootIdentity();
    try {
      await unlink(finalPath);
      await this.assertConfiguredRootIdentity();
      return true;
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return false;
      throw error;
    }
  }

  async cleanupCreatedArtifact(storagePath: string): Promise<boolean> {
    if (this.closed) throw unavailable();
    const parsed = parseStoragePath(this.canonicalRoot, storagePath);
    if (parsed.segments.length !== 1 || !FLAT_ARTIFACT.test(parsed.segments[0])) throw invalidStoragePath();
    if (this.platform !== "linux") return this.deleteArtifact(storagePath);

    const capability = await this.pinLinuxParent(parsed.segments);
    try {
      const finalPath = this.linuxFinalPath(capability);
      let stats;
      try { stats = await lstat(finalPath); }
      catch (error) { if (isErrorCode(error, "ENOENT")) return false; throw error; }
      if (stats.isSymbolicLink() || !stats.isFile()) throw invalidStoragePath();
      try { await unlink(finalPath); return true; }
      catch (error) { if (isErrorCode(error, "ENOENT")) return false; throw error; }
    } finally {
      await Promise.allSettled(capability.handles.map((handle) => handle.close()));
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.rootHandle.close();
  }
}

export async function openSourceMapStorageSession(input: OpenSourceMapStorageSessionInput): Promise<SourceMapStorageSession> {
  const platform = input.platform ?? process.platform;
  if (platform !== "linux" && input.nodeEnv === "production") throw new SourceMapStorageUnsupportedPlatformError();
  const canonicalRoot = await assertSourceMapStorageRoot(input.localDir, input.mode, { platform, nodeEnv: input.nodeEnv });
  const directoryFlag = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : 0;
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const beforeOpen = await lstat(canonicalRoot);
  const rootHandle = await open(canonicalRoot, constants.O_RDONLY | directoryFlag | noFollow);
  try {
    const rootIdentity = await rootHandle.stat();
    if (!rootIdentity.isDirectory() || !sameIdentity(beforeOpen, rootIdentity)) throw unavailable();
    const procFdRoot = input.procFdRoot ?? "/proc/self/fd";
    if (platform === "linux") {
      let probe: FileHandle | undefined;
      try {
        // This intentionally follows the procfs magic link to verify that the
        // held root descriptor can serve as the authority for child operations.
        probe = await open(path.posix.join(procFdRoot, String(rootHandle.fd)), constants.O_RDONLY | directoryFlag);
        const probeIdentity = await probe.stat();
        if (!probeIdentity.isDirectory() || !sameIdentity(rootIdentity, probeIdentity)) throw new SourceMapStorageCapabilityError();
      } catch (error) {
        throw error instanceof SourceMapStorageCapabilityError ? error : new SourceMapStorageCapabilityError(error);
      } finally { await probe?.close(); }
    }
    const session = new SourceMapStorageSession({
      configuredRoot: input.localDir,
      canonicalRoot,
      platform,
      rootHandle,
      rootIdentity,
      procFdRoot,
      hooks: input.hooks
    });
    await session.assertAuthority();
    return session;
  } catch (error) {
    await rootHandle.close();
    throw error;
  }
}

export async function listenAfterSourceMapStorage<T>(input: {
  localDir: string;
  initialize?: (localDir: string, mode: SourceMapStorageRootMode) => Promise<unknown>;
  listen: () => Promise<T>;
}): Promise<T> {
  await (input.initialize ?? assertSourceMapStorageRoot)(input.localDir, "create");
  return input.listen();
}
