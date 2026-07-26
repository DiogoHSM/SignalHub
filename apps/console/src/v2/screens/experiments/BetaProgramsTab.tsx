import { useEffect, useState } from "react";
import { ConfirmButton, EmptyHint, Icon, SummaryStat } from "../../../components/ui/v2";
import type { ScreenCtx } from "../registry";
import { useBetaPrograms } from "./useBetaPrograms";
import type { BetaProgramRowVM, CreateBetaProgramForm } from "./useBetaPrograms";
import type { UseFeatureFlagsResult } from "./useFeatureFlags";
import type { BetaProgramStatus } from "../../../api/types";

const ROW_GRID = "1.2fr 90px 90px 1fr 90px";

const DEFAULT_FORM: CreateBetaProgramForm = {
  key: "checkout_beta",
  name: "Checkout beta",
  featureFlagId: "",
};

function CreateBetaProgramCard({
  busy,
  flags,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  flags: UseFeatureFlagsResult;
  onCancel: () => void;
  onCreate: (form: CreateBetaProgramForm) => void;
}) {
  const [form, setForm] = useState<CreateBetaProgramForm>(DEFAULT_FORM);

  function set<K extends keyof CreateBetaProgramForm>(key: K, value: CreateBetaProgramForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const valid = form.key.trim().length > 0 && form.name.trim().length > 0;
  const flagOptions = flags.data?.rows ?? [];

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">New beta program</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Program key</span>
          <input className="sh-input sh-mono" value={form.key} onChange={(e) => set("key", e.target.value)} />
          <span className="sh-faint">Stable id for this early-access group.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Program name</span>
          <input className="sh-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <span className="sh-faint">Operator-facing name.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Controlled flag</span>
          <select className="sh-select" value={form.featureFlagId} onChange={(e) => set("featureFlagId", e.target.value)}>
            <option value="">No linked flag</option>
            {flagOptions.map((f) => (
              <option key={f.id} value={f.id}>{f.key}</option>
            ))}
          </select>
          <span className="sh-faint">Optional flag that receives participant targeting rules.</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sh-btn primary" disabled={!valid || busy} onClick={() => onCreate(form)}>
            Create beta program
          </button>
        </div>
      </div>
    </div>
  );
}

