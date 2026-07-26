import { useEffect, useState } from "react";
import { Bars, ConfirmButton, EmptyHint, Icon, Sparkline, SummaryStat } from "../../../components/ui/v2";
import type { ScreenCtx } from "../registry";
import { useSurveys } from "./useSurveys";
import type { CreateSurveyForm, SurveyRowVM } from "./useSurveys";
import type { SurveyStatus } from "../../../api/types";

const ROW_GRID = "1.2fr 90px 90px 1fr 90px";

const DEFAULT_FORM: CreateSurveyForm = {
  key: "activation_pulse",
  name: "Activation pulse",
  question: "How satisfied are you with this workflow?",
  triggerEvent: "",
  targetTenantId: "",
};

function CreateSurveyCard({
  busy,
  onCancel,
  onCreate,
  onCreateNps,
}: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (form: CreateSurveyForm) => void;
  onCreateNps: (form: CreateSurveyForm) => void;
}) {
  const [form, setForm] = useState<CreateSurveyForm>(DEFAULT_FORM);

  function set<K extends keyof CreateSurveyForm>(key: K, value: CreateSurveyForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const valid = form.key.trim().length > 0 && form.name.trim().length > 0 && form.question.trim().length > 0;

  return (
    <div className="sh-card">
      <div className="sh-card__head">
        <h2 className="sh-h2">New survey</h2>
        <button className="sh-btn ghost" style={{ padding: "4px 8px" }} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 12, padding: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Survey key</span>
          <input className="sh-input sh-mono" value={form.key} onChange={(e) => set("key", e.target.value)} />
          <span className="sh-faint">Stable key used by the SDK or widget placement.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Survey name</span>
          <input className="sh-input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          <span className="sh-faint">Operator-facing label for this prompt.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Rating question</span>
          <input className="sh-input" value={form.question} onChange={(e) => set("question", e.target.value)} />
          <span className="sh-faint">Shown as a 1-5 rating question in the first widget version.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Trigger event</span>
          <input className="sh-input sh-mono" value={form.triggerEvent} onChange={(e) => set("triggerEvent", e.target.value)} />
          <span className="sh-faint">Optional event name that should make the survey eligible.</span>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="sh-eyebrow">Target tenant</span>
          <input className="sh-input sh-mono" value={form.targetTenantId} onChange={(e) => set("targetTenantId", e.target.value)} />
          <span className="sh-faint">Optional tenant id for a narrow rollout.</span>
        </label>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="sh-btn" disabled={!valid || busy} onClick={() => onCreateNps(form)}>
            Create NPS campaign
          </button>
          <button className="sh-btn primary" disabled={!valid || busy} onClick={() => onCreate(form)}>
            Create survey
          </button>
        </div>
      </div>
    </div>
  );
}

export function SurveysTab({ ctx, enabled }: { ctx: ScreenCtx; enabled: boolean }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [showCreate, setShowCreate] = useState(false);

  const { data, status, busy, createSurvey, createNpsSurvey, updateSurveyStatus, archiveSurvey } = useSurveys({
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
    return <EmptyHint icon="flag" title="Loading surveys…" sub="Fetching surveys for this environment." />;
  }

  if (status === "error" || !data) {
    return (
      <EmptyHint
        icon="flag"
        title="Surveys unavailable"
        sub="This installation may not support in-app surveys, or the request failed."
      />
    );
  }

  async function handleCreate(form: CreateSurveyForm) {
    const ok = await createSurvey(form);
    if (ok) {
      setShowCreate(false);
      ctx.pushToast("Survey created");
    } else {
      ctx.pushToast("Failed to create survey");
    }
  }

  async function handleCreateNps(form: CreateSurveyForm) {
    const ok = await createNpsSurvey(form);
    if (ok) {
      setShowCreate(false);
      ctx.pushToast("NPS campaign created");
    } else {
      ctx.pushToast("Failed to create NPS campaign");
    }
  }

  async function handleToggle(row: SurveyRowVM) {
    const next: SurveyStatus = row.status === "active" ? "paused" : "active";
    const ok = await updateSurveyStatus(row.id, next);
    if (!ok) ctx.pushToast("Failed to update survey");
  }

  async function handleArchive(id: string) {
    const ok = await archiveSurvey(id);
    if (!ok) ctx.pushToast("Failed to archive survey");
  }

  const selectedRow = data.rows.find((r) => r.id === selectedId);
  const selected = data.selected;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="sh-btn primary" disabled={busy} onClick={() => setShowCreate((v) => !v)}>
          <Icon name="plus" size={13} />
          New survey
        </button>
      </div>

      {showCreate ? (
        <CreateSurveyCard busy={busy} onCancel={() => setShowCreate(false)} onCreate={handleCreate} onCreateNps={handleCreateNps} />
      ) : null}

      <div className="sh-card">
        <div className="sh-card__head">
          <h2 className="sh-h2">Surveys</h2>
          <span className="sh-faint" style={{ fontSize: 11 }}>{data.rows.length} definitions</span>
        </div>
        <div className="sh-card__body flush">
          {data.rows.length === 0 ? (
            <EmptyHint icon="flag" title="No surveys yet" sub="Create one above, then submit responses through the SDK." />
          ) : (
            <>
              <div className="sh-row sh-row__head" style={{ gridTemplateColumns: ROW_GRID }}>
                <span>Survey</span>
                <span>Status</span>
                <span>Kind</span>
                <span>Trigger</span>
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
                  <span className="sh-tag">{row.isNps ? "NPS" : "rating"}</span>
                  <span className="sh-faint sh-mono" style={{ fontSize: 11.5 }}>{row.triggerEvent}</span>
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
          <h2 className="sh-h2">Response report</h2>
        </div>
        <div className="sh-card__body">
          {!selectedRow ? (
            <EmptyHint icon="flag" title="Select a survey" sub="Pick a survey above to inspect response quality and recent answers." />
          ) : !selected ? (
            <EmptyHint icon="activity" title="No report yet" sub="This survey has no recorded responses in the last 30 days." />
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 16 }}>
                <SummaryStat label="Responses" value={selected.totals.responses} />
                <SummaryStat label="Users" value={selected.totals.users} />
                <SummaryStat label="Tenants" value={selected.totals.tenants} />
              </div>

              {selected.isNps ? (
                selected.nps ? (
                  <div className="sh-card" style={{ marginBottom: 16 }}>
                    <div className="sh-card__head"><h2 className="sh-h2">NPS report</h2></div>
                    <div className="sh-card__body">
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 12 }}>
                        <SummaryStat label="NPS score" value={selected.nps.scoreLabel} />
                        <SummaryStat label="Promoters" value={selected.nps.promoters} />
                        <SummaryStat label="Passives" value={selected.nps.passives} />
                        <SummaryStat label="Detractors" value={selected.nps.detractors} />
                        <SummaryStat label="Average" value={selected.nps.averageLabel} />
                      </div>
                      {selected.nps.trend.length > 0 ? (
                        <Sparkline data={selected.nps.trend.map((t) => t.responses)} />
                      ) : null}
                      {selected.nps.segments.length > 0 ? (
                        <div style={{ marginTop: 12 }}>
                          <Bars data={selected.nps.segments.map((s) => s.responses)} />
                        </div>
                      ) : null}
                      {selected.nps.segments.map((s) => (
                        <div key={s.label} className="sh-row" style={{ gridTemplateColumns: "1.2fr 90px 90px 90px 90px" }}>
                          <span>{s.label}</span>
                          <span>{s.responses}</span>
                          <span className="sh-mono">{s.scoreLabel}</span>
                          <span>{s.promoters}</span>
                          <span>{s.detractors}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyHint
                    icon="alert"
                    title="No NPS data yet"
                    sub="This survey looks like an NPS campaign, but no results came back for this window."
                  />
                )
              ) : null}

              {selected.questions.length > 0 ? (
                <div style={{ marginBottom: 16 }}>
                  <div className="sh-row sh-row__head" style={{ gridTemplateColumns: "1.4fr 90px 90px 1fr" }}>
                    <span>Question</span>
                    <span>Type</span>
                    <span>Responses</span>
                    <span>Average / choices</span>
                  </div>
                  {selected.questions.map((q) => (
                    <div key={q.id} className="sh-row" style={{ gridTemplateColumns: "1.4fr 90px 90px 1fr" }}>
                      <span>{q.label}</span>
                      <span className="sh-faint">{q.type}</span>
                      <span>{q.responses}</span>
                      <span className="sh-mono">{q.averageOrChoicesLabel}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {selected.recentResponses.length === 0 ? (
                <p className="sh-faint" style={{ fontSize: 12 }}>No responses in this window yet.</p>
              ) : (
                <div>
                  <div className="sh-row sh-row__head" style={{ gridTemplateColumns: "1fr 1fr 1fr 1.4fr" }}>
                    <span>Submitted</span>
                    <span>Actor</span>
                    <span>Tenant</span>
                    <span>Answers</span>
                  </div>
                  {selected.recentResponses.map((r) => (
                    <div key={r.id} className="sh-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1.4fr" }}>
                      <span className="sh-faint sh-mono">{r.submittedAtLabel}</span>
                      <span>{r.actorLabel}</span>
                      <span className="sh-faint">{r.tenantLabel}</span>
                      <span className="sh-mono">{r.answersPreview}</span>
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
