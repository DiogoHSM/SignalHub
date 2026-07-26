import { useState } from "react";
import type { UserRecentSession, UserSignalType, UserTimelineRow, UserWindow } from "../../api/types";
import {
  EmptyHint,
  formatCompact,
  formatUsd,
  formatUtcTimestamp,
  Icon,
  Kv,
  PageHead,
  Segmented,
  SummaryStat,
} from "../../components/ui/v2";
import type { ScreenCtx, NavPayload } from "./registry";
import { useUsers, type UserRowVM, type UserSort } from "./useUsers";
import { useUserDetail } from "./useUserDetail";

const WINDOW_OPTIONS: UserWindow[] = ["24h", "7d", "30d"];

const SORT_OPTIONS: Array<{ value: UserSort; label: string }> = [
  { value: "impact", label: "Impact" },
  { value: "usage", label: "Usage" },
  { value: "errors", label: "Errors" },
  { value: "llmCost", label: "LLM cost" },
  { value: "recent", label: "Recent" },
];

const SIGNAL_OPTIONS: Array<{ value: UserSignalType | ""; label: string }> = [
  { value: "", label: "All signals" },
  { value: "event", label: "Events" },
  { value: "error", label: "Errors" },
  { value: "trace", label: "Traces" },
  { value: "llm", label: "LLM" },
];

const USER_ROW_GRID = "minmax(220px,1.6fr) 64px 70px 64px 90px 70px 80px 64px 70px 90px";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function formatTraitValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Maps a user timeline row to the filtered navigation target for the section
 * that owns that signal type. Events have no v2 section yet — PER-436 will
 * map them to `{ section: "events", filters: { eventName, userId, … } }`.
 */
export function timelineNavTarget(row: UserTimelineRow, userId: string): NavPayload | null {
  const tenantId = row.tenantId ?? undefined;

  if (row.type === "error") {
    return { section: "investigate", filters: { userId, ...(tenantId ? { tenantId } : {}), severity: row.severity, status: row.status } };
  }

  if (row.type === "trace") {
    return {
      section: "traces",
      filters: {
        userId,
        ...(tenantId ? { tenantId } : {}),
        ...(row.sessionId ? { sessionId: row.sessionId } : {}),
        ...(row.traceId ? { traceId: row.traceId } : {}),
      },
    };
  }

  if (row.type === "llm") {
    const promptName = row.promptName?.trim();
    return {
      section: "llm",
      filters: {
        userId,
        ...(tenantId ? { tenantId } : {}),
        provider: row.provider,
        model: row.model,
        status: row.status,
        ...(promptName && promptName !== "Unspecified" ? { promptName } : {}),
      },
    };
  }

  // PER-436: mapear para { section: "events", filters: { eventName, userId, … } }
  return null;
}

