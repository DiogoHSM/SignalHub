import { useState } from "react";
import { ConfirmButton, EmptyHint, Icon, SecretField } from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useReadTokens, type ReadTokenRowVM } from "./useReadTokens";

export function ReadTokensSection({ ctx }: { ctx: ScreenCtx }) {
  const rt = useReadTokens({
    client: ctx.client,
    ctx,
    projectId: ctx.project?.id,
    environmentId: ctx.environment?.id,
  });

  const [creatingToken, setCreatingToken] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  if (rt.status === "unavailable") {
    return (
      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Read tokens</h2>
        </div>
        <div className="sh-card__body">
          <EmptyHint icon="key" title="Read tokens unavailable" sub="This deployment does not expose the read-token admin API." />
        </div>
      </div>
    );
  }

  const vm = rt.data;

  async function submitNewToken() {
    const name = newTokenName.trim();
    if (!name) return;
    const ok = await rt.createToken(name);
    if (!ok) { ctx.pushToast("Could not create read token"); return; }
    setNewTokenName("");
    setCreatingToken(false);
  }
  async function submitRename(id: string) {
    const name = renameValue.trim();
    if (!name) { setRenamingId(null); return; }
    const ok = await rt.renameToken(id, name);
    if (!ok) ctx.pushToast("Could not rename read token");
    setRenamingId(null);
  }
  async function doRevoke(row: ReadTokenRowVM) {
    const ok = await rt.revokeToken(row.id);
    if (!ok) ctx.pushToast("Could not revoke read token");
  }

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Read tokens</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} type="button" aria-label="New token" onClick={() => setCreatingToken((v) => !v)}>
          <Icon name="plus" size={13} />New token
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
        <div className="sh-faint" style={{ fontSize: 11 }}>
          Read-only credentials scoped to this project and environment — for external tools that only need to query telemetry.
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
            <button className="sh-btn primary" type="button" disabled={rt.busy} onClick={() => void submitNewToken()}>Create</button>
          </div>
        ) : null}

        {rt.latestSecret ? (
          <div className="sh-stripe ok" style={{ display: "grid", gap: 6, padding: 12, borderRadius: 8 }}>
            <strong style={{ fontSize: 12.5 }}>Read token created — copy it now, it is shown once and cannot be recovered.</strong>
            <div className="sh-faint" style={{ fontSize: 11 }}>Read-only. Scoped to this project and environment only.</div>
            <SecretField value={rt.latestSecret} />
            <div>
              <button className="sh-btn" type="button" onClick={() => rt.clearSecret()}>Done</button>
            </div>
          </div>
        ) : null}

        <div className="sh-card flush">
          {!vm ? null : vm.tokens.length === 0 ? (
            <EmptyHint icon="key" title="No read tokens yet" sub="Create one to give an external tool read-only access to this project and environment." />
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
  );
}
