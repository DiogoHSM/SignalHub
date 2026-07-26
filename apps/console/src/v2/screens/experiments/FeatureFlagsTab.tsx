import { useEffect, useState } from "react";
import { ConfirmButton, EmptyHint, Icon, StatusDot } from "../../../components/ui/v2";
import type { ScreenCtx } from "../registry";
import type { CreateFlagForm, FlagRowVM, UseFeatureFlagsResult } from "./useFeatureFlags";
import type { FeatureFlagAudit, FeatureFlagEvaluation, FeatureFlagStatus } from "../../../api/types";

const ROW_GRID = "1.2fr 90px 90px 1fr 70px 1fr 90px";

const DEFAULT_FORM: CreateFlagForm = {
  key: "new_checkout",
  name: "New checkout",
  enabledUserId: "",
  rolloutPercentage: "0",
};

function CreateFlagCard({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (form: CreateFlagForm) => void;
}) {
  const [form, setForm] = useState<CreateFlagForm>(DEFAULT_FORM);

  function set<K extends keyof CreateFlagForm>(key: K, value: CreateFlagForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const valid = form.key.trim().length > 0 && form.name.trim().length > 0;

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">New feature flag</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Flag key</span>
          <input className="sh-input sh-mono" value={form.key} onChange={(e) => set("key", e.target.value)} />
          <span className="sh-faint">Stable key used in SDK evaluation.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Flag name</span>
          <input className="sh-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <span className="sh-faint">Operator-facing label for this control.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Optional enabled user</span>
          <input className="sh-input sh-mono" value={form.enabledUserId} onChange={(e) => set("enabledUserId", e.target.value)} />
          <span className="sh-faint">When filled, this user receives the on variant.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Rollout percentage</span>
          <input
            className="sh-input sh-mono"
            type="number"
            min={0}
            max={100}
            value={form.rolloutPercentage}
            onChange={(e) => set("rolloutPercentage", e.target.value)}
          />
          <span className="sh-faint">Gradually enables the on variant for this percent of users.</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sh-btn primary" disabled={!valid || busy} onClick={() => onCreate(form)}>
            Create flag
          </button>
        </div>
      </div>
    </div>
  );
}

function EvaluatePanel({
  flag,
  busy,
  onEvaluate,
}: {
  flag: FlagRowVM;
  busy: boolean;
  onEvaluate: (subject: { userId?: string; tenantId?: string; sessionId?: string }, fallbackVariant?: string) => void;
}) {
  const [userId, setUserId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [fallbackVariant, setFallbackVariant] = useState("");

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">Evaluate</h2>
        <span className="sh-faint sh-mono" style={{ fontSize: 11 }}>{flag.key}</span>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 10, padding: 16 }}>
        <p className="sh-faint" style={{ fontSize: 11.5, margin: 0 }}>
          Dry-run this flag's rules for a subject without publishing anything.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">User id</span>
            <input className="sh-input sh-mono" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Tenant id</span>
            <input className="sh-input sh-mono" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span className="sh-eyebrow">Session id</span>
            <input className="sh-input sh-mono" value={sessionId} onChange={(e) => setSessionId(e.target.value)} />
          </label>
        </div>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Fallback variant (optional)</span>
          <input className="sh-input sh-mono" value={fallbackVariant} onChange={(e) => setFallbackVariant(e.target.value)} />
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="sh-btn primary"
            disabled={busy}
            onClick={() =>
              onEvaluate(
                {
                  userId: userId.trim() || undefined,
                  tenantId: tenantId.trim() || undefined,
                  sessionId: sessionId.trim() || undefined,
                },
                fallbackVariant.trim() || undefined,
              )
            }
          >
            Evaluate
          </button>
        </div>
      </div>
    </div>
  );
}

function EvaluationResult({ evaluation }: { evaluation: FeatureFlagEvaluation }) {
  return (
    <div className="sh-row" style={{ gridTemplateColumns: "24px 1fr 1fr 1fr 1fr" }}>
      <StatusDot status={evaluation.matched ? "ok" : "warning"} />
      <span className="sh-mono">{evaluation.variant}</span>
      <span className="sh-mono">{JSON.stringify(evaluation.value)}</span>
      <span className="sh-tag">{evaluation.reason}</span>
      <span className="sh-faint sh-mono">{evaluation.ruleId ?? "—"}</span>
    </div>
  );
}