function timelineMeta(row: UserTimelineRow): string {
  const context = [row.tenantId, row.sessionId, row.traceId].filter(Boolean).join(" / ");
  if (row.type === "event") return `${row.eventName}${context ? ` · ${context}` : ""}`;
  if (row.type === "error") return `${row.severity} ${row.status}${context ? ` · ${context}` : ""}`;
  if (row.type === "trace") return `${row.status}${row.durationMs === null ? "" : ` · ${row.durationMs}ms`}${context ? ` · ${context}` : ""}`;
  return `${row.provider} ${row.model} ${row.status} ${formatUsd(Number(row.costUsd))}${context ? ` · ${context}` : ""}`;
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function UserRow({ row, active, onSelect }: { row: UserRowVM; active: boolean; onSelect: () => void }) {
  const disabled = row.isAnonymous || !row.userId;
  return (
    <button
      className={`sh-row sh-row--btn${active ? " is-active" : ""}`}
      aria-label={row.label}
      style={{
        gridTemplateColumns: USER_ROW_GRID,
        width: "100%",
        textAlign: "left",
        // Native <button> chrome defaults to a light control background; without
        // an explicit override the non-selected rows show a light box on the
        // dark v2 shell. `active` still gets the same highlight the .is-active
        // CSS class defines, so selection stays visible.
        background: active ? "var(--bg-surface-2)" : "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
      }}
      disabled={disabled}
      onClick={onSelect}
    >
      <div style={{ minWidth: 0 }}>
        <div className="sh-mono" style={{ fontSize: 12.5, color: "var(--fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.label}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span className="sh-tag mono">{row.key}</span>
          {Object.entries(row.keyTraits).map(([k, v]) => (
            <span className="sh-tag" key={k}>{k}: {v}</span>
          ))}
        </div>
      </div>
      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{row.impactScore}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCompact(row.events)}</span>
      <span className={row.errors > 0 ? "sh-tag critical" : "sh-muted"} style={{ fontVariantNumeric: "tabular-nums" }}>{row.errors}</span>
      <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{row.failedTraces} failed</span>
      <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{formatCompact(row.llmCalls)}</span>
      <span style={{ color: "var(--sev-violet)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatUsd(row.llmCostUsd)}</span>
      <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{row.activeTenants}</span>
      <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{row.activeSessions}</span>
      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{row.lastSeenLabel}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function RecentSessionsTable({ sessions }: { sessions: UserRecentSession[] }) {
  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div className="sh-card__head"><h2 className="sh-h2">Recent sessions</h2></div>
      <div className="sh-row sh-row__head" style={{ gridTemplateColumns: "1.2fr 1fr 60px 60px 60px 60px 80px 1fr 1fr" }}>
        <span>Session</span>
        <span>Tenant</span>
        <span>Events</span>
        <span>Errors</span>
        <span>Traces</span>
        <span>LLM</span>
        <span>Cost</span>
        <span>First seen</span>
        <span>Last seen</span>
      </div>
      <div style={{ overflow: "auto", maxHeight: 220 }}>
        {sessions.length === 0 ? (
          <EmptyHint icon="users" title="No recent sessions" sub="No sessions in this window." />
        ) : (
          sessions.map((s) => (
            <div className="sh-row" key={s.sessionId} style={{ gridTemplateColumns: "1.2fr 1fr 60px 60px 60px 60px 80px 1fr 1fr" }}>
              <span className="sh-mono" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{s.sessionId}</span>
              <span className="sh-muted">{s.tenantId ?? "Unassigned"}</span>
              <span>{s.events}</span>
              <span>{s.errors}</span>
              <span>{s.traces}</span>
              <span>{s.llmCalls}</span>
              <span style={{ color: "var(--sev-violet)" }}>{formatUsd(Number(s.llmCostUsd))}</span>
              <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{formatUtcTimestamp(s.firstSeenAt)}</span>
              <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{formatUtcTimestamp(s.lastSeenAt)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TimelineRow({ row, onClick }: { row: UserTimelineRow; onClick?: () => void }) {
  const clickable = onClick != null;
  return (
    <button
      className={`sh-row${clickable ? " sh-row--btn" : ""}`}
      style={{ gridTemplateColumns: "90px 1fr auto", width: "100%", textAlign: "left" }}
      disabled={!clickable}
      onClick={onClick}
    >
      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>{formatUtcTimestamp(row.timestamp)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="sh-mono" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</div>
        <div className="sh-faint" style={{ fontSize: 11 }}>{timelineMeta(row)}</div>
      </div>
      <span className="sh-tag mono">{row.type}</span>
    </button>
  );
}

function UserDetailPanel({ ctx, row, window: timeWindow }: { ctx: ScreenCtx; row: UserRowVM; window: UserWindow }) {
  const [detailTenantDraft, setDetailTenantDraft] = useState("");
  const [appliedDetailTenantId, setAppliedDetailTenantId] = useState("");
  const [signalType, setSignalType] = useState<UserSignalType | "">("");

  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";
  const userId = row.isAnonymous || !row.userId ? null : row.userId;

  const { data, status, loadingMore, loadMoreError, loadMore } = useUserDetail({
    client: ctx.client,
    projectId,
    environmentId,
    userId,
    window: timeWindow,
    tenantId: appliedDetailTenantId || undefined,
    signalType: signalType || undefined,
  });

  const summary = data?.user;

  return (
    <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0, gap: 0 }}>
      <div className="sh-card__head">
        <div>
          <h2 className="sh-h2">{row.label}</h2>
          <span className="sh-tag mono">{row.key}</span>
        </div>
      </div>
      <div className="sh-card__body" style={{ display: "grid", gap: 16, overflow: "auto" }}>
        {Object.keys(row.keyTraits).length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(row.keyTraits).map(([k, v]) => (
              <span className="sh-tag" key={k}>{k}: {v}</span>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            Tenant
            <input
              className="sh-input"
              value={detailTenantDraft}
              onChange={(e) => setDetailTenantDraft(e.target.value)}
            />
          </label>
          <button className="sh-btn" onClick={() => setAppliedDetailTenantId(detailTenantDraft)}>Apply</button>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
            Signal
            <select
              className="sh-input"
              value={signalType}
              onChange={(e) => setSignalType(e.target.value as UserSignalType | "")}
            >
              {SIGNAL_OPTIONS.map((o) => (
                <option key={o.value || "all"} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          {appliedDetailTenantId ? (
            <span className="sh-tag">
              tenant: {appliedDetailTenantId}
              <button
                className="sh-btn ghost"
                style={{ padding: "0 4px", marginLeft: 4 }}
                onClick={() => { setDetailTenantDraft(""); setAppliedDetailTenantId(""); }}
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          ) : null}
        </div>

        {status === "loading" && !data ? (
          <EmptyHint icon="users" title="Loading user detail…" sub="Fetching identity, sessions, and timeline." />
        ) : status === "error" ? (
          <EmptyHint icon="alert" title="Could not load user detail" sub="Check your connection or try again." />
        ) : summary ? (
          <>
            <div>
              <h3 className="sh-h3" style={{ marginBottom: 8 }}>Identity profile</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 12 }}>
                <Kv k="Profile first seen" v={summary.firstSeenAt ? formatUtcTimestamp(summary.firstSeenAt) : "none"} mono />
                <Kv k="Last activity" v={summary.lastSeenAt ? formatUtcTimestamp(summary.lastSeenAt) : "none"} mono />
                <Kv k="Traits updated" v={summary.profileUpdatedAt ? formatUtcTimestamp(summary.profileUpdatedAt) : "none"} mono />
              </div>
              {Object.keys(summary.traits).length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {Object.entries(summary.traits)
                    .sort(([l], [r]) => l.localeCompare(r))
                    .map(([k, v]) => (
                      <Kv k={k} v={formatTraitValue(v)} key={k} mono />
                    ))}
                </div>
              ) : (
                <p className="sh-muted" style={{ fontSize: 12 }}>No identify traits yet. Send identifyUser traits from the SDK or REST API to build this profile.</p>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <SummaryStat label="Events" value={formatCompact(summary.events)} />
              <SummaryStat label="Errors" value={String(summary.errors)} tone={summary.errors > 0 ? "danger" : undefined} />
              <SummaryStat label="Failed traces" value={String(summary.failedTraces)} />
              <SummaryStat label="LLM calls" value={formatCompact(summary.llmCalls)} />
              <SummaryStat label="LLM cost" value={formatUsd(Number(summary.llmCostUsd))} />
              <SummaryStat label="Active tenants" value={String(summary.activeTenants)} />
              <SummaryStat label="Active sessions" value={String(summary.activeSessions)} />
              <SummaryStat label="Last seen" value={summary.lastSeenAt ? formatUtcTimestamp(summary.lastSeenAt) : "—"} mono />
            </div>

            <RecentSessionsTable sessions={data?.recentSessions ?? []} />

            <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div className="sh-card__head"><h2 className="sh-h2">Timeline</h2></div>
              <div style={{ overflow: "auto", maxHeight: 320 }}>
                {(data?.timeline.length ?? 0) === 0 ? (
                  <EmptyHint icon="activity" title="No timeline rows" sub="No timeline rows match the current filters." />
                ) : (
                  data?.timeline.map((t) => {
                    const target = userId ? timelineNavTarget(t, userId) : null;
                    return (
                      <TimelineRow
                        key={`${t.type}:${t.id}`}
                        row={t}
                        onClick={target ? () => ctx.navigate(target.section, target.filters) : undefined}
                      />
                    );
                  })
                )}
              </div>
              {loadMoreError ? <p className="sh-muted" style={{ fontSize: 12, padding: "8px 16px" }}>More timeline rows are unavailable.</p> : null}
              {data?.cursor ? (
                <div style={{ padding: "10px 16px" }}>
                  <button className="sh-btn" disabled={loadingMore} onClick={loadMore}>
                    {loadingMore ? "Loading more…" : "Load more"}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function UsersScreen({ ctx }: { ctx: ScreenCtx }) {
  const [window, setWindow] = useState<UserWindow>("7d");
  const [searchDraft, setSearchDraft] = useState("");
  const [tenantDraft, setTenantDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [appliedTenantId, setAppliedTenantId] = useState("");
  const [sort, setSort] = useState<UserSort>("impact");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";

  const { data, status } = useUsers({
    client: ctx.client,
    projectId,
    environmentId,
    window,
    search: appliedSearch || undefined,
    tenantId: appliedTenantId || undefined,
    sort,
    limit: 50,
  });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="users" title="No project selected" sub="Select a project and environment to view users." />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="users" title="Loading…" sub="Fetching user activity." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="alert" title="Could not load users" sub="Check your connection or try again." />
      </div>
    );
  }

  const { rows } = data;
  const selectedRow = rows.find((r) => r.key === selectedKey) ?? null;

  return (
    <>
      <PageHead
        title="Users"
        sub="Per-user activity, impact, and identity across this project and environment."
        actions={<Segmented options={WINDOW_OPTIONS} value={window} onChange={(v) => setWindow(v as UserWindow)} />}
      />

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          Search
          <input className="sh-input" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          Tenant
          <input className="sh-input" value={tenantDraft} onChange={(e) => setTenantDraft(e.target.value)} />
        </label>
        <button
          className="sh-btn primary"
          onClick={() => { setAppliedSearch(searchDraft); setAppliedTenantId(tenantDraft); }}
        >
          Apply filters
        </button>
        <div style={{ flex: 1 }} />
        <div className="sh-segmented" aria-label="Sort users">
          {SORT_OPTIONS.map((o) => (
            <button key={o.value} aria-pressed={sort === o.value} onClick={() => setSort(o.value)}>{o.label}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16, flex: 1, minHeight: 0 }}>
        <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="sh-row sh-row__head" style={{ gridTemplateColumns: USER_ROW_GRID }}>
            <span>User</span>
            <span>Impact</span>
            <span>Events</span>
            <span>Errors</span>
            <span>Failed traces</span>
            <span>LLM calls</span>
            <span>LLM cost</span>
            <span>Tenants</span>
            <span>Sessions</span>
            <span>Last</span>
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {rows.length === 0 ? (
              <EmptyHint icon="users" title="No user activity" sub="No user activity in this window." />
            ) : (
              rows.map((row) => (
                <UserRow
                  key={row.key}
                  row={row}
                  active={row.key === selectedKey}
                  onSelect={() => setSelectedKey(row.key)}
                />
              ))
            )}
          </div>
        </div>

        {selectedRow ? (
          <UserDetailPanel ctx={ctx} row={selectedRow} window={window} />
        ) : (
          <div className="sh-card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            <EmptyHint icon="users" title="Select a user" sub="Pick a user from the list to inspect recent activity." />
          </div>
        )}
      </div>
    </>
  );
}
