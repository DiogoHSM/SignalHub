import { useEffect, useRef, useState, type FormEvent } from "react";
import { ConfirmButton, EmptyHint, Icon, SecretField } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useArtifacts, validateSourceMapUploadFile, type ArtifactRowVM, type TokenRowVM } from "./useArtifacts";

export function ArtifactsSection({ ctx }: { ctx: ScreenCtx }) {
  const art = useArtifacts({
    client: ctx.client,
    projectId: ctx.project?.id,
    environmentId: ctx.environment?.id,
  });

  const [filterText, setFilterText] = useState("");
  const [creatingToken, setCreatingToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mapRelease, setMapRelease] = useState("");
  const [minifiedFile, setMinifiedFile] = useState("");
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [bundleRelease, setBundleRelease] = useState("");
  const [bundleFile, setBundleFile] = useState<File | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<"map" | "bundle" | null>(null);
  const mapFileRef = useRef<HTMLInputElement | null>(null);
  const bundleFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMapRelease("");
    setMinifiedFile("");
    setMapFile(null);
    setMapError(null);
    setBundleRelease("");
    setBundleFile(null);
    setBundleError(null);
    setUploading(null);
    if (mapFileRef.current) mapFileRef.current.value = "";
    if (bundleFileRef.current) bundleFileRef.current.value = "";
  }, [ctx.project?.id, ctx.environment?.id]);

  if (art.status === "unavailable") {
    return (
      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Source maps &amp; CI upload tokens</h2>
        </div>
        <div className="sh-card__body">
          <EmptyHint icon="file" title="Artifacts API unavailable" sub="This deployment does not expose the source-map admin API." />
        </div>
      </div>
    );
  }

  const vm = art.data;

  async function submitNewToken() {
    const name = newTokenName.trim();
    if (!name) return;
    const ok = await art.createToken(name);
    if (!ok) { ctx.pushToast("Could not create upload token"); return; }
    setNewTokenName("");
    setCreatingToken(false);
  }
  async function submitRename(id: string) {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    const ok = await art.renameToken(id, name);
    if (!ok) ctx.pushToast("Could not rename upload token");
    setRenamingId(null);
  }
  async function doDelete(row: ArtifactRowVM) {
    const ok = await art.deleteArtifact(row.id);
    if (!ok) ctx.pushToast("Could not delete source map");
  }
  async function doRevoke(row: TokenRowVM) {
    const ok = await art.revokeToken(row.id);
    if (!ok) ctx.pushToast("Could not revoke upload token");
  }

  async function submitMap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const release = mapRelease.trim();
    const minified = minifiedFile.trim();
    if (!release || !minified || !mapFile) {
      setMapError("Release, minified file path, and source map file are required.");
      return;
    }
    const validationError = validateSourceMapUploadFile(mapFile, "map");
    if (validationError) {
      setMapError(validationError);
      return;
    }
    setMapError(null);
    setUploading("map");
    const result = await art.uploadMap({ release, minifiedFile: minified, file: mapFile });
    if (!result.ok) {
      if (result.reason !== "error") return;
      setUploading(null);
      setMapError(result.error.message);
      return;
    }
    setUploading(null);
    setMapRelease("");
    setMinifiedFile("");
    setMapFile(null);
    if (mapFileRef.current) mapFileRef.current.value = "";
    ctx.pushToast("Source map uploaded");
  }

  async function submitBundle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const release = bundleRelease.trim();
    if (!release || !bundleFile) {
      setBundleError("Release and source map bundle are required.");
      return;
    }
    const validationError = validateSourceMapUploadFile(bundleFile, "bundle");
    if (validationError) {
      setBundleError(validationError);
      return;
    }
    setBundleError(null);
    setUploading("bundle");
    const result = await art.uploadBundle({ release, bundle: bundleFile });
    if (!result.ok) {
      if (result.reason !== "error") return;
      setUploading(null);
      setBundleError(
        result.error.kind === "unknown"
          ? "Could not upload source map bundle. Check the ZIP file and try again."
          : result.error.message,
      );
      return;
    }
    setUploading(null);
    setBundleRelease("");
    setBundleFile(null);
    if (bundleFileRef.current) bundleFileRef.current.value = "";
    ctx.pushToast("Source map bundle uploaded");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="sh-eyebrow">Source maps &amp; CI upload tokens</div>

      <section className="sh-card" aria-labelledby="manual-source-map-upload-title">
        <div className="sh-card__head">
          <div>
            <h2 className="sh-h2" id="manual-source-map-upload-title">Manual upload</h2>
            <div className="sh-faint" style={{ fontSize: 11, marginTop: 3 }}>Upload one map for a known asset, or a ZIP bundle produced by your build.</div>
          </div>
        </div>
        <div className="sh-card__body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 20 }}>
          <form aria-label="Upload source map" noValidate onSubmit={(event) => void submitMap(event)} style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <div>
              <strong style={{ fontSize: 12.5 }}>Single source map</strong>
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 3 }}>Use the exact release and minified asset path emitted by telemetry.</div>
            </div>
            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <span>Release</span>
              <input className="sh-input" value={mapRelease} onChange={(event) => setMapRelease(event.target.value)} placeholder="2026.07.29 or commit SHA" />
            </label>
            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <span>Minified file path</span>
              <input className="sh-input" value={minifiedFile} onChange={(event) => setMinifiedFile(event.target.value)} placeholder="assets/app.min.js" />
            </label>
            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <span>Source map file</span>
              <input ref={mapFileRef} className="sh-input" type="file" accept=".map,application/json" onChange={(event) => { setMapFile(event.target.files?.[0] ?? null); setMapError(null); }} />
            </label>
            {mapError ? <div className="sh-stripe bad" role="alert" style={{ padding: 10 }}>{mapError}</div> : null}
            <button className="sh-btn primary" type="submit" disabled={art.busy || !art.canUploadMap}>
              {uploading === "map" ? "Uploading map…" : "Upload map"}
            </button>
            {!art.canUploadMap ? <div className="sh-faint" style={{ fontSize: 11 }}>Single-file upload is unavailable in this deployment.</div> : null}
          </form>

          <form aria-label="Upload source map bundle" noValidate onSubmit={(event) => void submitBundle(event)} style={{ display: "grid", gap: 10, alignContent: "start" }}>
            <div>
              <strong style={{ fontSize: 12.5 }}>ZIP bundle</strong>
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 3 }}>Best for builds with multiple chunks and maps.</div>
            </div>
            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <span>Bundle release</span>
              <input className="sh-input" value={bundleRelease} onChange={(event) => setBundleRelease(event.target.value)} placeholder="2026.07.29 or commit SHA" />
            </label>
            <label style={{ display: "grid", gap: 5, fontSize: 11.5 }}>
              <span>Source map bundle</span>
              <input ref={bundleFileRef} className="sh-input" type="file" accept=".zip,application/zip" onChange={(event) => { setBundleFile(event.target.files?.[0] ?? null); setBundleError(null); }} />
            </label>
            {bundleError ? <div className="sh-stripe bad" role="alert" style={{ padding: 10 }}>{bundleError}</div> : null}
            <button className="sh-btn primary" type="submit" disabled={art.busy || !art.canUploadBundle}>
              {uploading === "bundle" ? "Uploading bundle…" : "Upload bundle"}
            </button>
            {!art.canUploadBundle ? <div className="sh-faint" style={{ fontSize: 11 }}>Bundle upload is unavailable in this deployment.</div> : null}
          </form>
        </div>
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Source-map artifacts */}
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Source map artifacts</h2>
            {vm ? <span className="sh-tag">{vm.artifactCount}</span> : null}
          </div>
          <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="sh-input"
                aria-label="Filter by release"
                placeholder="Filter by release"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") art.applyFilter(filterText); }}
              />
              <button className="sh-btn" type="button" disabled={art.busy} onClick={() => art.applyFilter(filterText)}>Apply</button>
            </div>
            <div className="sh-card flush">
              {!vm || !vm.artifactsAvailable ? (
                <EmptyHint icon="file" title="Source maps unavailable" sub="This deployment does not expose the source-map artifacts API." />
              ) : vm.artifacts.length === 0 ? (
                <EmptyHint icon="file" title="No source maps uploaded yet" sub="Maps are uploaded by CI via pnpm source-maps:upload." />
              ) : (
                vm.artifacts.map((row) => (
                  <div key={row.id} className="sh-row" style={{ gridTemplateColumns: "1fr auto auto auto auto" }}>
                    <div>
                      <strong className="sh-mono" style={{ fontSize: 12.5 }}>{row.minifiedFile}</strong>
                      <div className="sh-faint" style={{ fontSize: 10.5 }}>{row.originalFilename}</div>
                    </div>
                    <span className="sh-tag">{row.release}</span>
                    <span className="sh-faint" style={{ fontSize: 11 }}>{row.byteSizeLabel}</span>
                    <span className="sh-faint" style={{ fontSize: 11 }}>{row.createdLabel}</span>
                    <ConfirmButton label={`Delete ${row.originalFilename}`} confirmLabel="Confirm delete" icon="x" kind="ghost" onConfirm={() => void doDelete(row)} />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* CI upload tokens */}
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">CI upload tokens</h2>
            <button className="sh-btn ghost" style={{ padding: "4px 8px" }} type="button" aria-label="New token" onClick={() => setCreatingToken((v) => !v)}>
              <Icon name="plus" size={13} />New token
            </button>
          </div>
          <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
            <div className="sh-faint" style={{ fontSize: 11 }}>
              CI-only secrets for <code style={{ color: "var(--fg)" }}>pnpm source-maps:upload</code> — separate from your SDK ingestion key.
            </div>

            {creatingToken ? (
              <div className="sh-row" style={{ gridTemplateColumns: "1fr auto" }}>
                <input
                  autoFocus
                  className="sh-input"
                  aria-label="New token name"
                  placeholder="Token name"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void submitNewToken(); if (e.key === "Escape") setCreatingToken(false); }}
                />
                <button className="sh-btn primary" type="button" disabled={art.busy} onClick={() => void submitNewToken()}>Create</button>
              </div>
            ) : null}

            {art.latestSecret ? (
              <div className="sh-stripe ok" style={{ display: "grid", gap: 6, padding: 12, borderRadius: 8 }}>
                <strong style={{ fontSize: 12.5 }}>Token "{art.latestSecret.name}" created — copy it now, it is shown only once.</strong>
                <SecretField value={art.latestSecret.secret} />
              </div>
            ) : null}

            <div className="sh-card flush">
              {!vm || !vm.tokensAvailable ? (
                <EmptyHint icon="key" title="Upload tokens unavailable" sub="This deployment does not expose the upload-token API." />
              ) : vm.tokens.length === 0 ? (
                <EmptyHint icon="key" title="No upload tokens yet" sub="Create one to authenticate CI source-map uploads." />
              ) : (
                vm.tokens.map((row) => (
                  <div key={row.id} className="sh-row" style={{ gridTemplateColumns: "1fr auto auto auto", opacity: row.revoked ? 0.55 : 1 }}>
                    {renamingId === row.id ? (
                      <input
                        autoFocus
                        className="sh-input"
                        aria-label="Rename token"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") void submitRename(row.id); if (e.key === "Escape") setRenamingId(null); }}
                        onBlur={() => setRenamingId(null)}
                      />
                    ) : (
                      <div>
                        <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
                        <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>{row.prefix} · created {row.createdLabel} · used {row.lastUsedLabel}</div>
                      </div>
                    )}
                    <span className={`sh-tag ${row.revoked ? "" : "ok"}`}>{row.statusLabel}</span>
                    {row.revoked ? (
                      <span />
                    ) : (
                      <button className="sh-iconbtn-sm" type="button" title="Rename" aria-label={`Rename ${row.name}`} onClick={() => { setRenamingId(row.id); setRenameValue(row.name); }}>
                        <Icon name="edit" size={12} />
                      </button>
                    )}
                    {row.revoked ? (
                      <span />
                    ) : (
                      <ConfirmButton label={`Revoke ${row.name}`} confirmLabel="Confirm revoke" icon="x" kind="ghost" onConfirm={() => void doRevoke(row)} />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
