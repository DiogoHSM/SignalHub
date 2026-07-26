import { useEffect, useState } from "react";
import { ConfirmButton, EmptyHint, Icon, SummaryStat } from "../../../components/ui/v2";
import type { ScreenCtx } from "../registry";
import { parseVariants, useAbTests } from "./useAbTests";
import type { CreateExperimentForm, ExperimentRowVM } from "./useAbTests";
import type { ExperimentStatus } from "../../../api/types";

const ROW_GRID = "1.2fr 90px 1fr 1fr 90px";
const VARIANT_GRID = "1fr 80px 90px 90px 100px 90px 1.2fr";

const DEFAULT_FORM: CreateExperimentForm = {
  key: "checkout_copy",
  name: "Checkout copy",
  conversionEvent: "checkout.completed",
  variants: "control:50,treatment:50",
};

function CreateExperimentCard({
  busy,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (form: CreateExperimentForm) => void;
}) {
  const [form, setForm] = useState<CreateExperimentForm>(DEFAULT_FORM);

  function set<K extends keyof CreateExperimentForm>(key: K, value: CreateExperimentForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const valid =
    form.key.trim().length > 0 &&
    form.name.trim().length > 0 &&
    form.conversionEvent.trim().length > 0 &&
    parseVariants(form.variants).length >= 2;

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">New A/B test</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Experiment key</span>
          <input className="sh-input sh-mono" value={form.key} onChange={(e) => set("key", e.target.value)} />
          <span className="sh-faint">Stable key used by SDK assignment and event properties.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Name</span>
          <input className="sh-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <span className="sh-faint">Operator-facing title for this test.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Conversion event</span>
          <input className="sh-input sh-mono" value={form.conversionEvent} onChange={(e) => set("conversionEvent", e.target.value)} />
          <span className="sh-faint">Event counted as success after exposure.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Variants</span>
          <input className="sh-input sh-mono" value={form.variants} onChange={(e) => set("variants", e.target.value)} />
          <span className="sh-faint">Comma-separated key:weight pairs, for example control:50,treatment:50.</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button className="sh-btn primary" disabled={!valid || busy} onClick={() => onCreate(form)}>
            Create experiment
          </button>
        </div>
      </div>
    </div>
  );
}

export function AbTestsTab({ ctx, enabled }: { ctx: ScreenCtx; enabled: boolean }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const { data, status, busy, createExperiment, updateExperimentStatus, archiveExperiment } = useAbTests({
    client: ctx.client,
    projectId,
    environmentId,
    selectedId,
    enabled,
  });

  useEffect(() => {
    if (!data) return;
    if (!data.rows.some((r) => r.id === selectedId)) {
      setSelectedId(data.rows[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (status === "loading" && !data) {
    return <EmptyHint icon="flag" title="Loading A/B tests…" sub="Fetching experiments for this environment." />;
  }

  if (status === "error" || !data) {
    return (
      <EmptyHint
        icon="flag"
        title="A/B tests unavailable"
        sub="This installation may not support experiments, or the request failed."
      />
    );
  }

  async function handleCreate(form: CreateExperimentForm) {
    const ok = await createExperiment(form);
    if (ok) {
      setShowCreate(false);
      ctx.pushToast("Experiment created");
    } else {
      ctx.pushToast("Failed to create experiment");
    }
  }

  async function handleToggleStatus(row: ExperimentRowVM) {
    const next: ExperimentStatus = row.status === "running" ? "paused" : "running";
    const ok = await updateExperimentStatus(row.id, next);
    if (!ok) ctx.pushToast("Failed to update experiment");
  }

  async function handleArchive(id: string) {
    const ok = await archiveExperiment(id);
    if (!ok) ctx.pushToast("Failed to archive experiment");
  }

  const selectedRow = data.rows.find((r) => r.id === selectedId);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="sh-btn primary" disabled={busy} onClick={() => setShowCreate((v) => !v)}>
          <Icon name="plus" size={13} />
          New experiment
        </button>
      </div>

      {showCreate ? (
        <CreateExperimentCard busy={busy} onCancel={() => setShowCreate(false)} onCreate={handleCreate} />
      ) : null}

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Experiments</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>{data.rows.length} defined</span>
        </div>
        <div className="sh-card__body flush">
          {data.rows.length === 0 ? (
            <EmptyHint
              icon="flag"
              title="No experiments yet"
              sub="Create one above, then use the SDK assignment helper in your app."
            />
          ) : (
            <>
              <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_GRID }}>
                <span>Experiment</span>
                <span>Status</span>
                <span>Variants</span>
                <span>Conversion</span>
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
                  <span className="sh-mono" style={{ fontSize: 11.5 }}>{row.variantsLabel}</span>
                  <span className="sh-faint sh-mono" style={{ fontSize: 11.5 }}>{row.conversionEvent}</span>
                  <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                    <button
                      className="sh-iconbtn-sm"
                      title={row.status === "running" ? "Pause" : "Resume"}
                      disabled={busy}
                      onClick={() => handleToggleStatus(row)}
                    >
                      <Icon name={row.status === "running" ? "clock" : "play"} size={13} />
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
          <h2 className="sh-h2">A/B test readout</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>
            {data.selected ? `${data.selected.totals.exposures} exposures` : "No result loaded"}
          </span>
        </div>
        <div className="sh-card__body">
          {!selectedRow ? (
            <EmptyHint icon="flag" title="Select an experiment" sub="Pick an experiment above to inspect variant-level conversion." />
          ) : !data.selected ? (
            <EmptyHint icon="activity" title="No results yet" sub="This experiment has no recorded exposures in the last 30 days." />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                <SummaryStat label="Exposures" value={data.selected.totals.exposures} />
                <SummaryStat label="Conversions" value={data.selected.totals.conversions} />
                <SummaryStat label="Variants" value={data.selected.totals.variants} />
              </div>
              {data.selected.variants.length === 0 ? (
                <EmptyHint icon="activity" title="No variant data" sub="No exposures recorded for this window yet." />
              ) : (
                <>
                  <div className="sh-row sh-row__head" style={{ gridTemplateColumns: VARIANT_GRID }}>
                    <span>Variant</span>
                    <span>Weight</span>
                    <span>Exposures</span>
                    <span>Conversions</span>
                    <span>Conv. rate</span>
                    <span>Lift</span>
                    <span>Interpretation</span>
                  </div>
                  {data.selected.variants.map((v) => (
                    <div key={v.key} className="sh-row" style={{ gridTemplateColumns: VARIANT_GRID }}>
                      <span className="sh-mono">{v.key}</span>
                      <span>{v.weight}%</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{v.exposures}</span>
                      <span style={{ fontVariantNumeric: "tabular-nums" }}>{v.conversions}</span>
                      <span className="sh-mono">{v.conversionRateLabel}</span>
                      <span className="sh-mono">{v.liftLabel}</span>
                      <span className="sh-faint">{v.interpretationLabel}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
