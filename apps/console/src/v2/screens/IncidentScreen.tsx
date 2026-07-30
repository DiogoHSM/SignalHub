import { useState, type CSSProperties } from "react";
import type { NavSection } from "../nav";
import type { ScreenCtx } from "./registry";
import { useIncident } from "./useIncident";
import type { RelVM } from "./useIncident";
import {
  ConfirmButton,
  EmptyHint,
  Icon,
  PriorityPill,
  StatusPill,
} from "../../components/ui/v2";
import { IncidentReplayPanel } from "../../components/IncidentReplayPanel";
import { IncidentCodeContextPanel } from "../../components/IncidentCodeContextPanel";
import { runMutation } from "../lib/run-mutation";

// ---------------------------------------------------------------------------
// RelItem — local subcomponent
// ---------------------------------------------------------------------------

const REL_COLOR: Record<string, string> = {
  critical: "var(--sev-critical)",
  warn: "var(--sev-warning)",
  info: "var(--sev-info)",
  ok: "var(--accent)",
  violet: "var(--sev-violet)",
  neutral: "var(--fg-muted)",
};

const REL_BG: Record<string, string> = {
  critical: "var(--sev-critical-bg)",
  warn: "var(--sev-warning-bg)",
  info: "var(--sev-info-bg)",
  ok: "var(--accent-bg-subtle)",
  violet: "var(--sev-violet-bg)",
  neutral: "var(--bg-surface-2)",
};

const STATUS_OPTIONS: ("open" | "investigating" | "resolved" | "ignored")[] = [
  "open",
  "investigating",
  "resolved",
  "ignored",
];

const PRIORITY_OPTIONS: ("P1" | "P2" | "P3" | "P4")[] = ["P1", "P2", "P3", "P4"];

const SILENCE_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30m" },
  { minutes: 60, label: "1h" },
  { minutes: 240, label: "4h" },
  { minutes: 1440, label: "24h" },
];

const MENU_STYLE: CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  zIndex: 100,
  background: "var(--bg-surface)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 8,
  minWidth: 160,
  boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
  marginTop: 4,
};

const MENU_ITEM_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  textAlign: "left",
  padding: "8px 14px",
  background: "transparent",
  border: "none",
  borderBottom: "1px solid var(--border-subtle)",
  cursor: "pointer",
  fontSize: 12,
};

function sourceMapTone(status: string): "ok" | "warn" | "error" {
  if (status === "resolved") return "ok";
  if (status === "partially_resolved") return "warn";
  return "error";
}

