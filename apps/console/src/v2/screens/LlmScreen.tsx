import { useEffect, useState } from "react";
import type { OverviewWindow } from "../../api/types";
import {
  BigKpi,
  EmptyHint,
  formatCompact,
  formatLatency,
  formatUsd,
  formatUtcTimestamp,
  Icon,
  Legend,
  PageHead,
  Segmented,
  StackedArea,
} from "../../components/ui/v2";
import type { ScreenCtx } from "./registry";
import { useLlm } from "./useLlm";
import type { LlmCallRowVM, LlmPromptVM, LlmTenantVM } from "./useLlm";

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

function TenantRow({ row, ctx }: { row: LlmTenantVM; ctx: ScreenCtx }) {
  return (
    <button
      className="sh-row sh-interactive-row llm-tenant-row"
      onClick={() => ctx.drill("tenant", { tenantId: row.tenantId })}
    >
      <div>
        <strong className="sh-copy-12-5">{row.tenantId}</strong>
        <div className="sh-faint sh-mono sh-copy-11">
          {formatCompact(row.calls)} calls
        </div>
      </div>
      <span className="sh-cost">
        {formatUsd(row.costUsd)}
      </span>
      <span className="sh-muted sh-copy-11">
        {(row.share * 100).toFixed(1)}%
      </span>
      <div className="llm-share-track">
        <div
          className="llm-share-fill"
          style={{ width: `${Math.min(row.share * 100, 100)}%` }}
        />
      </div>
    </button>
  );
}

function PromptRow({ row }: { row: LlmPromptVM }) {
  return (
    <div className="sh-row llm-prompt-row">
      <div>
        <div className="sh-copy-13-medium">{row.promptName}</div>
        <div className="sh-faint sh-mono sh-copy-11">
          {row.model}
        </div>
      </div>
      <span className="sh-numeric">{formatCompact(row.calls)}</span>
      <span className="sh-mono sh-muted sh-copy-11-5">
        {row.avgTokens == null ? "—" : formatCompact(row.avgTokens)}
      </span>
      <span className="sh-mono sh-muted sh-copy-11-5">
        {formatLatency(row.avgLatencyMs)}
      </span>
      <span style={{ color: promptErrorColor(row.errorRate), fontVariantNumeric: "tabular-nums" }}>
        {(row.errorRate * 100).toFixed(1)}%
      </span>
      <span className="sh-cost">
        {formatUsd(row.costUsd)}
      </span>
      <span className="sh-mono sh-muted sh-copy-11-5">
        {formatLatency(row.p95LatencyMs)}
      </span>
      <Icon name="chev" size={13} style={{ color: "var(--fg-faint)" }} />
    </div>
  );
}

function CallRow({ row }: { row: LlmCallRowVM }) {
  return (
    <div className="sh-row llm-call-row">
      <span className="sh-mono sh-faint sh-copy-11">{formatUtcTimestamp(row.timestamp)}</span>
      <span className="sh-mono sh-copy-12">{row.provider}/{row.model}</span>
      <span className="sh-muted sh-copy-12 sh-ellipsis">{row.promptName ?? "—"}</span>
      <span className={row.status === "success" ? "sh-tag ok" : "sh-tag critical"}>{row.status}</span>
      <span className="sh-mono sh-muted sh-copy-11-5">{formatLatency(row.latencyMs)}</span>
      <span className="sh-cost">{formatUsd(row.costUsd)}</span>
    </div>
  );
}

