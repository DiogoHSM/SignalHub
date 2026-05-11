import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from "react";
import type { ApiClient, SourceMapApiClient } from "../api/client";
import type { SourceMapArtifact } from "../api/types";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type SourceMapClient = ApiClient & SourceMapApiClient;

function hasSourceMapClient(client: ApiClient): client is SourceMapClient {
  return (
    typeof client.listSourceMapArtifacts === "function" &&
    typeof client.uploadSourceMap === "function" &&
    typeof client.uploadSourceMapBundle === "function" &&
    typeof client.deleteSourceMapArtifact === "function"
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

export function ArtifactsPanel({ client, projectId, environmentId }: Props) {
  const currentScopeRef = useRef({ projectId, environmentId });
  const mapFileRef = useRef<HTMLInputElement | null>(null);
  const bundleFileRef = useRef<HTMLInputElement | null>(null);
  const [artifacts, setArtifacts] = useState<SourceMapArtifact[]>([]);
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

  const canUseSourceMaps = hasSourceMapClient(client);
  const canUploadMap =
    canUseSourceMaps && Boolean(projectId && environmentId && mapRelease.trim() && minifiedFile.trim() && mapFile) && !isUploadingMap;
  const canUploadBundle =
    canUseSourceMaps && Boolean(projectId && environmentId && bundleRelease.trim() && bundleFile) && !isUploadingBundle;

  async function loadArtifacts(filter = releaseFilter) {
    if (!projectId || !environmentId || !canUseSourceMaps) return;
    const requestedProjectId = projectId;
    const requestedEnvironmentId = environmentId;
    const release = filter.trim();

    setIsLoading(true);
    setError(null);
    try {
      const result = await client.listSourceMapArtifacts({
        projectId: requestedProjectId,
        environmentId: requestedEnvironmentId,
        ...(release ? { release } : {})
      });
      if (
        currentScopeRef.current.projectId !== requestedProjectId ||
        currentScopeRef.current.environmentId !== requestedEnvironmentId
      ) {
        return;
      }
      setArtifacts(result);
    } catch {
      if (
        currentScopeRef.current.projectId !== requestedProjectId ||
        currentScopeRef.current.environmentId !== requestedEnvironmentId
      ) {
        return;
      }
      setArtifacts([]);
      setError("Source map artifacts unavailable");
    } finally {
      if (
        currentScopeRef.current.projectId === requestedProjectId &&
        currentScopeRef.current.environmentId === requestedEnvironmentId
      ) {
        setIsLoading(false);
      }
    }
  }

  useEffect(() => {
    setArtifacts([]);
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
      return;
    }

    if (!canUseSourceMaps) {
      setIsLoading(false);
      setError("Source map artifacts unavailable");
      return;
    }

    void loadArtifacts();
  }, [canUseSourceMaps, client, environmentId, projectId]);

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
            <input onChange={(event) => setMapRelease(event.target.value)} required value={mapRelease} />
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
            <input onChange={(event) => setBundleRelease(event.target.value)} required value={bundleRelease} />
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

      {artifacts.length === 0 && !isLoading ? <p className="muted-text">No source maps uploaded.</p> : null}

      {artifacts.length > 0 ? (
        <div aria-label="Source map artifacts" className="artifact-list">
          {artifacts.map((artifact) => (
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
                disabled={deletingArtifactId === artifact.id}
                onClick={() => void deleteArtifact(artifact)}
                type="button"
              >
                Delete {artifact.originalFilename}
              </button>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
