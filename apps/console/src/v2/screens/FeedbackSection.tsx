import { useEffect, useState } from "react";
import { EmptyHint, Icon } from "../../components/ui/v2";
import type { FeedbackStatus } from "../../api/types";
import type { ScreenCtx } from "./registry";
import { useFeedback, type FeedbackItemRowVM, type FeedbackSettingsDraft } from "./useFeedback";

export function FeedbackSection({ ctx }: { ctx: ScreenCtx }) {
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;
  const feedback = useFeedback({ client: ctx.client, projectId, environmentId });

  const [draft, setDraft] = useState<FeedbackSettingsDraft | null>(null);

  // Drop any in-flight edits when the project/environment scope changes.
  useEffect(() => {
    setDraft(null);
  }, [projectId, environmentId]);

  if (feedback.status === "unavailable") return null;

  if (feedback.status === "loading" && !feedback.data) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="sh-eyebrow">Feedback widget</div>
        <div className="sh-card">
          <div className="sh-card__body">
            <EmptyHint icon="mail" title="Loading feedback…" />
          </div>
        </div>
      </div>
    );
  }

  const vm = feedback.data;
  if (!vm) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div className="sh-eyebrow">Feedback widget</div>
        <div className="sh-card">
          <div className="sh-card__body">
            <EmptyHint icon="alert" title="Could not load feedback widget" sub="Try refreshing the page." />
          </div>
        </div>
      </div>
    );
  }

  const activeDraft = draft ?? vm.settings;

  async function submitSettings() {
    const ok = await feedback.saveSettings(activeDraft);
    if (!ok) ctx.pushToast("Could not save feedback widget settings");
    else setDraft(null);
  }

  async function changeStatus(row: FeedbackItemRowVM, next: FeedbackStatus) {
    if (next === row.status) return;
    const ok = await feedback.setStatus(row.id, next);
    if (!ok) ctx.pushToast("Could not update feedback status");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="sh-eyebrow">Feedback widget</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 16 }}>
        {/* Widget settings */}
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Widget settings</h2>
            <span className={`sh-tag ${vm.settings.enabled ? "ok" : ""}`}>{vm.settings.enabled ? "enabled" : "disabled"}</span>
          </div>
          <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
              <input
                type="checkbox"
                checked={activeDraft.enabled}
                onChange={(e) => setDraft({ ...activeDraft, enabled: e.target.checked })}
              />
              Enable widget for this environment
            </label>
            <input
              className="sh-input"
              aria-label="Button label"
              placeholder="Button label"
              value={activeDraft.buttonLabel}
              onChange={(e) => setDraft({ ...activeDraft, buttonLabel: e.target.value })}
            />
            <input
              className="sh-input"
              aria-label="Panel title"
              placeholder="Panel title"
              value={activeDraft.title}
              onChange={(e) => setDraft({ ...activeDraft, title: e.target.value })}
            />
            <textarea
              className="sh-input"
              aria-label="Prompt"
              placeholder="Prompt shown above the message field"
              value={activeDraft.prompt}
              onChange={(e) => setDraft({ ...activeDraft, prompt: e.target.value })}
            />
            <input
              className="sh-input"
              aria-label="Input placeholder"
              placeholder="Input placeholder"
              value={activeDraft.placeholder}
              onChange={(e) => setDraft({ ...activeDraft, placeholder: e.target.value })}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                aria-label="Accent color"
                type="color"
                value={activeDraft.accentColor}
                onChange={(e) => setDraft({ ...activeDraft, accentColor: e.target.value })}
              />
              <span className="sh-faint" style={{ fontSize: 11 }}>Accent color</span>
            </div>
            <textarea
              className="sh-input"
              aria-label="Privacy note"
              placeholder="Privacy note (optional)"
              value={activeDraft.privacyNote}
              onChange={(e) => setDraft({ ...activeDraft, privacyNote: e.target.value })}
            />
            <div className="sh-faint" style={{ fontSize: 11 }}>
              Screenshot capture stays disabled until masking and consent controls ship.
            </div>
            <button className="sh-btn primary" type="button" disabled={feedback.busy} onClick={() => void submitSettings()}>
              {feedback.busy ? "Saving" : "Save widget"}
            </button>
          </div>
        </div>

        {/* Recent feedback / triage */}
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Recent feedback</h2>
            <span className="sh-tag">{vm.itemCount}</span>
          </div>
          <div className="sh-card__body flush">
            {vm.items.length === 0 ? (
              <EmptyHint icon="mail" title="No feedback received yet" sub="Submissions from the browser widget will appear here." />
            ) : (
              vm.items.map((row) => (
                <div key={row.id} className="sh-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "start", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: 12.5 }}>{row.message}</strong>
                    <div className="sh-faint" style={{ fontSize: 10.5 }}>{row.pageLabel} · {row.submittedLabel}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <span className={`sh-tag ${row.status === "reviewed" ? "ok" : ""}`}>{row.status}</span>
                      {row.tenantId ? <span className="sh-tag">tenant {row.tenantId}</span> : null}
                      {row.userId ? <span className="sh-tag">user {row.userId}</span> : null}
                      {row.sessionId ? <span className="sh-tag">session {row.sessionId}</span> : null}
                      {row.traceId ? (
                        <button
                          className="sh-tag"
                          type="button"
                          title="Jump to Traces (scoped view lands with PER-434)"
                          onClick={() => ctx.navigate("traces")}
                        >
                          <Icon name="link" size={9} /> trace
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <button
                      className="sh-iconbtn-sm"
                      type="button"
                      title="Mark reviewed"
                      aria-label={`Mark reviewed: ${row.message}`}
                      disabled={feedback.busy || row.status === "reviewed"}
                      onClick={() => void changeStatus(row, "reviewed")}
                    >
                      <Icon name="check" size={12} />
                    </button>
                    <button
                      className="sh-iconbtn-sm"
                      type="button"
                      title="Archive"
                      aria-label={`Archive: ${row.message}`}
                      disabled={feedback.busy || row.status === "archived"}
                      onClick={() => void changeStatus(row, "archived")}
                    >
                      <Icon name="archive" size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
