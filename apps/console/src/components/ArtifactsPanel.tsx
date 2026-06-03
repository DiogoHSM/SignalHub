import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import type { ApiClient, SourceMapApiClient } from "../api/client";
import type { SourceMapArtifact, SourceMapUploadToken } from "../api/types";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type SourceMapArtifactsClient = ApiClient &
  Pick<SourceMapApiClient, "listSourceMapArtifacts" | "uploadSourceMap" | "uploadSourceMapBundle" | "deleteSourceMapArtifact">;
type SourceMapTokenClient = ApiClient &
  Pick<
    SourceMapApiClient,
    "listSourceMapUploadTokens" | "createSourceMapUploadToken" | "updateSourceMapUploadToken" | "revokeSourceMapUploadToken"
  >;

function hasSourceMapArtifactsClient(client: ApiClient): client is SourceMapArtifactsClient {
  return (
    typeof client.listSourceMapArtifacts === "function" &&
    typeof client.uploadSourceMap === "function" &&
    typeof client.uploadSourceMapBundle === "function" &&
    typeof client.deleteSourceMapArtifact === "function"
  );
}

function hasSourceMapTokenClient(client: ApiClient): client is SourceMapTokenClient {
  return (
    typeof client.listSourceMapUploadTokens === "function" &&
    typeof client.createSourceMapUploadToken === "function" &&
    typeof client.updateSourceMapUploadToken === "function" &&
    typeof client.revokeSourceMapUploadToken === "function"
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "No data" : timestamp.toLocaleString();
}

function sourceMapUploadTokenWithoutSecret(token: SourceMapUploadToken): SourceMapUploadToken {
  return {
    id: token.id,
    projectId: token.projectId,
    environmentId: token.environmentId,
    name: token.name,
    prefix: token.prefix,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    revokedAt: token.revokedAt
  };
}

export function ArtifactsPanel({ client, projectId, environmentId }: Props) {
  const currentScopeRef = useRef({ projectId, environmentId });
  const loadRequestRef = useRef(0);
  const tokenLoadRequestRef = useRef(0);
  const mapFileRef = useRef<HTMLInputElement | null>(null);
  const bundleFileRef = useRef<HTMLInputElement | null>(null);
  const [artifacts, setArtifacts] = useState<SourceMapArtifact[]>([]);
  const [artifactsScopeKey, setArtifactsScopeKey] = useState<string | null>(null);
  const [tokens, setTokens] = useState<SourceMapUploadToken[]>([]);
  const [tokensState, setTokensState] = useState<"loading" | "ready" | "empty" | "unavailable">("loading");
  const [tokenName, setTokenName] = useState("");
  const [editingToken, setEditingToken] = useState<SourceMapUploadToken | null>(null);
  const [createdTokenSecret, setCreatedTokenSecret] = useState<string | null>(null);
  const [isCreatingToken, setIsCreatingToken] = useState(false);
  const [updatingTokenId, setUpdatingTokenId] = useState<string | null>(null);
  const [revokingTokenId, setRevokingTokenId] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [releaseFilter, setReleaseFilter] = useState("");
  const [mapRelease, setMapRelease] = useState("");
  const [minifiedFile, setMinifiedFile] = useState("");
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [bundleRelease, setBundleRelease] = useState("");
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingMap, setIsUploadingMap] = useState(false);
  const [isUploadingBundle, setIsUploadingBundle] = useState(false);
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  currentScopeRef.current = { projectId, environmentId };

  const currentScopeKey = projectId && environmentId ? `${projectId}:${environmentId}` : null;
  const canUseSourceMaps = hasSourceMapArtifactsClient(client);
  const canUseSourceMapTokens = hasSourceMapTokenClient(client);
  const canUploadMap =
    canUseSourceMaps && Boolean(projectId && environmentId && mapRelease.trim() && minifiedFile.trim() && mapFile) && !isUploadingMap;
  const canUploadBundle =
    canUseSourceMaps && Boolean(projectId && environmentId && bundleRelease.trim() && bundleFile) && !isUploadingBundle;
  const canCreateToken =
    canUseSourceMapTokens &&
    tokensState !== "unavailable" &&
    Boolean(projectId && environmentId && tokenName.trim()) &&
    !isCreatingToken &&
    !updatingTokenId;
  const visibleArtifacts =
    artifactsScopeKey === currentScopeKey
      ? artifacts.filter((artifact) => artifact.projectId === projectId && artifact.environmentId === environmentId)
      : [];

  function isLatestLoad(requestId: number, requestedProjectId: string, requestedEnvironmentId: string): boolean {
    return (
      loadRequestRef.current === requestId &&
      currentScopeRef.current.projectId === requestedProjectId &&
      currentScopeRef.current.environmentId === requestedEnvironmentId
    );
  }

  function isLatestTokenLoad(requestId: number, requestedProjectId: string, requestedEnvironmentId: string): boolean {
    return (
      tokenLoadRequestRef.current === requestId &&
      currentScopeRef.current.projectId === requestedProjectId &&
      currentScopeRef.current.environmentId === requestedEnvironmentId
    );
  }

  async function loadArtifacts(filter = releaseFilter) {
    if (!projectId || !environmentId || !canUseSourceMaps) return;
    const requestedProjectId = projectId;
    const requestedEnvironmentId = environmentId;
    const requestedScopeKey = `${requestedProjectId}:${requestedEnvironmentId}`;
    const requestId = loadRequestRef.current + 1;
    const release = filter.trim();

    loadRequestRef.current = requestId;
    setIsLoading(true);
    setError(null);
    try {
      const result = await client.listSourceMapArtifacts({
        projectId: requestedProjectId,
        environmentId: requestedEnvironmentId,
        ...(release ? { release } : {})
      });
      if (!isLatestLoad(requestId, requestedProjectId, requestedEnvironmentId)) {
        return;
      }
      setArtifacts(result);
      setArtifactsScopeKey(requestedScopeKey);
    } catch {
      if (!isLatestLoad(requestId, requestedProjectId, requestedEnvironmentId)) {
        return;
      }
      setArtifacts([]);
      setArtifactsScopeKey(requestedScopeKey);
      setError("Source map artifacts unavailable");
    } finally {
      if (isLatestLoad(requestId, requestedProjectId, requestedEnvironmentId)) {
        setIsLoading(false);
      }
    }
  }

  async function loadTokens(isCancelled = () => false) {
    if (!projectId || !environmentId || !canUseSourceMapTokens) return;
    const requestedProjectId = projectId;
    const requestedEnvironmentId = environmentId;
    const requestId = tokenLoadRequestRef.current + 1;

    tokenLoadRequestRef.current = requestId;
    setTokensState("loading");
    setTokenError(null);
    setCreatedTokenSecret(null);
    try {
      const response = await client.listSourceMapUploadTokens({
        projectId: requestedProjectId,
        environmentId: requestedEnvironmentId
      });
      if (isCancelled() || !isLatestTokenLoad(requestId, requestedProjectId, requestedEnvironmentId)) {
        return;
      }
      setTokens(response.tokens);
      setTokensState(response.tokens.length > 0 ? "ready" : "empty");
    } catch {
      if (isCancelled() || !isLatestTokenLoad(requestId, requestedProjectId, requestedEnvironmentId)) {
        return;
      }
      setTokens([]);
      setTokensState("unavailable");
      setTokenError(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadRequestRef.current += 1;
    tokenLoadRequestRef.current += 1;
    setArtifacts([]);
    setArtifactsScopeKey(null);
    setTokens([]);
    setTokensState("loading");
    setTokenName("");
    setEditingToken(null);
    setCreatedTokenSecret(null);
    setIsCreatingToken(false);
    setUpdatingTokenId(null);
    setRevokingTokenId(null);
    setTokenError(null);
    setMapRelease("");
    setMinifiedFile("");
    setMapFile(null);
    setBundleRelease("");
    setBundleFile(null);
    setError(null);
    setIsUploadingMap(false);
    setIsUploadingBundle(false);
    setDeletingArtifactId(null);
    if (mapFileRef.current) mapFileRef.current.value = "";
    if (bundleFileRef.current) bundleFileRef.current.value = "";

    if (!projectId || !environmentId) {
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (!canUseSourceMaps) {
      setIsLoading(false);
      setError("Source map artifacts unavailable");
    } else {
      void loadArtifacts();
    }

    if (!canUseSourceMapTokens) {
      setTokensState("unavailable");
    } else {
      void loadTokens(() => cancelled);
    }

    return () => {
      cancelled = true;
    };
  }, [canUseSourceMapTokens, canUseSourceMaps, client, environmentId, projectId]);

  async function uploadMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !environmentId || !canUseSourceMaps || !mapFile || !canUploadMap) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;

    setIsUploadingMap(true);
    setError(null);
    try {
      await client.uploadSourceMap({
        projectId: submittedProjectId,
        environmentId: submittedEnvironmentId,
        release: mapRelease.trim(),
        minifiedFile: minifiedFile.trim(),
        file: mapFile
      });
      if (
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setMapRelease("");
      setMinifiedFile("");
      setMapFile(null);
      if (mapFileRef.current) mapFileRef.current.value = "";
      await loadArtifacts();
    } catch {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setError("Could not upload source map");
      }
    } finally {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setIsUploadingMap(false);
      }
    }
  }

  async function uploadBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !environmentId || !canUseSourceMaps || !bundleFile || !canUploadBundle) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;

    setIsUploadingBundle(true);
    setError(null);
    try {
      await client.uploadSourceMapBundle({
        projectId: submittedProjectId,
        environmentId: submittedEnvironmentId,
        release: bundleRelease.trim(),
        bundle: bundleFile
      });
      if (
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setBundleRelease("");
      setBundleFile(null);
      if (bundleFileRef.current) bundleFileRef.current.value = "";
      await loadArtifacts();
    } catch {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setError("Could not upload source map bundle");
      }
    } finally {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setIsUploadingBundle(false);
      }
    }
  }

  async function deleteArtifact(artifact: SourceMapArtifact) {
    if (!projectId || !environmentId || !canUseSourceMaps || deletingArtifactId) return;
    if (artifactsScopeKey !== currentScopeKey || artifact.projectId !== projectId || artifact.environmentId !== environmentId) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;

    setDeletingArtifactId(artifact.id);
    setError(null);
    try {
      await client.deleteSourceMapArtifact(artifact.id, {
        projectId: submittedProjectId,
        environmentId: submittedEnvironmentId
      });
      await loadArtifacts();
    } catch {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setError("Could not delete source map");
      }
    } finally {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setDeletingArtifactId(null);
      }
    }
  }

  async function createUploadToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || !environmentId || !canUseSourceMapTokens) return;
    const name = tokenName.trim();
    if (!name || isCreatingToken || updatingTokenId) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;

    if (editingToken) {
      setUpdatingTokenId(editingToken.id);
      setTokenError(null);
      setCreatedTokenSecret(null);
      try {
        const { token } = await client.updateSourceMapUploadToken(
          editingToken.id,
          { projectId: submittedProjectId, environmentId: submittedEnvironmentId },
          { name }
        );
        if (
          currentScopeRef.current.projectId !== submittedProjectId ||
          currentScopeRef.current.environmentId !== submittedEnvironmentId
        ) {
          return;
        }
        setTokens((current) => current.map((item) => (item.id === token.id ? sourceMapUploadTokenWithoutSecret(token) : item)));
        setEditingToken(null);
        setTokenName("");
      } catch {
        if (
          currentScopeRef.current.projectId === submittedProjectId &&
          currentScopeRef.current.environmentId === submittedEnvironmentId
        ) {
          setTokenError("Could not update source map upload token");
        }
      } finally {
        if (
          currentScopeRef.current.projectId === submittedProjectId &&
          currentScopeRef.current.environmentId === submittedEnvironmentId
        ) {
          setUpdatingTokenId(null);
        }
      }
      return;
    }

    tokenLoadRequestRef.current += 1;
    setIsCreatingToken(true);
    setTokenError(null);
    try {
      const { token } = await client.createSourceMapUploadToken({
        projectId: submittedProjectId,
        environmentId: submittedEnvironmentId,
        name
      });
      if (
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setCreatedTokenSecret(token.secret);
      const tokenForList = sourceMapUploadTokenWithoutSecret(token);
      setTokens((current) => [tokenForList, ...current.filter((item) => item.id !== token.id)]);
      setTokensState("ready");
      setTokenName("");
    } catch {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setTokenError("Could not create source map upload token");
      }
    } finally {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setIsCreatingToken(false);
      }
    }
  }

  async function revokeUploadToken(token: SourceMapUploadToken) {
    if (!projectId || !environmentId || !canUseSourceMapTokens || token.revokedAt || revokingTokenId) return;
    const submittedProjectId = projectId;
    const submittedEnvironmentId = environmentId;

    setRevokingTokenId(token.id);
    setTokenError(null);
    try {
      await client.revokeSourceMapUploadToken(token.id, { projectId: submittedProjectId, environmentId: submittedEnvironmentId });
      if (
        currentScopeRef.current.projectId !== submittedProjectId ||
        currentScopeRef.current.environmentId !== submittedEnvironmentId
      ) {
        return;
      }
      setTokens((current) =>
        current.map((item) => (item.id === token.id ? { ...item, revokedAt: new Date().toISOString() } : item))
      );
    } catch {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setTokenError("Could not revoke source map upload token");
      }
    } finally {
      if (
        currentScopeRef.current.projectId === submittedProjectId &&
        currentScopeRef.current.environmentId === submittedEnvironmentId
      ) {
        setRevokingTokenId(null);
      }
    }
  }

  function editUploadToken(token: SourceMapUploadToken) {
    if (token.revokedAt) return;
    setCreatedTokenSecret(null);
    setTokenError(null);
    setEditingToken(token);
    setTokenName(token.name);
  }

  function cancelTokenEdit() {
    setEditingToken(null);
    setTokenName("");
  }

  function selectMapFile(event: ChangeEvent<HTMLInputElement>) {
    setMapFile(event.target.files?.[0] ?? null);
  }

  function selectBundleFile(event: ChangeEvent<HTMLInputElement>) {
    setBundleFile(event.target.files?.[0] ?? null);
  }

  if (!projectId || !environmentId) {
    return (
      <section className="artifacts-panel">
        <header className="artifacts-panel__header">
          <div>
            <h2>Artifacts</h2>
            <p className="muted-text">Select a project and environment in Setup to manage artifacts.</p>
          </div>
        </header>
      </section>
    );
  }

  return (
    <section className="artifacts-panel">
      <header className="artifacts-panel__header">
        <div>
          <h2>Artifacts</h2>
          <p className="muted-text">Upload and manage source maps for this environment.</p>
        </div>
      </header>

      {error ? (
        <div className="status-box unavailable" role="alert">
          <strong>{error}</strong>
          {canUseSourceMaps ? (
            <button onClick={() => void loadArtifacts()} type="button">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="artifact-upload-grid">
        <form aria-label="Upload source map" className="artifact-form" noValidate onSubmit={uploadMap}>
          <h3>Single map</h3>
          <label>
            Release
            <input aria-label="Single map release" onChange={(event) => setMapRelease(event.target.value)} required value={mapRelease} />
          </label>
          <label>
            Minified file
            <input onChange={(event) => setMinifiedFile(event.target.value)} required value={minifiedFile} />
          </label>
          <label>
            Source map file
            <input accept=".map,application/json" onChange={selectMapFile} ref={mapFileRef} required type="file" />
          </label>
          <button disabled={!canUploadMap} type="submit">
            Upload map
          </button>
        </form>

        <form aria-label="Upload source map bundle" className="artifact-form" noValidate onSubmit={uploadBundle}>
          <h3>Bundle</h3>
          <label>
            Release
            <input aria-label="Bundle release" onChange={(event) => setBundleRelease(event.target.value)} required value={bundleRelease} />
          </label>
          <label>
            Source map bundle
            <input accept=".zip,application/zip" onChange={selectBundleFile} ref={bundleFileRef} required type="file" />
          </label>
          <button disabled={!canUploadBundle} type="submit">
            Upload bundle
          </button>
        </form>
      </div>

      <div className="artifact-toolbar">
        <label>
          Filter by release
          <input
            onChange={(event) => setReleaseFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void loadArtifacts();
            }}
            value={releaseFilter}
          />
        </label>
        <button disabled={!canUseSourceMaps || isLoading} onClick={() => void loadArtifacts()} type="button">
          Apply
        </button>
      </div>

      {isLoading ? (
        <p className="muted-text" role="status">
          Loading source maps
        </p>
      ) : null}

      {visibleArtifacts.length === 0 && !isLoading ? <p className="muted-text">No source maps uploaded.</p> : null}

      {visibleArtifacts.length > 0 ? (
        <div aria-label="Source map artifacts" className="artifact-list">
          {visibleArtifacts.map((artifact) => (
            <article className="artifact-row" key={artifact.id}>
              <div className="artifact-meta">
                <strong>{artifact.minifiedFile}</strong>
                <span>{artifact.release}</span>
                <span>{artifact.originalFilename}</span>
              </div>
              <div className="artifact-meta artifact-meta--secondary">
                <span>{formatBytes(artifact.byteSize)}</span>
                <span>{formatTimestamp(artifact.createdAt)}</span>
              </div>
              <button
                aria-label={`Delete ${artifact.originalFilename}`}
                disabled={deletingArtifactId === artifact.id}
                onClick={() => void deleteArtifact(artifact)}
                type="button"
              >
                Delete
              </button>
            </article>
          ))}
        </div>
      ) : null}

      <section className="artifact-token-panel">
        <div className="panel-header">
          <h2>Upload tokens</h2>
        </div>
        <form aria-label="Create source map upload token" className="artifact-form" onSubmit={createUploadToken}>
          <label>
            Token name
            <input
              disabled={!canUseSourceMapTokens || tokensState === "unavailable" || isCreatingToken}
              onChange={(event) => setTokenName(event.target.value)}
              value={tokenName}
            />
          </label>
          <button disabled={!canCreateToken} type="submit">
            {editingToken ? "Save token" : "Create token"}
          </button>
          {editingToken ? (
            <button disabled={Boolean(updatingTokenId)} onClick={cancelTokenEdit} type="button">
              Cancel
            </button>
          ) : null}
        </form>
        {tokenError ? (
          <div className="status-box unavailable" role="alert">
            <strong>{tokenError}</strong>
          </div>
        ) : null}
        {createdTokenSecret ? (
          <div className="status-box success">
            <strong>Copy this source map token now.</strong>
            <code>{createdTokenSecret}</code>
          </div>
        ) : null}
        {tokensState === "loading" ? <p className="muted-text">Loading upload tokens</p> : null}
        {tokensState === "unavailable" ? (
          <div className="status-box unavailable" role="alert">
            <strong>Upload tokens unavailable</strong>
            <button disabled={!canUseSourceMapTokens} onClick={() => void loadTokens()} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {tokensState === "empty" ? <p className="muted-text">No upload tokens created.</p> : null}
        {tokens.length > 0 ? (
          <ul className="artifact-token-list">
            {tokens.map((token) => (
              <li className="artifact-token-list__item" key={token.id}>
                <div>
                  <strong>{token.name}</strong>
                  <p className="muted-text">{token.prefix}</p>
                </div>
                <span className={token.revokedAt ? "status-pill status-pill--neutral" : "status-pill status-pill--ok"}>
                  {token.revokedAt ? "Revoked" : "Active"}
                </span>
                <button
                  disabled={Boolean(token.revokedAt) || updatingTokenId === token.id}
                  onClick={() => editUploadToken(token)}
                  type="button"
                >
                  Edit {token.name}
                </button>
                <button
                  disabled={Boolean(token.revokedAt) || revokingTokenId === token.id}
                  onClick={() => void revokeUploadToken(token)}
                  type="button"
                >
                  Revoke {token.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
