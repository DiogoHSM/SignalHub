import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
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
  const genRef = useRef(0);

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

  const createToken = useCallback(
    (name: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createSourceMapUploadToken) return;
        const { token } = await client.createSourceMapUploadToken({ projectId, environmentId, name });
        setLatestSecret({ name: token.name, prefix: token.prefix, secret: token.secret });
      }),
    [client, environmentId, projectId, run],
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
    deleteArtifact,
    createToken,
    renameToken,
    revokeToken,
  };
}