export function LlmScreen({ ctx }: { ctx: ScreenCtx }) {
  const [window, setWindow] = useState<OverviewWindow>("24h");
  const projectId = ctx.project?.id;
  const environmentId = ctx.environment?.id;

  const seed = ctx.pendingFilters?.section === "llm" ? ctx.pendingFilters.filters : null;
  const [tenantId, setTenantId] = useState<string | undefined>(seed?.tenantId);
  const [userId, setUserId] = useState<string | undefined>(seed?.userId);
  const [provider, setProvider] = useState<string | undefined>(seed?.provider);
  const [model, setModel] = useState<string | undefined>(seed?.model);
  const [promptName, setPromptName] = useState<string | undefined>(seed?.promptName);
  const [callStatus, setCallStatus] = useState<string | undefined>(seed?.status);

  // The seed is one-shot: consume it once on mount (the shell remounts this
  // screen — via the `page` div's `key={seq}` — on every `navigate` call).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { ctx.clearPendingFilters?.(); }, []);

  const { data, status, reload } = useLlm({
    client: ctx.client,
    projectId,
    environmentId,
    window,
    tenantId,
    userId,
    provider,
    model,
    promptName,
    status: callStatus,
  });

  if (!ctx.project || !ctx.environment) {
    return (
      <div className="sh-empty-region">
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
      <div className="sh-empty-region">
        <EmptyHint icon="activity" title="Loading…" sub="Fetching LLM aggregates." />
      </div>
    );
  }

  if (status === "error" || !data) {
    return (
      <div className="sh-empty-region">
        <EmptyHint
          icon="alert"
          title="Could not load LLM observability"
          sub="Retry this request. Your filters are preserved." cta={<button className="sh-btn" onClick={reload}>Retry AI calls</button>}
        />
      </div>
    );
  }

  const { kpis, costByModel, tenants, prompts, recentCalls } = data;
  const hasSeededFilters =
    tenantId != null || userId != null || provider != null || model != null || promptName != null;

  return (
    <>
      <PageHead
        title="AI calls"
        sub={`${ctx.project.name} · ${ctx.environment.name} — compare model cost, latency, and quality. Compare prompt rows and recent calls to understand their contribution.`}
        actions={
          <>
            {hasSeededFilters ? (
              <button
                className="sh-btn"
                onClick={() => {
                  setTenantId(undefined);
                  setUserId(undefined);
                  setCallStatus(undefined);
                  setProvider(undefined);
                  setModel(undefined);
                  setPromptName(undefined);
                }}
              >
                <Icon name="x" size={14} />
                {[
                  tenantId && `tenant: ${tenantId}`,
                  userId && `user: ${userId}`,
                  provider && `provider: ${provider}`,
                  model && `model: ${model}`,
                  promptName && `prompt: ${promptName}`,
                ].filter(Boolean).join(" · ")}
              </button>
            ) : null}
            <Segmented
              options={WINDOW_OPTIONS}
              value={window}
              onChange={(v) => setWindow(v as OverviewWindow)}
            />
          </>
        }
      />

      <div className="llm-kpi-grid sh-investigation-grid sh-grid-12">
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

      <div className="llm-panels sh-investigation-grid sh-grid-16">
        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Cost by model — {window}</h2>
            <div className="sh-cluster-10">
              {costByModel.series.map((s) => (
                <Legend key={s.model} color={s.color} label={s.model} />
              ))}
            </div>
          </div>
          <div className="sh-card__body">
            {costByModel.series.length === 0 ? (
              <EmptyHint icon="activity" title="No LLM cost data" sub="No model cost is available for this window and filter selection." />
            ) : (
              <StackedArea buckets={costByModel.buckets} series={costByModel.series} />
            )}
          </div>
        </div>

        <div className="sh-card">
          <div className="sh-card__head">
            <h2 className="sh-h2">Top tenants — cost</h2>
            <span className="sh-faint sh-copy-11">{window}</span>
          </div>
          <div className="sh-card__body flush">
            {tenants.length === 0 ? (
              <EmptyHint icon="activity" title="No tenant cost" sub="No attributed tenant cost is available for this window and filter selection." />
            ) : (
              tenants.map((row) => <TenantRow key={row.tenantId} row={row} ctx={ctx} />)
            )}
          </div>
        </div>
      </div>

      <div
        className="sh-card sh-card-grow"
      >
        <div className="sh-card__head">
          <h2 className="sh-h2">Prompts — ranked by cost</h2>
          <div className="sh-cluster-8">
            <span className="sh-tag">{prompts.length} prompts</span>
            <span className="sh-tag mono">sorted by cost</span>
          </div>
        </div>
        <div className="sh-wide-table-scroll sh-wide-table-scroll--fill">
          <div className="sh-wide-table">
            <div className="sh-row sh-row__head llm-prompt-row">
              <span>Prompt · model</span>
              <span>Calls</span>
              <span>Avg tokens</span>
              <span>Avg latency</span>
              <span>Error rate</span>
              <span>Cost</span>
              <span>p95</span>
              <span />
            </div>
            <div className="sh-wide-table__body sh-wide-table__body--fill">
              {prompts.length === 0 ? (
                <EmptyHint icon="activity" title="No prompt data" sub="No prompt aggregates are available for this window and filter selection. Clear a filter or widen the window; if you expected data, check AI call capture." />
              ) : (
                prompts.map((row) => <PromptRow key={`${row.promptName}:${row.model}`} row={row} />)
              )}
            </div>
          </div>
        </div>
      </div>

      <div
        className="sh-card sh-card-grow"
      >
        <div className="sh-card__head">
          <h2 className="sh-h2">Recent calls</h2>
          <span className="sh-tag">{recentCalls.length} calls</span>
        </div>
        <div className="sh-wide-table-scroll sh-wide-table-scroll--fill">
          <div className="sh-wide-table">
            <div className="sh-row sh-row__head llm-call-row">
              <span>Timestamp</span>
              <span>Provider / model</span>
              <span>Prompt</span>
              <span>Status</span>
              <span>Latency</span>
              <span>Cost</span>
            </div>
            <div className="sh-wide-table__body sh-wide-table__body--fill">
              {recentCalls.length === 0 ? (
                <EmptyHint icon="sparkles" title="No recent calls" sub="No LLM calls match the current filters." />
              ) : (
                recentCalls.map((row) => <CallRow key={row.id} row={row} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
