import { useState } from "react";
import { ConfirmButton, EmptyHint, Icon, SecretField } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useArtifacts, type ArtifactRowVM, type TokenRowVM } from "./useArtifacts";

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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="sh-eyebrow">Source maps &amp; CI upload tokens</div>

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
                        <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>{row.prefix} · used {row.lastUsedLabel}</div>
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