function RelItem({
  rel,
  onClick,
}: {
  rel: RelVM;
  onClick?: () => void;
}) {
  const color = REL_COLOR[rel.tone] ?? "var(--fg-muted)";
  const bg = REL_BG[rel.tone] ?? "var(--bg-surface-2)";
  return (
    <button
      aria-label={rel.title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "11px 16px",
        borderBottom: "1px solid var(--border-subtle)",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottomColor: "var(--border-subtle)",
        borderBottomStyle: "solid",
        borderBottomWidth: 1,
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={onClick}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 7,
          display: "grid",
          placeItems: "center",
          color,
          background: bg,
          flex: "0 0 auto",
        }}
      >
        <Icon name={rel.icon as Parameters<typeof Icon>[0]["name"]} size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sh-mono" style={{ fontSize: 12 }}>
          {rel.title}
        </div>
        <div className="sh-faint" style={{ fontSize: 11, marginTop: 1 }}>
          {rel.sub}
        </div>
      </div>
      {onClick ? <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }} /> : null}
    </button>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        minWidth: 118,
        padding: "10px 12px",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
        background: "var(--bg-surface-2)",
      }}
    >
      <div className="sh-kpi__label">{label}</div>
      <div
        className="sh-kpi__value"
        style={{ color: "var(--sev-critical)", fontSize: 22, marginTop: 3 }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IncidentScreen
// ---------------------------------------------------------------------------

export function IncidentScreen({
  ctx,
  groupId,
  errorId,
}: {
  ctx: ScreenCtx;
  groupId: string;
  errorId: string | undefined;
}) {
  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";

  const {
    data: vm,
    status,
    reload,
    resolve,
    setPriority,
    setStatus,
    reassign,
    silence,
    addNote,
    users,
    canReassign,
  } = useIncident({
      client: ctx.client,
      projectId,
      environmentId,
      groupId,
      errorId,
      onResolved: () => ctx.back(),
    });

  // Local UI state
  const [bcOpen, setBcOpen] = useState(true);
  const [noteBody, setNoteBody] = useState("");
  const [reassignOpen, setReassignOpen] = useState(false);
  const [issueBusy, setIssueBusy] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [silenceOpen, setSilenceOpen] = useState(false);
  const [customSilenceMinutes, setCustomSilenceMinutes] = useState("");

  // ── Loading ──────────────────────────────────────────────────────────────
  if (status === "loading" && !vm) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching incident data." />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (status === "error" || !vm) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="alert"
          title="Couldn't load this incident"
          sub="Check your connection or try again."
          cta={
            <button className="sh-btn" onClick={reload}>
              Retry
            </button>
          }
        />
      </div>
    );
  }
  const incidentVm = vm;

  // ── Silence state ─────────────────────────────────────────────────────────
  const now = Date.now();
  const silencedUntilDate = vm.silencedUntil ? new Date(vm.silencedUntil) : null;
  const isSilenced = silencedUntilDate != null && silencedUntilDate.getTime() > now;
  const isCrash = vm.severity === "fatal";

  // ── Related: only rows that have a meaningful target ─────────────────────
  const renderedRelated = vm.related.filter((r) => r.target != null);

  // ── Related row click handler ─────────────────────────────────────────────
  function handleRelClick(rel: RelVM) {
    if (!rel.target) return;
    if (rel.target.kind === "section") {
      ctx.navigate(rel.target.section as NavSection);
    } else if (rel.target.kind === "drill") {
      ctx.drill("incident", { groupId: rel.target.groupId });
    }
  }

  async function createExternalIssueDraft() {
    if (!ctx.client.listCodeIntegrations || !ctx.client.createIncidentIssueDraft) {
      ctx.pushToast("Code integrations are not available in this build");
      return;
    }
    setIssueBusy(true);
    try {
      const response = await ctx.client.listCodeIntegrations(projectId);
      const integration = response.integrations[0];
      if (!integration) {
        ctx.pushToast("Connect a GitHub or GitLab repository in Setup first");
        return;
      }
      const draft = await ctx.client.createIncidentIssueDraft(groupId, { projectId, environmentId }, {
        integrationId: integration.id,
        incidentUrl: window.location.href
      });
      window.open(draft.draft.url, "_blank", "noopener,noreferrer");
      ctx.pushToast("Issue draft opened");
    } catch (err) {
      console.error(err);
      ctx.pushToast("Could not create issue draft");
    } finally {
      setIssueBusy(false);
    }
  }

  async function linkExternalIssue() {
    if (!ctx.client.linkIncidentExternalIssue) {
      ctx.pushToast("External issue linking is not available in this build");
      return;
    }
    const url = window.prompt("Paste the GitHub or GitLab issue URL");
    if (!url) return;
    const provider = url.includes("gitlab") ? "gitlab" : "github";
    const externalKey = url.match(/\/issues\/(\d+)/)?.[1] ?? url.split("/").filter(Boolean).at(-1) ?? "external";
    const fallbackTitle = incidentVm.title;
    const title = window.prompt("Issue title", fallbackTitle) ?? fallbackTitle;
    setIssueBusy(true);
    try {
      await ctx.client.linkIncidentExternalIssue(groupId, { projectId, environmentId }, {
        provider,
        externalKey,
        title,
        url,
        state: "open"
      });
      ctx.pushToast("External issue linked");
      reload();
    } catch (err) {
      console.error(err);
      ctx.pushToast("Could not link external issue");
    } finally {
      setIssueBusy(false);
    }
  }

  return (
    <>
      {/* ── Back affordance ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <button
          className="sh-btn"
          aria-label="Back"
          onClick={() => ctx.back()}
        >
          <Icon name="chev" size={13} style={{ transform: "rotate(180deg)" }} />
          Back
        </button>
      </div>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <span
            className={`sh-tag ${vm.severity === "warning" ? "warn" : vm.severity === "error" ? "error" : "critical"}`}
            style={{ fontSize: 11, textTransform: "uppercase", color: vm.severityColor }}
          >
            ● {vm.severity}
          </span>
          <div style={{ position: "relative" }}>
            <button
              className="sh-btn ghost"
              aria-label="Status"
              style={{ padding: "2px 6px", gap: 4 }}
              onClick={() => setStatusOpen((o) => !o)}
            >
              <StatusPill
                status={vm.status as "open" | "investigating" | "resolved" | "ignored"}
              />
              <Icon name="chevd" size={10} />
            </button>
            {statusOpen ? (
              <div className="sh-menu" style={MENU_STYLE}>
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className="sh-menu__item"
                    style={MENU_ITEM_STYLE}
                    onClick={() => {
                      void runMutation(() => setStatus(s), {
                        pushToast: ctx.pushToast,
                        message: "Could not update status",
                      });
                      setStatusOpen(false);
                    }}
                  >
                    <StatusPill status={s} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="sh-tag mono">{vm.groupId}</span>
          {vm.release ? (
            <span className="sh-tag mono">release {vm.release}</span>
          ) : null}
        </div>
        <div
          className="sh-faint sh-mono"
          style={{ fontSize: 11, marginBottom: 6 }}
        >
          {vm.incidentNumber ? `INC-${vm.incidentNumber}` : "INC-—"} · opened{" "}
          {vm.openedRelative} · assigned to {vm.assigneeEmail ?? "unassigned"}
        </div>
        <h1
          style={{
            fontSize: 23,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            margin: "8px 0",
            fontFamily: "var(--font-mono)",
          }}
        >
          {vm.title}
        </h1>
        {vm.origin ? (
          <p className="sh-muted" style={{ margin: 0, fontSize: 13 }}>
            Originated in{" "}
            <code style={{ color: "var(--fg)" }}>{vm.origin}</code> ·{" "}
            {ctx.project?.name ?? ""} / {ctx.environment?.name ?? ""}
          </p>
        ) : null}
      </div>

      {isCrash ? (
        <section
          aria-label="Crash impact"
          className="sh-card"
          style={{
            borderColor: "var(--sev-critical-border)",
            background: "linear-gradient(90deg, var(--sev-critical-bg), var(--bg-surface) 68%)",
          }}
        >
          <div
            className="sh-card__body"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(240px, 1fr) repeat(3, minmax(120px, auto))",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div>
              <div className="sh-eyebrow" style={{ color: "var(--sev-critical)" }}>
                Crash reporting
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                Fatal runtime crash detected
              </div>
              <div className="sh-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Prioritize this before lower-severity error groups. Review the stack, affected scope, and related trace context.
              </div>
            </div>
            <SummaryCell label="Occurrences" value={String(vm.occurrenceCount)} />
            <SummaryCell label="Users affected" value={String(vm.affectedUsers)} />
            <SummaryCell label="Tenants affected" value={String(vm.affectedTenants)} />
          </div>
        </section>
      ) : null}

      {/* ── Action bar ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <ConfirmButton
          label="Resolve"
          confirmLabel="Confirm resolution?"
          icon="check"
          kind="primary"
          onConfirm={() => {
            void runMutation(resolve, {
              pushToast: ctx.pushToast,
              message: "Could not resolve incident",
            });
          }}
        />

        {/* Reassign */}
        <div style={{ position: "relative" }}>
          <button
            className="sh-btn"
            disabled={!canReassign}
            title={canReassign ? undefined : "Admin access required to reassign"}
            onClick={() => setReassignOpen((o) => !o)}
          >
            <Icon name="user" size={14} />
            Reassign
          </button>
          {reassignOpen && users && users.length > 0 ? (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                zIndex: 100,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                minWidth: 180,
                boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                marginTop: 4,
              }}
            >
              <button
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 14px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid var(--border-subtle)",
                  cursor: "pointer",
                  fontSize: 12,
                  color: "var(--fg-muted)",
                }}
                onClick={() => {
                  void runMutation(() => reassign(null), {
                    pushToast: ctx.pushToast,
                    message: "Could not reassign incident",
                  });
                  setReassignOpen(false);
                }}
              >
                Unassigned
              </button>
              {users.map((u) => (
                <button
                  key={u.id}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 14px",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                  onClick={() => {
                    void runMutation(() => reassign(u.id), {
                      pushToast: ctx.pushToast,
                      message: "Could not reassign incident",
                    });
                    setReassignOpen(false);
                  }}
                >
                  {u.email}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Silence / Unsilence */}
        {isSilenced ? (
          <>
            <span className="sh-faint" style={{ fontSize: 12 }}>
              Silenced until{" "}
              {silencedUntilDate!.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <button
              className="sh-btn"
              onClick={() =>
                void runMutation(() => silence(null), {
                  pushToast: ctx.pushToast,
                  message: "Could not update silence",
                })
              }
            >
              <Icon name="bell" size={14} />
              Unsilence
            </button>
          </>
        ) : (
          <div style={{ position: "relative" }}>
            <button className="sh-btn" onClick={() => setSilenceOpen((o) => !o)}>
              <Icon name="bell" size={14} />
              Silence
            </button>
            {silenceOpen ? (
              <div className="sh-menu" style={MENU_STYLE}>
                {SILENCE_OPTIONS.map((opt) => (
                  <button
                    key={opt.minutes}
                    style={MENU_ITEM_STYLE}
                    onClick={() => {
                      void runMutation(() => silence(opt.minutes), {
                        pushToast: ctx.pushToast,
                        message: "Could not update silence",
                      });
                      setSilenceOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
                <div style={{ display: "flex", gap: 6, padding: "8px 14px", alignItems: "center" }}>
                  <input
                    className="sh-input"
                    type="number"
                    min={1}
                    placeholder="Custom (min)"
                    style={{ width: 90, fontSize: 12 }}
                    value={customSilenceMinutes}
                    onChange={(e) => setCustomSilenceMinutes(e.target.value)}
                  />
                  <button
                    className="sh-btn primary"
                    style={{ padding: "5px 9px", fontSize: 12 }}
                    disabled={!customSilenceMinutes || Number(customSilenceMinutes) <= 0}
                    onClick={() => {
                      const minutes = Number(customSilenceMinutes);
                      if (minutes > 0) {
                        void runMutation(() => silence(minutes), {
                          pushToast: ctx.pushToast,
                          message: "Could not update silence",
                        });
                        setCustomSilenceMinutes("");
                        setSilenceOpen(false);
                      }
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <button
          className="sh-btn"
          disabled={issueBusy}
          onClick={() => void createExternalIssueDraft()}
        >
          <Icon name="git" size={14} />
          Create issue
        </button>
        <button className="sh-btn ghost" disabled={issueBusy} onClick={() => void linkExternalIssue()}>
          <Icon name="link" size={14} />
          Link issue
        </button>

        {/* Copy link */}
        <button
          className="sh-btn ghost"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(window.location.href)
              .then(() => {
                ctx.pushToast("Link copied");
              })
              .catch(() => {
                ctx.pushToast("Couldn't copy link");
              });
          }}
        >
          <Icon name="copy" size={14} />
          Copy link
        </button>

        <div style={{ flex: 1 }} />

        {/* Right-side tags */}
        <div style={{ position: "relative" }}>
          <button
            className="sh-btn ghost"
            // Reflect the current selection so a screen reader announces the
            // priority state up front, instead of a bare "Priority" that
            // requires opening the menu to discover the value.
            aria-label={`Priority: ${vm.priority ?? "none"}`}
            style={{ padding: "2px 6px", gap: 4 }}
            onClick={() => setPriorityOpen((o) => !o)}
          >
            {vm.priority ? <PriorityPill p={vm.priority} /> : <span className="sh-tag">No priority</span>}
            <Icon name="chevd" size={10} />
          </button>
          {priorityOpen ? (
            <div className="sh-menu" style={{ ...MENU_STYLE, left: "auto", right: 0 }}>
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p}
                  style={MENU_ITEM_STYLE}
                  onClick={() => {
                    void runMutation(() => setPriority(p), {
                      pushToast: ctx.pushToast,
                      message: "Could not update priority",
                    });
                    setPriorityOpen(false);
                  }}
                >
                  <PriorityPill p={p} />
                </button>
              ))}
              <button
                style={{ ...MENU_ITEM_STYLE, borderBottom: "none" }}
                onClick={() => {
                  void runMutation(() => setPriority(null), {
                    pushToast: ctx.pushToast,
                    message: "Could not update priority",
                  });
                  setPriorityOpen(false);
                }}
              >
                No priority
              </button>
            </div>
          ) : null}
        </div>
        <span className="sh-tag">
          {vm.occurrenceCount} occurrences
        </span>
        <span className="sh-tag">
          {vm.affectedUsers} users · {vm.affectedTenants} tenants
        </span>
      </div>

      {/* ── Main two-column grid ──────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 16,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* Left column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 0,
          }}
        >
          {/* Occurrences summary (NO bar chart) */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Occurrences</h2>
            </div>
            <div className="sh-card__body" style={{ fontSize: 13 }}>
              <span>
                {vm.occurrenceCount} occurrences · first {vm.firstSeenRelative}{" "}
                · last {vm.lastSeenRelative}
              </span>
            </div>
          </div>

          {vm.replay ? (
            <IncidentReplayPanel
              breadcrumbs={vm.breadcrumbs}
              errorTimestamp={vm.errorTimestamp}
              replay={vm.replay}
              stack={vm.stack}
            />
          ) : null}

          {/* Stack trace */}
          <div
            className="sh-card"
            style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
          >
            <div className="sh-card__head">
              <h2 className="sh-h2">Stack trace</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <span className={`sh-tag ${sourceMapTone(vm.sourceMapDiagnostic.status)}`}>
                  {vm.sourceMapDiagnostic.status === "resolved" ? (
                    <Icon name="check" size={11} stroke={2.4} />
                  ) : (
                    <Icon name="alert" size={11} stroke={2.4} />
                  )}
                  {vm.sourceMapDiagnostic.label}
                </span>
                {vm.release ? (
                  <span className="sh-tag mono">{vm.release}</span>
                ) : null}
              </div>
            </div>
            <div
              className="sh-card__body flush"
              style={{ overflow: "auto", flex: 1 }}
            >
              <div
                style={{
                  margin: "12px 16px 0",
                  padding: "10px 12px",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  background: "var(--bg-surface-2)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 12.5 }}>{vm.sourceMapDiagnostic.label}</strong>
                  {vm.sourceMapDiagnostic.release ? (
                    <span className="sh-tag mono">release {vm.sourceMapDiagnostic.release}</span>
                  ) : null}
                  {vm.sourceMapDiagnostic.frameCount > 0 ? (
                    <span className="sh-tag ok">{vm.sourceMapDiagnostic.frameCount} frames</span>
                  ) : null}
                  {vm.sourceMapDiagnostic.unresolvedFrameCount > 0 ? (
                    <span className="sh-tag warn">{vm.sourceMapDiagnostic.unresolvedFrameCount} unresolved</span>
                  ) : null}
                </div>
                <div className="sh-muted" style={{ fontSize: 12, marginTop: 5 }}>
                  {vm.sourceMapDiagnostic.detail}
                </div>
              </div>
              {vm.stack ? (
                <pre
                  style={{
                    margin: 0,
                    padding: 16,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: "var(--fg-secondary)",
                  }}
                >
                  {vm.stack}
                </pre>
              ) : (
                <EmptyHint
                  icon="error"
                  title="No stack trace"
                  sub="No stack trace was captured for this occurrence."
                />
              )}
            </div>
          </div>

          {/* Breadcrumbs accordion */}
          <div className="sh-card">
            <button
              aria-label="Breadcrumbs"
              aria-expanded={bcOpen}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                background: "transparent",
                border: "none",
                borderBottom: bcOpen ? "1px solid var(--border-subtle)" : "none",
                cursor: "pointer",
                padding: "12px 16px",
              }}
              onClick={() => setBcOpen((o) => !o)}
            >
              <h2
                className="sh-h2"
                style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}
              >
                <Icon
                  name="chevd"
                  size={14}
                  style={{
                    transform: bcOpen ? "none" : "rotate(-90deg)",
                    transition: "transform .25s",
                  }}
                />
                Breadcrumbs — session before the error
              </h2>
              <span className="sh-tag">{vm.breadcrumbs.length} events</span>
            </button>
            {bcOpen ? (
              <div>
                {vm.breadcrumbs.length === 0 ? (
                  <EmptyHint
                    icon="activity"
                    title="No breadcrumbs"
                    sub="No breadcrumbs were captured for this session."
                  />
                ) : (
                  vm.breadcrumbs.map((bc, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "80px 80px 1fr",
                        gap: 12,
                        alignItems: "center",
                        padding: "8px 16px",
                        borderBottom: "1px solid var(--border-subtle)",
                        fontSize: 12,
                      }}
                    >
                      <span className="sh-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                        {bc.kind}
                      </span>
                      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>
                        {bc.timeRelative}
                      </span>
                      <span
                        style={{ color: "var(--fg-secondary)" }}
                        className="sh-mono"
                      >
                        {bc.title}
                      </span>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Right column */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {/* Impact grid 2×2 */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Impact</h2>
            </div>
            <div
              className="sh-card__body"
              style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
            >
              <div>
                <div className="sh-kpi__label">Users affected</div>
                <div
                  className="sh-kpi__value"
                  style={{ color: "var(--sev-critical)", fontSize: 20, marginTop: 3 }}
                >
                  {vm.affectedUsers}
                </div>
              </div>
              <div>
                <div className="sh-kpi__label">Tenants</div>
                <div
                  className="sh-kpi__value"
                  style={{ color: "var(--sev-warning)", fontSize: 20, marginTop: 3 }}
                >
                  {vm.affectedTenants}
                </div>
              </div>
              <div>
                <div className="sh-kpi__label">First seen</div>
                <div
                  className="sh-kpi__value"
                  style={{ color: "var(--fg-secondary)", fontSize: 20, marginTop: 3 }}
                >
                  {vm.firstSeenRelative}
                </div>
              </div>
              <div>
                <div className="sh-kpi__label">Last seen</div>
                <div
                  className="sh-kpi__value"
                  style={{ color: "var(--fg-secondary)", fontSize: 20, marginTop: 3 }}
                >
                  {vm.lastSeenRelative}
                </div>
              </div>
            </div>
          </div>

          {/* Related signals */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Related signals</h2>
            </div>
            <div className="sh-card__body flush">
              {renderedRelated.length === 0 ? (
                <EmptyHint
                  icon="activity"
                  title="No related signals"
                  sub="No related traces, sessions, or users found."
                />
              ) : (
                renderedRelated.map((rel, i) => (
                  <RelItem
                    key={i}
                    rel={rel}
                    onClick={rel.target ? () => handleRelClick(rel) : undefined}
                  />
                ))
              )}
            </div>
          </div>

          <IncidentCodeContextPanel codeContext={vm.codeContext} variant="v2" />

          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">External issues</h2>
              <span className="sh-tag">{vm.externalIssues.length}</span>
            </div>
            <div className="sh-card__body" style={{ display: "grid", gap: 8 }}>
              {vm.externalIssues.length === 0 ? (
                <div className="sh-muted" style={{ fontSize: 12 }}>
                  No GitHub or GitLab issue linked yet.
                </div>
              ) : (
                vm.externalIssues.map((issue) => (
                  <a key={issue.id} className="sh-row" href={issue.url} target="_blank" rel="noreferrer" style={{ gridTemplateColumns: "1fr auto", textDecoration: "none" }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 12.5 }}>{issue.title}</strong>
                      <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>
                        {issue.provider} · {issue.externalKey}
                      </div>
                    </div>
                    <span className="sh-tag">{issue.state}</span>
                  </a>
                ))
              )}
            </div>
          </div>

          {/* Triage notes */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2">Triage notes</h2>
            </div>
            <div className="sh-card__body" style={{ display: "grid", gap: 10 }}>
              {vm.notes.length === 0 ? (
                <EmptyHint
                  icon="check"
                  title="No triage notes yet"
                  sub="Add a note to document your investigation."
                />
              ) : (
                vm.notes.map((note, i) => (
                  <div key={i} style={{ display: "flex", gap: 10 }}>
                    <div
                      className="tb-avatar"
                      style={{ width: 26, height: 26, fontSize: 10, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--bg-surface-2)", color: "var(--fg-muted)", flex: "0 0 auto" }}
                    >
                      {note.initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12 }}>
                        <strong>{note.authorEmail}</strong>{" "}
                        <span className="sh-faint">· {note.timeRelative}</span>
                      </div>
                      <div className="sh-muted" style={{ fontSize: 12, marginTop: 2 }}>
                        {note.body}
                      </div>
                    </div>
                  </div>
                ))
              )}

              {/* Add note form */}
              <div
                style={{
                  marginTop: 4,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  className="sh-input"
                  placeholder="Add a note…"
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && noteBody.trim()) {
                      const body = noteBody.trim();
                      setNoteBody("");
                      void runMutation(() => addNote(body), {
                        pushToast: ctx.pushToast,
                        message: "Could not add note",
                      });
                    }
                  }}
                />
                <button
                  className="sh-btn primary"
                  aria-label="Submit note"
                  style={{ padding: "8px 10px" }}
                  disabled={!noteBody.trim()}
                  onClick={() => {
                    const body = noteBody.trim();
                    if (!body) return;
                    setNoteBody("");
                    void runMutation(() => addNote(body), {
                      pushToast: ctx.pushToast,
                      message: "Could not add note",
                    });
                  }}
                >
                  <Icon name="arrow" size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
