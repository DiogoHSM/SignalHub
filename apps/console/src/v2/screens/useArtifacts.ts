import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient, type SourceMapBundleUploadInput, type SourceMapUploadInput } from "../../api/client";
import type { SourceMapArtifact, SourceMapUploadToken } from "../../api/types";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ArtifactRowVM = {
  id: string;
  minifiedFile: string;
  release: string;
  originalFilename: string;
  byteSizeLabel: string;
  createdLabel: string;
};

export type TokenRowVM = {
  id: string;
  name: string;
  prefix: string;
  createdLabel: string;
  lastUsedLabel: string;
  revoked: boolean;
  statusLabel: string;
};

export type ArtifactsVM = {
  artifacts: ArtifactRowVM[];
  tokens: TokenRowVM[];
  artifactCount: number;
  tokenCount: number;
  artifactsAvailable: boolean;
  tokensAvailable: boolean;
};

export type LatestTokenSecret = {
  name: string;
  prefix: string;
  secret: string;
};

export const MAX_SOURCE_MAP_UPLOAD_BYTES = 50 * 1024 * 1024;

export type SourceMapUploadError = {
  kind: "invalid" | "unauthorized" | "too_large" | "unavailable" | "network" | "unknown";
  message: string;
  status: number | null;
  code: string | null;
};

export type SourceMapUploadResult =
  | { ok: true }
  | { ok: false; reason: "busy" | "stale" }
  | { ok: false; reason: "error"; error: SourceMapUploadError };

export type BuildArtifactsInput = {
  artifacts: SourceMapArtifact[];
  tokens: SourceMapUploadToken[];
  artifactsAvailable: boolean;
  tokensAvailable: boolean;
};

export type UseArtifactsResult = {
  data: ArtifactsVM | null;
  status: "loading" | "ok" | "error" | "unavailable";
  latestSecret: LatestTokenSecret | null;
  busy: boolean;
  releaseFilter: string;
  applyFilter: (release: string) => void;
  reload: () => void;
  clearSecret: () => void;
  canUploadMap: boolean;
  canUploadBundle: boolean;
  uploadMap: (input: Omit<SourceMapUploadInput, "projectId" | "environmentId">) => Promise<SourceMapUploadResult>;
  uploadBundle: (input: Omit<SourceMapBundleUploadInput, "projectId" | "environmentId">) => Promise<SourceMapUploadResult>;
  deleteArtifact: (id: string) => Promise<boolean>;
  createToken: (name: string) => Promise<boolean>;
  renameToken: (id: string, name: string) => Promise<boolean>;
  revokeToken: (id: string) => Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function validateSourceMapUploadFile(file: File, kind: "map" | "bundle"): string | null {
  const expectedExtension = kind === "map" ? ".map" : ".zip";
  if (!file.name.toLowerCase().endsWith(expectedExtension)) {
    return kind === "map"
      ? "Choose a source map file ending in .map."
      : "Choose a source map bundle ending in .zip.";
  }
  if (file.size > MAX_SOURCE_MAP_UPLOAD_BYTES) {
    return "The selected file exceeds the 50 MB upload limit.";
  }
  return null;
}

export function mapSourceMapUploadError(error: unknown): SourceMapUploadError {
  if (error instanceof ApiError) {
    if (error.status === 400) {
      return {
        kind: "invalid",
        message: "Check the release, minified file path, and file format, then try again.",
        status: error.status,
        code: error.code,
      };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        kind: "unauthorized",
        message: "Your session is not authorized for this upload. Please sign in again.",
        status: error.status,
        code: error.code,
      };
    }
    if (error.status === 413) {
      return {
        kind: "too_large",
        message: "The server rejected this file because it exceeds the 50 MB upload limit.",
        status: error.status,
        code: error.code,
      };
    }
    if (error.status === 501) {
      return {
        kind: "unavailable",
        message: "Manual source-map upload is not enabled in this Sigmon deployment.",
        status: error.status,
        code: error.code,
      };
    }
    return {
      kind: "unknown",
      message: "Sigmon could not process this upload. Try again or check the server logs.",
      status: error.status,
      code: error.code,
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "network",
      message: "Could not reach Sigmon. Check your connection and try the upload again.",
      status: null,
      code: null,
    };
  }
  return {
    kind: "unknown",
    message: "Could not upload the source map. Check the file and try again.",
    status: null,
    code: null,
  };
}

