import { useState } from "react";
import type { EntityWindow } from "../../api/types";
import {
  EmptyHint,
  Icon,
  PageHead,
  Segmented,
  formatCompact,
  formatUsd,
} from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useTenants } from "./useTenants";
import type { TenantRowVM, TenantSort } from "./useTenants";

const WINDOW_OPTIONS: EntityWindow[] = ["24h", "7d", "30d"];

const SORT_OPTIONS: Array<{ value: TenantSort; label: string }> = [
  { value: "impact", label: "Impact" },
  { value: "usage", label: "Usage" },
  { value: "errors", label: "Errors" },
  { value: "llmCost", label: "LLM cost" },
  { value: "recent", label: "Recent" },
];

const GRID = "minmax(220px,2fr) 90px 90px 90px 100px 100px 100px 28px";

function TenantRow({ row, ctx }: { row: TenantRowVM; ctx: ScreenCtx }) {
  const clickable = !row.isUnassigned && row.tenantId != null;

  return (
    <button
      className="sh-row sh-row--btn"
      aria-label={row.label}
      style={{
        gridTemplateColumns: GRID,
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        cursor: clickable ? "pointer" : "default",
        opacity: clickable ? 1 : 0.6,
      }}
      disabled={!clickable}
      onClick={clickable ? () => ctx.drill("tenant", { tenantId: row.tenantId as string }) : undefined}
    >
      <div style={{ minWidth: 0 }}>
        <div className="sh-mono" style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.label}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
          <span className="sh-tag mono">{row.key}</span>
          {row.keyTraits.slice(0, 2).map((t) => (
            <span key={t.key} className="sh-tag" style={{ fontSize: 10 }}>
              {t.key}: {t.value}
            </span>
          ))}
        </div>
      </div>

      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{row.impactScore}</span>

      <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCompact(row.events)}</span>

      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          color: row.errors > 0 ? "var(--sev-critical)" : "var(--fg-muted)",
        }}
      >
        {formatCompact(row.errors)}
      </span>

      <span style={{ fontWeight: 600, color: "var(--sev-violet)", fontVariantNumeric: "tabular-nums" }}>
        {formatUsd(row.llmCostUsd)}
      </span>

      <span className="sh-muted" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatCompact(row.activeUsers)}
      </span>

      <span className="sh-mono sh-faint" style={{ fontSize: 11 }}>
        {row.lastSeen}
      </span>

      <Icon name="chev" size={13} style={{ color: "var(--fg-faint)" }} />
    </button>
  );
}

export function TenantsScreen({ ctx }: { ctx: ScreenCtx }) {
  const [window, setWindow] = useState<EntityWindow>("24h");
  const [sort, setSort] = useState<TenantSort>("impact");
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");

  const projectId = ctx.project?.id ?? "";
  const environmentId = ctx.environment?.id ?? "";

  const { data, status, loadMore, loadingMore } = useTenants({
    client: ctx.client,
    projectId,
    environmentId,
    window,
    search: appliedSearch,
    sort,
  });

  const applySearch = () => setAppliedSearch(searchDraft);

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="cube"
          title="No project selected"
          sub="Select a project and environment to view tenants."
        />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching tenant activity." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="alert"
          title="Could not load tenants"
          sub="Check your connection or try again."
        />
      </div>
    );
  }

  const { rows, hasMore } = data;

  return (
    <>
      <PageHead
        title="Tenants"
        sub="Entities ranked by impact across events, errors, traces, and LLM cost."
        actions={
          <Segmented options={WINDOW_OPTIONS} value={window} onChange={(v) => setWindow(v as EntityWindow)} />
        }
      />

      {/* Filter row */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div className="sh-segmented" aria-label="Sort tenants">
          {SORT_OPTIONS.map((o) => (
            <button key={o.value} aria-pressed={sort === o.value} onClick={() => setSort(o.value)}>
              {o.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <input
          className="sh-input"
          aria-label="Search tenants"
          placeholder="Search tenant id or label…"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applySearch();
          }}
        />
        <button className="sh-btn" onClick={applySearch}>
          <Icon name="search" size={13} />
          Search
        </button>
      </div>

      {/* Tenant table */}
      <div className="sh-card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <div className="sh-row sh-row__head" style={{ gridTemplateColumns: GRID }}>
          <span>Tenant</span>
          <span>Impact</span>
          <span>Events</span>
          <span>Errors</span>
          <span>LLM cost</span>
          <span>Users</span>
          <span>Last seen</span>
          <span />
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          {rows.length === 0 ? (
            <EmptyHint
              icon="cube"
              title="No tenant activity"
              sub="No tenants match the current filters in this window."
            />
          ) : (
            rows.map((row) => <TenantRow key={row.key} row={row} ctx={ctx} />)
          )}
        </div>

        {rows.length > 0 && hasMore ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
            <button className="sh-btn" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading more…" : "Load more"}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
