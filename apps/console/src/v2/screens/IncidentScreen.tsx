import { useState, type CSSProperties, type FormEvent } from "react";
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
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 1440, label: "24 hours" },
];

const MENU_STYLE: CSSProperties = {
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
  padding: "4px 0",
};

const MENU_ITEM_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  textAlign: "left",
  padding: "8px 14px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  color: "var(--fg-secondary)",
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
        gap: 12,
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
          width: 30,
          height: 30,
          borderRadius: 8,
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
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--fg)" }}>{rel.title}</div>
        <div className="sh-faint" style={{ fontSize: 11, marginTop: 1 }}>
          {rel.sub}
        </div>
      </div>
      {onClick ? <Icon name="chev" size={12} style={{ color: "var(--fg-faint)" }} /> : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Link issue modal
// ---------------------------------------------------------------------------

type ParsedIssue = { provider: string; key: string } | null;

function parseIssueUrl(url: string): ParsedIssue {
  const m = url.match(/^https?:\/\/(www\.)?(github\.com|gitlab\.[\w.]+)\/[^\s]+?\/(?:-\/)?issues\/(\d+)/i);
  if (!m) return null;
  const provider = m[2].toLowerCase().startsWith("gitlab") ? "GitLab" : "GitHub";
  return { provider, key: `#${m[3]}` };
}

function LinkIssueModal({
  open,
  defaultTitle,
  onClose,
  onLink,
}: {
  open: boolean;
  defaultTitle: string;
  onClose: () => void;
  onLink: (provider: string, key: string, url: string, title: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const parsed = parseIssueUrl(url.trim());
  const invalid = url.trim() !== "" && !parsed;

  if (!open) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed) return;
    onLink(parsed.provider, parsed.key, url.trim(), title.trim() || defaultTitle);
    setUrl("");
    setTitle(defaultTitle);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
      onClick={(e) => {
        if (e.currentTarget === e.target) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-issue-title"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 460,
          boxShadow: "0 16px 48px rgba(0,0,0,0.28)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <h2 id="link-issue-title" className="sh-h2" style={{ fontSize: 15 }}>
            Link external issue
          </h2>
          <button
            aria-label="Close dialog"
            className="sh-btn ghost"
            style={{ padding: 6 }}
            onClick={onClose}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
        <form onSubmit={submit}>
          <div style={{ padding: 16, display: "grid", gap: 14 }}>
            <div>
              <label
                htmlFor="link-issue-url"
                style={{ display: "block", fontSize: 11.5, fontWeight: 600, marginBottom: 6, color: "var(--fg-secondary)" }}
              >
                Issue URL
              </label>
              <input
                id="link-issue-url"
                type="url"
                autoFocus
                placeholder="https://github.com/org/repo/issues/123"
                autoComplete="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="sh-input"
                style={{
                  borderColor: invalid ? "var(--sev-critical)" : undefined,
                }}
              />
              <div className="sh-faint" style={{ fontSize: 11, marginTop: 5 }}>
                GitHub or GitLab issue URL — provider and issue number are detected automatically.
              </div>
              {invalid ? (
                <div style={{ color: "var(--sev-critical)", fontSize: 11, marginTop: 5 }}>
                  Enter a valid GitHub or GitLab issue URL (…/issues/123).
                </div>
              ) : null}
            </div>
            {parsed ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "var(--accent)",
                }}
              >
                <Icon name="check" size={14} />
                Detected <strong>{parsed.provider}</strong> issue <strong>{parsed.key}</strong>
              </div>
            ) : null}
            <div>
              <label
                htmlFor="link-issue-title"
                style={{ display: "block", fontSize: 11.5, fontWeight: 600, marginBottom: 6, color: "var(--fg-secondary)" }}
              >
                Issue title
              </label>
              <input
                id="link-issue-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="sh-input"
              />
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 16px",
              borderTop: "1px solid var(--border-subtle)",
            }}
          >
            <button type="button" className="sh-btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="sh-btn primary" disabled={!parsed}>
              Link issue
            </button>
          </div>
        </form>
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
    occurrences,
    occurrencesStatus,
    occurrencesCursor,
    loadMoreOccurrences,
    retryOccurrences,
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
  const [linkModalOpen, setLinkModalOpen] = useState(false);

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

  async function linkExternalIssue(provider: string, key: string, url: string, title: string) {
    if (!ctx.client.linkIncidentExternalIssue) {
      ctx.pushToast("External issue linking is not available in this build");
      return;
    }
    setIssueBusy(true);
    try {
      await ctx.client.linkIncidentExternalIssue(groupId, { projectId, environmentId }, {
        provider: provider.toLowerCase() as "github" | "gitlab",
        externalKey: key.replace("#", ""),
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
      setLinkModalOpen(false);
    }
  }

  return (
    <>
      {/* ── Back affordance ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: 8 }}>
        <button className="sh-btn" aria-label="Back" onClick={() => ctx.back()}>
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
            <Icon name="dot" size={10} /> {vm.severity}
          </span>
          <div style={{ position: "relative" }}>
            <button
              className="sh-btn ghost"
              aria-label="Status"
              style={{ padding: "2px 6px", gap: 4 }}
              onClick={() => setStatusOpen((o) => !o)}
            >
              <StatusPill status={vm.status as "open" | "investigating" | "resolved" | "ignored"} />
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
                    {vm.status === s ? <Icon name="check" size={12} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="sh-tag mono">{vm.groupId}</span>
          {vm.release ? <span className="sh-tag mono">release {vm.release}</span> : null}
        </div>
        <div className="sh-faint sh-mono" style={{ fontSize: 11, marginBottom: 6 }}>
          {vm.incidentNumber ? `INC-${vm.incidentNumber}` : "INC-—"} · opened {vm.openedRelative} · assigned to{" "}
          <span style={{ color: "var(--fg-secondary)", fontWeight: 500 }}>{vm.assigneeEmail ?? "unassigned"}</span>
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            margin: "8px 0",
            fontFamily: "var(--font-mono)",
            lineHeight: 1.25,
          }}
        >
          {vm.title}
        </h1>
        {vm.origin ? (
          <p className="sh-muted" style={{ margin: 0, fontSize: 13 }}>
            Originated in <code style={{ color: "var(--fg)" }}>{vm.origin}</code> · {ctx.project?.name ?? ""} /{" "}
            {ctx.environment?.name ?? ""}
          </p>
        ) : null}
      </div>

      {isCrash ? (
        <section
          aria-label="Crash reporting"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(240px, 1fr) repeat(3, minmax(120px, auto))",
            gap: 16,
            alignItems: "center",
            padding: 16,
            borderRadius: 12,
            border: "1px solid var(--sev-critical-border)",
            background: "linear-gradient(90deg, var(--sev-critical-bg), var(--bg-surface) 68%)",
          }}
        >
          <div>
            <div className="sh-eyebrow" style={{ color: "var(--sev-critical)" }}>
              Crash reporting
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>Fatal runtime crash detected</div>
            <div className="sh-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Prioritize this before lower-severity error groups. Review the stack, affected scope, and related trace context.
            </div>
          </div>
          <CrashKpi label="Occurrences" value={String(vm.occurrenceCount)} />
          <CrashKpi label="Users affected" value={String(vm.affectedUsers)} />
          <CrashKpi label="Tenants affected" value={String(vm.affectedTenants)} />
        </section>
      ) : null}

      {/* ── Sticky action bar ─────────────────────────────────────────────── */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "10px 0",
          background: "var(--bg-base)",
          borderBottom: "1px solid var(--border-subtle)",
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
                padding: "4px 0",
              }}
            >
              <div
                style={{
                  padding: "6px 14px",
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--fg-muted)",
                  fontWeight: 600,
                }}
              >
                Assign to
              </div>
              <button
                style={MENU_ITEM_STYLE}
                onClick={() => {
                  void runMutation(() => reassign(null), {
                    pushToast: ctx.pushToast,
                    message: "Could not reassign incident",
                  });
                  setReassignOpen(false);
                }}
              >
                Unassigned
                {vm.assigneeEmail == null ? <Icon name="check" size={12} /> : null}
              </button>
              {users.map((u) => (
                <button
                  key={u.id}
                  style={MENU_ITEM_STYLE}
                  onClick={() => {
                    void runMutation(() => reassign(u.id), {
                      pushToast: ctx.pushToast,
                      message: "Could not reassign incident",
                    });
                    setReassignOpen(false);
                  }}
                >
                  {u.email}
                  {vm.assigneeEmail === u.email ? <Icon name="check" size={12} /> : null}
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
                <div
                  style={{
                    padding: "6px 14px",
                    fontSize: 10.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: "var(--fg-muted)",
                    fontWeight: 600,
                  }}
                >
                  Mute notifications for
                </div>
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
                <div
                  style={{
                    display: "flex",
                    gap: 6,
                    padding: "8px 14px",
                    alignItems: "center",
                    borderTop: "1px solid var(--border-subtle)",
                  }}
                >
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

        <button className="sh-btn" disabled={issueBusy} onClick={() => void createExternalIssueDraft()}>
          <Icon name="git" size={14} />
          Create issue
        </button>
        <button className="sh-btn ghost" disabled={issueBusy} onClick={() => setLinkModalOpen(true)}>
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
            aria-label={`Priority: ${vm.priority ?? "none"}`}
            style={{ padding: "2px 6px", gap: 4 }}
            onClick={() => setPriorityOpen((o) => !o)}
          >
            {vm.priority ? <PriorityPill p={vm.priority} /> : <span className="sh-tag">No priority</span>}
            <Icon name="chevd" size={10} />
          </button>
          {priorityOpen ? (
            <div className="sh-menu" style={{ ...MENU_STYLE, left: "auto", right: 0 }}>
              <div
                style={{
                  padding: "6px 14px",
                  fontSize: 10.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "var(--fg-muted)",
                  fontWeight: 600,
                }}
              >
                Set priority
              </div>
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
                  {vm.priority === p ? <Icon name="check" size={12} /> : null}
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
                {vm.priority == null ? <Icon name="check" size={12} /> : null}
              </button>
            </div>
          ) : null}
        </div>
        <span className="sh-tag">{vm.occurrenceCount} occurrences</span>
        <span className="sh-tag">
          {vm.affectedUsers} users · {vm.affectedTenants} tenants
        </span>
      </div>

      {/* ── Main two-column grid ──────────────────────────────────────────── */}
      <div
        role="region"
        aria-label="Incident details"
        style={{
          display: "grid",
          gridTemplateColumns: "1.6fr 1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left column */}
        <div
          role="region"
          aria-label="Primary incident details"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minWidth: 0,
          }}
        >
          {/* Occurrences summary */}
          <section aria-label="Occurrence summary" className="sh-card">
            <div className="sh-card__body" style={{ padding: "12px 16px" }}>
              <span style={{ fontSize: 12.5 }}>
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{vm.occurrenceCount} occurrences</b>{" "}
                <span className="sh-muted">
                  · first {vm.firstSeenRelative} · last {vm.lastSeenRelative}
                </span>
              </span>
            </div>
          </section>

          {/* Occurrence history */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2" style={{ fontSize: 14, fontWeight: 600 }}>
                Occurrence history
              </h2>
              <span className="sh-tag">{occurrences.length} loaded</span>
            </div>
            <div className="sh-card__body" style={{ display: "flex", flexDirection: "column", gap: 6, padding: 0 }}>
              <div style={{ padding: "0 16px" }}>
                {occurrencesStatus === "loading" && occurrences.length === 0 ? (
                  <span className="sh-muted">Loading occurrences…</span>
                ) : occurrencesStatus === "error" && occurrences.length === 0 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span className="sh-muted">Occurrence history is unavailable.</span>
                    <button
                      className="sh-btn ghost"
                      type="button"
                      aria-label="Retry occurrence history"
                      onClick={retryOccurrences}
                    >
                      Retry
                    </button>
                  </div>
                ) : occurrences.length === 0 ? (
                  <span className="sh-muted">No additional occurrences in this group.</span>
                ) : (
                  occurrences.map((occurrence) => (
                    <div
                      key={occurrence.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) auto auto",
                        alignItems: "center",
                        gap: 12,
                        padding: "8px 0",
                        borderBottom: "1px solid var(--border-subtle)",
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div className="sh-mono" style={{ fontSize: 11.5 }}>
                          {occurrence.id}
                        </div>
                        <div className="sh-faint" style={{ fontSize: 10.5 }}>
                          {occurrence.release ?? "no release"} · {occurrence.userId ?? "anonymous user"} ·{" "}
                          {occurrence.tenantId ?? "no tenant"}
                        </div>
                      </div>
                      <span className={`sh-tag ${occurrence.severity === "warning" ? "warn" : "critical"}`}>
                        {occurrence.severity}
                      </span>
                      <span className="sh-faint" style={{ fontSize: 10.5 }}>
                        {new Date(occurrence.timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "10px 16px",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <span className="sh-faint" style={{ fontSize: 11.5 }}>
                  Newest first
                </span>
                {occurrencesCursor ? (
                  <button
                    className="sh-btn compact"
                    type="button"
                    disabled={occurrencesStatus === "loading"}
                    onClick={() => void loadMoreOccurrences()}
                  >
                    {occurrencesStatus === "loading" ? "Loading…" : "Load more occurrences"}
                  </button>
                ) : null}
              </div>
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
              <h2 className="sh-h2" style={{ fontSize: 14, fontWeight: 600 }}>
                Stack trace
              </h2>
              <div style={{ display: "flex", gap: 6 }}>
                <span className={`sh-tag ${sourceMapTone(vm.sourceMapDiagnostic.status)}`}>
                  {vm.sourceMapDiagnostic.status === "resolved" ? (
                    <Icon name="check" size={11} stroke={2.4} />
                  ) : (
                    <Icon name="alert" size={11} stroke={2.4} />
                  )}
                  {vm.sourceMapDiagnostic.label}
                </span>
                {vm.release ? <span className="sh-tag mono">{vm.release}</span> : null}
              </div>
            </div>
            <div className="sh-card__body flush" style={{ overflow: "auto", flex: 1, padding: 0 }}>
              <div
                style={{
                  margin: 12,
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
                <EmptyHint icon="error" title="No stack trace" sub="No stack trace was captured for this occurrence." />
              )}
            </div>
          </div>

          <IncidentCodeContextPanel codeContext={vm.codeContext} variant="v2" />

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
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: 0,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <Icon
                  name="chevd"
                  size={14}
                  style={{
                    transform: bcOpen ? "none" : "rotate(-90deg)",
                    transition: "transform .25s",
                  }}
                />
                Breadcrumbs
                <span className="sh-muted" style={{ fontSize: 12, fontWeight: 400 }}>
                  — session before the error
                </span>
              </h2>
              <span className="sh-tag">{vm.breadcrumbs.length} events</span>
            </button>
            {bcOpen ? (
              <div>
                {vm.breadcrumbs.length === 0 ? (
                  <EmptyHint icon="activity" title="No breadcrumbs" sub="No breadcrumbs were captured for this session." />
                ) : (
                  vm.breadcrumbs.map((bc, i) => (
                    <div
                      key={i}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "90px 70px 1fr",
                        gap: 12,
                        alignItems: "center",
                        padding: "8px 16px",
                        borderBottom: "1px solid var(--border-subtle)",
                        fontSize: 12,
                        color: bc.kind === "error" ? "var(--sev-critical)" : "var(--fg-secondary)",
                      }}
                    >
                      <span className="sh-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                        {bc.kind}
                      </span>
                      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>
                        {bc.timeRelative}
                      </span>
                      <span className="sh-mono">{bc.title}</span>
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Right column */}
        <div
          role="region"
          aria-label="Incident context and triage"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            minWidth: 0,
          }}
        >
          {/* Impact */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2" style={{ fontSize: 14, fontWeight: 600 }}>
                Impact
              </h2>
            </div>
            <div
              className="sh-card__body"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
              }}
            >
              <ImpactCell label="Users affected" value={String(vm.affectedUsers)} tone="critical" />
              <ImpactCell label="Tenants" value={String(vm.affectedTenants)} tone="warning" />
              <ImpactCell label="First seen" value={vm.firstSeenRelative} />
              <ImpactCell label="Last seen" value={vm.lastSeenRelative} />
            </div>
          </div>

          {/* Related signals */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2" style={{ fontSize: 14, fontWeight: 600 }}>
                Related signals
              </h2>
            </div>
            <div className="sh-card__body flush">
              {renderedRelated.length === 0 ? (
                <EmptyHint icon="activity" title="No related signals" sub="No related traces, sessions, or users found." />
              ) : (
                renderedRelated.map((rel, i) => (
                  <RelItem key={i} rel={rel} onClick={rel.target ? () => handleRelClick(rel) : undefined} />
                ))
              )}
            </div>
          </div>

          {/* External issues */}
          <div className="sh-card">
            <div className="sh-card__head">
              <h2 className="sh-h2" style={{ fontSize: 14, fontWeight: 600 }}>
                External issues
              </h2>
              <span className="sh-tag">{vm.externalIssues.length}</span>
            </div>
            <div className="sh-card__body" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12 }}>
              {vm.externalIssues.length === 0 ? (
                <div className="sh-muted" style={{ fontSize: 12 }}>
                  No GitHub or GitLab issue linked yet.
                </div>
              ) : (
                vm.externalIssues.map((issue) => (
                  <a
                    key={issue.id}
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: 8,
                      background: "var(--bg-canvas)",
                      border: "1px solid var(--border-subtle)",
                      textDecoration: "none",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 12.5, color: "var(--fg)" }}>{issue.title}</strong>
                      <div className="sh-faint sh-mono" style={{ fontSize: 10.5 }}>
                        {issue.provider} · #{issue.externalKey.replace(/^#/, "")}
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
              <h2 className="sh-h2" style={{ fontSize: 14, fontWeight: 600 }}>
                Triage notes
              </h2>
              <span className="sh-tag">{vm.notes.length}</span>
            </div>
            <div className="sh-card__body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {vm.notes.length === 0 ? (
                <EmptyHint icon="check" title="No triage notes yet" sub="Add a note to document your investigation." />
              ) : (
                vm.notes.map((note, i) => (
                  <div key={i} style={{ display: "flex", gap: 10 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        fontSize: 11,
                        display: "grid",
                        placeItems: "center",
                        borderRadius: "50%",
                        background: "var(--bg-surface-2)",
                        color: "var(--fg-muted)",
                        flex: "0 0 auto",
                        fontWeight: 600,
                      }}
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

      <LinkIssueModal
        open={linkModalOpen}
        defaultTitle={incidentVm.title}
        onClose={() => setLinkModalOpen(false)}
        onLink={linkExternalIssue}
      />
    </>
  );
}

function CrashKpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <b
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: "var(--fg)",
        }}
      >
        {value}
      </b>
      <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>{label}</span>
    </div>
  );
}

function ImpactCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "critical" | "warning";
}) {
  const color = tone === "critical" ? "var(--sev-critical)" : tone === "warning" ? "var(--sev-warning)" : "var(--fg)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span className="sh-kpi__label">{label}</span>
      <b style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums", color }}>{value}</b>
    </div>
  );
}