export function BetaProgramsTab({
  ctx,
  flags,
  enabled,
}: {
  ctx: ScreenCtx;
  flags: UseFeatureFlagsResult;
  enabled: boolean;
}) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);
  const [participantId, setParticipantId] = useState("");

  const { data, status, busy, createProgram, updateProgramStatus, archiveProgram, addParticipant, removeParticipant } =
    useBetaPrograms({ client: ctx.client, projectId, environmentId, selectedId, enabled });

  useEffect(() => {
    if (!data) return;
    if (!data.rows.some((r) => r.id === selectedId)) {
      setSelectedId(data.rows[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (status === "loading" && !data) {
    return <EmptyHint icon="flag" title="Loading beta programs…" sub="Fetching beta programs for this environment." />;
  }

  if (status === "error" || !data) {
    return (
      <EmptyHint
        icon="flag"
        title="Beta programs unavailable"
        sub="This installation may not support beta programs, or the request failed."
      />
    );
  }

  async function handleCreate(form: CreateBetaProgramForm) {
    const ok = await createProgram(form);
    if (ok) {
      setShowCreate(false);
      ctx.pushToast("Beta program created");
    } else {
      ctx.pushToast("Failed to create beta program");
    }
  }

  async function handleToggle(row: BetaProgramRowVM) {
    const next: BetaProgramStatus = row.status === "active" ? "paused" : "active";
    const ok = await updateProgramStatus(row.id, next);
    if (!ok) ctx.pushToast("Failed to update beta program");
  }

  async function handleArchive(id: string) {
    const ok = await archiveProgram(id);
    if (!ok) ctx.pushToast("Failed to archive beta program");
  }

  async function handleAddParticipant() {
    const actorId = participantId.trim();
    if (!actorId) return;
    const ok = await addParticipant(actorId);
    if (ok) {
      setParticipantId("");
    } else {
      ctx.pushToast("Failed to add participant");
    }
  }

  async function handleRemoveParticipant(id: string) {
    const ok = await removeParticipant(id);
    if (!ok) ctx.pushToast("Failed to remove participant");
  }

  const selectedRow = data.rows.find((r) => r.id === selectedId);
  const selected = data.selected;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="sh-btn primary" disabled={busy} onClick={() => setShowCreate((v) => !v)}>
          <Icon name="plus" size={13} />
          New beta program
        </button>
      </div>

      {showCreate ? (
        <CreateBetaProgramCard busy={busy} flags={flags} onCancel={() => setShowCreate(false)} onCreate={handleCreate} />
      ) : null}

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Beta programs</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>{data.rows.length} programs</span>
        </div>
        <div className="sh-card__body flush">
          {data.rows.length === 0 ? (
            <EmptyHint icon="flag" title="No beta programs yet" sub="Create one and add users or tenants below." />
          ) : (
            <>
              <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_GRID }}>
                <span>Program</span>
                <span>Status</span>
                <span>Actor</span>
                <span>Linked flag</span>
                <span>Actions</span>
              </div>
              {data.rows.map((row) => (
                <div
                  key={row.id}
                  role="button"
                  tabIndex={0}
                  className={`sh-row sh-row--btn${row.id === selectedId ? " is-active" : ""}`}
                  style={{ gridTemplateColumns: ROW_GRID, width: "100%", textAlign: "left", cursor: "pointer" }}
                  onClick={() => setSelectedId(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(row.id);
                    }
                  }}
                >
                  <div>
                    <strong style={{ fontSize: 12.5 }}>{row.name}</strong>
                    <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>{row.key}</div>
                  </div>
                  <span className="sh-tag">{row.status}</span>
                  <span className="sh-faint">{row.actorType}</span>
                  <span className="sh-faint sh-mono" style={{ fontSize: 11.5 }}>{row.featureFlagId ?? "none"}</span>
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className="sh-iconbtn-sm"
                      title={row.status === "active" ? "Pause" : "Activate"}
                      disabled={busy}
                      onClick={() => handleToggle(row)}
                    >
                      <Icon name={row.status === "active" ? "clock" : "play"} size={13} />
                    </button>
                    <ConfirmButton
                      label={<Icon name="archive" size={13} />}
                      confirmLabel="Confirm"
                      onConfirm={() => handleArchive(row.id)}
                    />
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Participants</h2>
        </div>
        <div className="sh-card__body">
          {!selectedRow ? (
            <EmptyHint icon="flag" title="Select a beta program" sub="Pick a program above to manage participants and adoption." />
          ) : !selected ? (
            <EmptyHint icon="activity" title="No adoption data" sub="This program has no adoption data for this window yet." />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                <SummaryStat label="Participants" value={selected.participantsCount} />
                <SummaryStat label="Active" value={selected.activeParticipants} />
                <SummaryStat label="Adoption" value={selected.adoptionRateLabel} />
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <input
                  className="sh-input sh-mono"
                  placeholder="Participant id (user or tenant)"
                  value={participantId}
                  onChange={(e) => setParticipantId(e.target.value)}
                />
                <button className="sh-btn primary" disabled={busy || !participantId.trim()} onClick={handleAddParticipant}>
                  Add participant
                </button>
              </div>

              {selected.participants.length === 0 ? (
                <p className="sh-faint" style={{ fontSize: 12 }}>No participants yet.</p>
              ) : (
                <div>
                  <div className="sh-row sh-row__head" style={{ gridTemplateColumns: "1fr 90px 1fr 70px" }}>
                    <span>Actor</span>
                    <span>Status</span>
                    <span>Notes</span>
                    <span>Actions</span>
                  </div>
                  {selected.participants.map((p) => (
                    <div key={p.id} className="sh-row" style={{ gridTemplateColumns: "1fr 90px 1fr 70px" }}>
                      <span className="sh-mono">{p.actorId}</span>
                      <span className="sh-tag">{p.status}</span>
                      <span className="sh-faint">{p.notes}</span>
                      <ConfirmButton
                        label={<Icon name="x" size={12} />}
                        confirmLabel="Confirm"
                        onConfirm={() => handleRemoveParticipant(p.id)}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