function AuditPanel({ audit, loading }: { audit: FeatureFlagAudit[] | null; loading: boolean }) {
  if (loading) return <p className="sh-faint" style={{ fontSize: 11.5 }}>Loading audit…</p>;
  if (!audit) return null;
  if (audit.length === 0) return <p className="sh-faint" style={{ fontSize: 11.5 }}>No audit entries yet.</p>;
  return (
    <div>
      {audit.map((a) => (
        <div key={a.id} className="sh-row" style={{ gridTemplateColumns: "90px 1fr 1fr" }}>
          <span className="sh-tag">{a.action}</span>
          <span className="sh-faint sh-mono">{a.actorId ?? "system"}</span>
          <span className="sh-faint sh-mono">{new Date(a.createdAt).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function FeatureFlagsTab({ ctx, flags }: { ctx: ScreenCtx; flags: UseFeatureFlagsResult }) {
  const { data, status, busy, createFlag, updateFlagStatus, archiveFlag, evaluateFlag, loadAudit } = flags;
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [evaluation, setEvaluation] = useState<FeatureFlagEvaluation | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<FeatureFlagAudit[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (!data.rows.some((r) => r.id === selectedId)) {
      setSelectedId(data.rows[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    setEvaluation(null);
    setAudit(null);
    setAuditOpen(false);
  }, [selectedId]);

  if (status === "loading" && !data) {
    return <EmptyHint icon="flag" title="Loading feature flags…" sub="Fetching flags for this environment." />;
  }

  if (status === "error" || !data) {
    return (
      <EmptyHint
        icon="flag"
        title="Feature flags unavailable"
        sub="This installation may not support feature flags, or the request failed."
      />
    );
  }

  async function handleCreate(form: CreateFlagForm) {
    const ok = await createFlag(form);
    if (ok) {
      setShowCreate(false);
      ctx.pushToast("Flag created");
    } else {
      ctx.pushToast("Failed to create flag");
    }
  }

  async function handleToggle(row: FlagRowVM) {
    const next: FeatureFlagStatus = row.status === "active" ? "paused" : "active";
    const ok = await updateFlagStatus(row.id, next);
    if (!ok) ctx.pushToast("Failed to update flag");
  }

  async function handleArchive(id: string) {
    const ok = await archiveFlag(id);
    if (!ok) ctx.pushToast("Failed to archive flag");
  }

  async function handleEvaluate(subject: { userId?: string; tenantId?: string; sessionId?: string }, fallbackVariant?: string) {
    if (!selectedId) return;
    const result = await evaluateFlag(selectedId, { subject, fallbackVariant });
    setEvaluation(result);
    if (!result) ctx.pushToast("Evaluation failed");
  }

  async function handleToggleAudit() {
    if (auditOpen) {
      setAuditOpen(false);
      return;
    }
    setAuditOpen(true);
    if (!selectedId) return;
    setAuditLoading(true);
    const rows = await loadAudit(selectedId);
    setAudit(rows);
    setAuditLoading(false);
  }

  const selectedRow = data.rows.find((r) => r.id === selectedId);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="sh-btn primary" disabled={busy} onClick={() => setShowCreate((v) => !v)}>
          <Icon name="plus" size={13} />
          New flag
        </button>
      </div>

      {showCreate ? <CreateFlagCard busy={busy} onCancel={() => setShowCreate(false)} onCreate={handleCreate} /> : null}

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Feature flags</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>{data.rows.length} defined</span>
        </div>
        <div className="sh-card__body flush">
          {data.rows.length === 0 ? (
            <EmptyHint icon="flag" title="No feature flags yet" sub="Create one with an off fallback before wiring the SDK." />
          ) : (
            <>
              <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_GRID }}>
                <span>Flag</span>
                <span>Status</span>
                <span>Default</span>
                <span>Variants</span>
                <span>Rules</span>
                <span>Rollout</span>
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
                    <strong style={{ fontSize: 12.5 }}>{row.key}</strong>
                    <div className="sh-faint" style={{ fontSize: 11 }}>{row.name}</div>
                  </div>
                  <span className="sh-tag">{row.status}</span>
                  <span className="sh-mono" style={{ fontSize: 11.5 }}>{row.defaultVariant}</span>
                  <span className="sh-mono" style={{ fontSize: 11.5 }}>{row.variantsLabel}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.rulesCount}</span>
                  <span className="sh-faint sh-mono" style={{ fontSize: 11.5 }}>{row.rolloutLabel}</span>
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

      {selectedRow ? (
        <>
          <EvaluatePanel flag={selectedRow} busy={busy} onEvaluate={handleEvaluate} />
          {evaluation ? (
            <div className="sh-card">
              <div className="sh-card__head"><h2 className="sh-h2">Evaluation result</h2></div>
              <div className="sh-card__body">
                <EvaluationResult evaluation={evaluation} />
              </div>
            </div>
          ) : null}

          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Audit</h2>
              <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={handleToggleAudit}>
                {auditOpen ? "Hide" : "Show"}
              </button>
            </div>
            {auditOpen ? (
              <div className="sh-card__body">
                <AuditPanel audit={audit} loading={auditLoading} />
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
