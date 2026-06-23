import { useState } from "react";
import type { OverviewWindow } from "../../api/types";
import {
  BigKpi,
  EmptyHint,
  formatCompact,
  formatLatency,
  formatUsd,
  Icon,
  Legend,
  PageHead,
  Segmented,
  StackedArea,
} from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useLlm } from "./useLlm";
import type { LlmPromptVM, LlmTenantVM } from "./useLlm";

const WINDOW_OPTIONS: OverviewWindow[] = ["24h", "7d", "30d"];

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function formatRunRate(usd: number): string {
  return `≈ $ ${Math.round(usd).toLocaleString("en-US")} / mo run-rate`;
}

function promptErrorColor(rate: number): string {
  const pct = rate * 100;
  if (pct > 1) return "var(--sev-critical)";
  if (pct > 0.4) return "var(--sev-warning)";
  return "var(--fg-muted)";
}

const PROMPT_GRID = "1.6fr 100px 90px 100px 90px 90px 80px 28px";

function TenantRow({ row, ctx }: { row: LlmTenantVM; ctx: ScreenCtx }) {
  return (
    <button
      className="sh-row sh-row--btn"
      style={{
        gridTemplateColumns: "1.4fr 80px 70px 1fr",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        borderBottom: "1px solid var(--border-subtle)",
        cursor: "pointer",
      }}
      onClick={() => ctx.drill("tenant", { tenantId: row.tenantId })}
    >
      <div>
        <strong style={{ fontSize: 12.5 }}>{row.tenantId}</strong>
        <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {formatCompact(row.calls)} calls
        </div>
      </div>
      <span style={{ fontWeight: 600, color: "var(--sev-violet)", fontVariantNumeric: "tabular-nums" }}>
        {formatUsd(row.costUsd)}
      </span>
      <span className="sh-muted" style={{ fontSize: 11 }}>
        {(row.share * 100).toFixed(1)}%
      </span>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "var(--bg-canvas)",
          overflow: "hidden",
          alignSelf: "center",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(row.share * 100, 100)}%`,
            background: "var(--sev-violet)",
            borderRadius: 3,
          }}
        />
      </div>
    </button>
  );
}

function PromptRow({ row }: { row: LlmPromptVM }) {
  return (
    <div className="sh-row" style={{ gridTemplateColumns: PROMPT_GRID }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{row.promptName}</div>
        <div className="sh-faint sh-mono" style={{ fontSize: 11 }}>
          {row.model}
        </div>
      </div>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCompact(row.calls)}</span>
      <span className="sh-mono sh-muted" style={{ fontSize: 11.5 }}>
        {row.avgTokens == null ? "—" : formatCompact(row.avgTokens)}
      </span>
      <span className="sh-mono sh-muted" style={{ fontSize: 11.5 }}>
        {formatLatency(row.avgLatencyMs)}
      </span>
      <span style={{ color: promptErrorColor(row.errorRate), fontVariantNumeric: "tabular-nums" }}>
        {(row.errorRate * 100).toFixed(1)}%
      </span>
      <span style={{ fontWeight: 600, color: "var(--sev-violet)", fontVariantNumeric: "tabular-nums" }}>
        {formatUsd(row.costUsd)}
      </span>
      <span className="sh-mono sh-muted" style={{ fontSize: 11.5 }}>
        {formatLatency(row.p95LatencyMs)}
      </span>
      <Icon name="chev" size={13} style={{ color: "var(--fg-faint)" }} />
    </div>
  );
}

export function LlmScreen({ ctx }: { ctx: ScreenCtx }) {
  const [window, setWindow] = useState<OverviewWindow>("24h");
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const { data, status } = useLlm({ client: ctx.client, projectId, environmentId, window });

  if (!ctx.project || !ctx.environment) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="activity"
          title="No project selected"
          sub="Select a project and environment to view LLM observability."
        />
      </div>
    );
  }

  if (status === "loading" && !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint icon="activity" title="Loading…" sub="Fetching LLM aggregates." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div style={{ padding: "48px 24px", display: "grid", placeItems: "center" }}>
        <EmptyHint
          icon="alert"
          title="Could not load LLM observability"
          sub="Check your connection or try again."
        />
      </div>
    );
  }

  const { kpis, costByModel, tenants, prompts } = data;

  return (
    <>
      <PageHead
        title="LLM observability"
        sub="Cost, latency, quality, and attribution by tenant, prompt, and model."
        actions={
          <>
            <Segmented
              options={WINDOW_OPTIONS}
              value={window}
              onChange={(v) => setWindow(v as OverviewWindow)}
            />
            <button
              className="sh-btn primary"
              onClick={() => ctx.pushToast("CSV export is not yet available")}
            >
              <Icon name="download" size={14} />
              Export CSV
            </button>
          </>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        <BigKpi label="Calls" value={formatCompact(kpis.calls)} color="var(--sev-violet)" />
        <BigKpi
          label={`Cost (${window})`}
          value={formatUsd(kpis.costUsd)}
          sub={formatRunRate(kpis.runRateUsd)}
          color="var(--accent)"
        />
        <BigKpi label="Avg latency" value={formatLatency(kpis.avgLatencyMs)} color="var(--sev-info)" />
        <BigKpi label="p95 latency" value={formatLatency(kpis.p95LatencyMs)} color="var(--sev-warning)" />
        <BigKpi label="Error rate" value={formatPct(kpis.errorRate)} color="var(--sev-critical)" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 16 }}>
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Cost by model — {window}</h2>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {costByModel.series.map((s) => (
                <Legend key={s.model} color={s.color} label={s.model} />
              ))}
            </div>
          </div>
          <div className="sh-card__body">
            {costByModel.series.length === 0 ? (
              <EmptyHint icon="activity" title="No LLM cost data" sub="No model cost in this window." />
            ) : (
              <StackedArea buckets={costByModel.buckets} series={costByModel.series} />
            )}
          </div>
        </div>

        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Top tenants — cost</h2>
            <span className="sh-faint" style={{ fontSize: 11 }}>{window}</span>
          </div>
          <div className="sh-card__body flush">
            {tenants.length === 0 ? (
              <EmptyHint icon="activity" title="No tenant cost" sub="No attributed tenant cost in this window." />
            ) : (
              tenants.map((row) => <TenantRow key={row.tenantId} row={row} ctx={ctx} />)
            )}
          </div>
        </div>
      </div>

      <div
        className="sh-card"
        style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      >
        <div className="sh-card__head">
          <h2 className="sh-h2">Prompts — ranked by cost</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="sh-tag">{prompts.length} prompts</span>
            <span className="sh-tag mono">sorted by cost</span>
          </div>
        </div>
        <div className="sh-row sh-row__head" style={{ gridTemplateColumns: PROMPT_GRID }}>
          <span>Prompt · model</span>
          <span>Calls</span>
          <span>Avg tokens</span>
          <span>Avg latency</span>
          <span>Error rate</span>
          <span>Cost</span>
          <span>p95</span>
          <span />
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {prompts.length === 0 ? (
            <EmptyHint icon="activity" title="No prompt data" sub="No LLM calls in this window." />
          ) : (
            prompts.map((row) => <PromptRow key={`${row.promptName}:${row.model}`} row={row} />)
          )}
        </div>
      </div>
    </>
  );
}