function relativeTimeFrom(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildArtifactsVM(input: BuildArtifactsInput, nowMs: number): ArtifactsVM {
  const { artifacts, tokens, artifactsAvailable, tokensAvailable } = input;

  const artifactRows: ArtifactRowVM[] = artifacts.map((a) => ({
    id: a.id,
    minifiedFile: a.minifiedFile,
    release: a.release,
    originalFilename: a.originalFilename,
    byteSizeLabel: formatBytes(a.byteSize),
    createdLabel: relativeTimeFrom(a.createdAt, nowMs),
  }));

  const tokenRows: TokenRowVM[] = tokens.map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdLabel: relativeTimeFrom(t.createdAt, nowMs),
    lastUsedLabel: relativeTimeFrom(t.lastUsedAt, nowMs),
    revoked: t.revokedAt != null,
    statusLabel: t.revokedAt != null ? "revoked" : "active",
  }));

  return {
    artifacts: artifactRows,
    tokens: tokenRows,
    artifactCount: artifactRows.length,
    tokenCount: tokenRows.length,
    artifactsAvailable,
    tokensAvailable,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseArtifactsArgs = {
  client: ApiClient;
  projectId: string | undefined;
  environmentId: string | undefined;
};

export function useArtifacts({ client, projectId, environmentId }: UseArtifactsArgs): UseArtifactsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unavailable">("loading");
  const [data, setData] = useState<ArtifactsVM | null>(null);
  const [latestSecret, setLatestSecret] = useState<LatestTokenSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [releaseFilter, setReleaseFilter] = useState("");
  const [uploadUnavailable, setUploadUnavailable] = useState({ map: false, bundle: false });
  const genRef = useRef(0);
  const uploadGenerationRef = useRef(0);
  const uploadLockRef = useRef(false);
  const scopeKey = `${projectId ?? ""}:${environmentId ?? ""}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const clearSecret = useCallback(() => setLatestSecret(null), []);
  const applyFilter = useCallback((release: string) => {
    setReleaseFilter(release);
    setTick((t) => t + 1);
  }, []);

  // Reset the shown secret and the filter when the scope changes.
  useEffect(() => {
    setLatestSecret(null);
    setReleaseFilter("");
    setUploadUnavailable({ map: false, bundle: false });
    setBusy(false);
    uploadLockRef.current = false;
    uploadGenerationRef.current += 1;
  }, [projectId, environmentId]);

  useEffect(() => {
    if (!projectId || !environmentId) return;
    const hasArtifacts = typeof client.listSourceMapArtifacts === "function";
    const hasTokens = typeof client.listSourceMapUploadTokens === "function";
    if (!hasArtifacts && !hasTokens) {
      setStatus("unavailable");
      setData(null);
      return;
    }

    const gen = ++genRef.current;
    const nowMs = Date.now();
    setStatus("loading");

    const release = releaseFilter.trim();
    const artifactsP =
      hasArtifacts && client.listSourceMapArtifacts
        ? client.listSourceMapArtifacts({ projectId, environmentId, ...(release ? { release } : {}) })
        : Promise.resolve([] as SourceMapArtifact[]);
    const tokensP =
      hasTokens && client.listSourceMapUploadTokens
        ? client.listSourceMapUploadTokens({ projectId, environmentId }).then((r) => r.tokens)
        : Promise.resolve([] as SourceMapUploadToken[]);

    Promise.all([artifactsP, tokensP])
      .then(([artifacts, tokens]) => {
        if (gen !== genRef.current) return;
        setData(
          buildArtifactsVM(
            { artifacts, tokens, artifactsAvailable: hasArtifacts, tokensAvailable: hasTokens },
            nowMs,
          ),
        );
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, tick]);

  // Returns true on success, false on failure. The caller surfaces the
  // user-facing message via pushToast when this resolves false.
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const deleteArtifact = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.deleteSourceMapArtifact) return;
        await client.deleteSourceMapArtifact(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  const runUpload = useCallback(
    async (kind: "map" | "bundle", fn: () => Promise<void>): Promise<SourceMapUploadResult> => {
      if (uploadLockRef.current) return { ok: false, reason: "busy" };
      uploadLockRef.current = true;
      const operationGeneration = ++uploadGenerationRef.current;
      const operationScope = scopeKey;
      setBusy(true);
      try {
        await fn();
        if (scopeRef.current !== operationScope || uploadGenerationRef.current !== operationGeneration) {
          return { ok: false, reason: "stale" };
        }
        reload();
        return { ok: true };
      } catch (error) {
        if (scopeRef.current !== operationScope || uploadGenerationRef.current !== operationGeneration) {
          return { ok: false, reason: "stale" };
        }
        console.error(error);
        const mapped = mapSourceMapUploadError(error);
        if (mapped.kind === "unavailable") {
          setUploadUnavailable((current) => ({ ...current, [kind]: true }));
        }
        return { ok: false, reason: "error", error: mapped };
      } finally {
        if (uploadGenerationRef.current === operationGeneration) {
          uploadLockRef.current = false;
          setBusy(false);
        }
      }
    },
    [reload, scopeKey],
  );

  const uploadMap = useCallback(
    (input: Omit<SourceMapUploadInput, "projectId" | "environmentId">) =>
      runUpload("map", async () => {
        if (!projectId || !environmentId || !client.uploadSourceMap) {
          throw new Error("Source-map upload is unavailable");
        }
        await client.uploadSourceMap({ projectId, environmentId, ...input });
      }),
    [client, environmentId, projectId, runUpload],
  );

  const uploadBundle = useCallback(
    (input: Omit<SourceMapBundleUploadInput, "projectId" | "environmentId">) =>
      runUpload("bundle", async () => {
        if (!projectId || !environmentId || !client.uploadSourceMapBundle) {
          throw new Error("Source-map bundle upload is unavailable");
        }
        await client.uploadSourceMapBundle({ projectId, environmentId, ...input });
      }),
    [client, environmentId, projectId, runUpload],
  );

  const createToken = useCallback(
    (name: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createSourceMapUploadToken) return;
        const operationScope = scopeKey;
        const { token } = await client.createSourceMapUploadToken({ projectId, environmentId, name });
        if (scopeRef.current !== operationScope) return;
        setLatestSecret({ name: token.name, prefix: token.prefix, secret: token.secret });
      }),
    [client, environmentId, projectId, run, scopeKey],
  );

  const renameToken = useCallback(
    (id: string, name: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateSourceMapUploadToken) return;
        await client.updateSourceMapUploadToken(id, { projectId, environmentId }, { name });
      }),
    [client, environmentId, projectId, run],
  );

  const revokeToken = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.revokeSourceMapUploadToken) return;
        await client.revokeSourceMapUploadToken(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  return {
    data,
    status,
    latestSecret,
    busy,
    releaseFilter,
    applyFilter,
    reload,
    clearSecret,
    canUploadMap: typeof client.uploadSourceMap === "function" && !uploadUnavailable.map,
    canUploadBundle: typeof client.uploadSourceMapBundle === "function" && !uploadUnavailable.bundle,
    uploadMap,
    uploadBundle,
    deleteArtifact,
    createToken,
    renameToken,
    revokeToken,
  };
}
