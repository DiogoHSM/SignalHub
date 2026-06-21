import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { LlmAggregates, LlmCallRecord, QueryFilters } from "../api/types";
import { LlmAggregateStrip } from "./LlmAggregateStrip";
import { LlmCallDetailDrawer } from "./LlmCallDetailDrawer";
import { LlmCallList } from "./LlmCallList";
import { LlmFilters, type LlmFilterValues } from "./LlmFilters";

type Props = {
  client: ApiClient;
  projectId: string;
  environmentId: string;
  initialFilters?: Partial<LlmFilterValues>;
};

type LoadState = "loading" | "ready" | "empty" | "unavailable";
type AggregateState = "loading" | "ready" | "unavailable";
type LlmModelCost = { label: string; cost: number; calls: number };
type LlmTenantCost = { label: string; cost: number; calls: number };
type LlmPromptRank = {
  prompt: string;
  calls: number;
  cost: number;
  tokens: number;
  p95LatencyMs: number | null;
  errorRate: number;
  lastSeenAt: string;
};
type LlmPromptModelComparison = LlmPromptRank & {
  model: string;
};

const defaultFilters: LlmFilterValues = {
  provider: "",
  model: "",
  promptName: "",
  status: "",
  tenantId: "",
  userId: "",
  sessionId: "",
  traceId: "",
  from: "",
  to: "",
  limit: "50"
};

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toLimit(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 50;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

function queryFromValues(projectId: string, environmentId: string, values: LlmFilterValues): QueryFilters {
  const query: QueryFilters = { projectId, environmentId, limit: toLimit(values.limit) };
  const provider = values.provider.trim();
  const model = values.model.trim();
  const promptName = values.promptName.trim();
  const status = values.status.trim();
  const tenantId = values.tenantId.trim();
  const userId = values.userId.trim();
  const sessionId = values.sessionId.trim();
  const traceId = values.traceId.trim();
  const from = toIso(values.from);
  const to = toIso(values.to);

  if (provider) query.provider = provider;
  if (model) query.model = model;
  if (promptName) query.promptName = promptName;
  if (status) query.status = status;
  if (tenantId) query.tenantId = tenantId;
  if (userId) query.userId = userId;
  if (sessionId) query.sessionId = sessionId;
  if (traceId) query.traceId = traceId;
  if (from) query.from = from;
  if (to) query.to = to;
  return query;
}

function filtersWithDefaults(initialFilters?: Partial<LlmFilterValues>): LlmFilterValues {
  return { ...defaultFilters, ...initialFilters };
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 2, style: "currency" }).format(value);
}

function parseCost(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index] ?? null;
}

function formatLatency(value: number | null): string {
  return value === null ? "none" : `${value} ms`;
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function buildModelCosts(calls: LlmCallRecord[]): LlmModelCost[] {
  const byModel = new Map<string, LlmModelCost>();
  for (const call of calls) {
    const label = `${call.provider} / ${call.model}`;
    const current = byModel.get(label) ?? { label, cost: 0, calls: 0 };
    current.cost += parseCost(call.costUsd);
    current.calls += 1;
    byModel.set(label, current);
  }
  return [...byModel.values()].sort((left, right) => right.cost - left.cost).slice(0, 5);
}

function buildTenantCosts(calls: LlmCallRecord[]): LlmTenantCost[] {
  const byTenant = new Map<string, LlmTenantCost>();
  for (const call of calls) {
    const label = call.tenantId ?? "Unassigned";
    const current = byTenant.get(label) ?? { label, cost: 0, calls: 0 };
    current.cost += parseCost(call.costUsd);
    current.calls += 1;
    byTenant.set(label, current);
  }
  return [...byTenant.values()].sort((left, right) => right.cost - left.cost).slice(0, 5);
}

function buildPromptRanking(calls: LlmCallRecord[]): LlmPromptRank[] {
  const byPrompt = new Map<
    string,
    {
      prompt: string;
      calls: number;
      cost: number;
      tokens: number;
      latencies: number[];
      errors: number;
      lastSeenAt: string;
    }
  >();

  for (const call of calls) {
    const prompt = call.promptName ?? "Unassigned prompt";
    const current = byPrompt.get(prompt) ?? {
      prompt,
      calls: 0,
      cost: 0,
      tokens: 0,
      latencies: [],
      errors: 0,
      lastSeenAt: call.timestamp
    };
    current.calls += 1;
    current.cost += parseCost(call.costUsd);
    current.tokens += call.inputTokens + call.outputTokens;
    if (call.latencyMs !== null) current.latencies.push(call.latencyMs);
    if (call.status !== "success") current.errors += 1;
    if (new Date(call.timestamp).getTime() > new Date(current.lastSeenAt).getTime()) current.lastSeenAt = call.timestamp;
    byPrompt.set(prompt, current);
  }

  return [...byPrompt.values()]
    .map((prompt) => ({
      prompt: prompt.prompt,
      calls: prompt.calls,
      cost: prompt.cost,
      tokens: prompt.tokens,
      p95LatencyMs: percentile(prompt.latencies, 0.95),
      errorRate: prompt.calls === 0 ? 0 : prompt.errors / prompt.calls,
      lastSeenAt: prompt.lastSeenAt
    }))
    .sort((left, right) => right.cost - left.cost)
    .slice(0, 6);
}

function buildPromptModelComparisons(calls: LlmCallRecord[]): LlmPromptModelComparison[] {
  const byPromptModel = new Map<
    string,
    {
      prompt: string;
      model: string;
      calls: number;
      cost: number;
      tokens: number;
      latencies: number[];
      errors: number;
      lastSeenAt: string;
    }
  >();

  for (const call of calls) {
    const prompt = call.promptName ?? "Unassigned prompt";
    const model = `${call.provider} / ${call.model}`;
    const key = `${prompt}\u0000${model}`;
    const current = byPromptModel.get(key) ?? {
      prompt,
      model,
      calls: 0,
      cost: 0,
      tokens: 0,
      latencies: [],
      errors: 0,
      lastSeenAt: call.timestamp
    };
    current.calls += 1;
    current.cost += parseCost(call.costUsd);
    current.tokens += call.inputTokens + call.outputTokens;
    if (call.latencyMs !== null) current.latencies.push(call.latencyMs);
    if (call.status !== "success") current.errors += 1;
    if (new Date(call.timestamp).getTime() > new Date(current.lastSeenAt).getTime()) current.lastSeenAt = call.timestamp;
    byPromptModel.set(key, current);
  }

  return [...byPromptModel.values()]
    .map((entry) => ({
      prompt: entry.prompt,
      model: entry.model,
      calls: entry.calls,
      cost: entry.cost,
      tokens: entry.tokens,
      p95LatencyMs: percentile(entry.latencies, 0.95),
      errorRate: entry.calls === 0 ? 0 : entry.errors / entry.calls,
      lastSeenAt: entry.lastSeenAt
    }))
    .sort((left, right) => right.cost - left.cost || right.calls - left.calls || left.prompt.localeCompare(right.prompt))
    .slice(0, 8);
}

function LlmInsights({ calls }: { calls: LlmCallRecord[] }) {
  const modelCosts = buildModelCosts(calls);
  const tenantCosts = buildTenantCosts(calls);
  const promptRanking = buildPromptRanking(calls);
  const promptModelComparisons = buildPromptModelComparisons(calls);
  const maxModelCost = Math.max(...modelCosts.map((item) => item.cost), 0);
  const maxTenantCost = Math.max(...tenantCosts.map((item) => item.cost), 0);
  const maxPromptModelCost = Math.max(...promptModelComparisons.map((item) => item.cost), 0);
  const maxPromptModelLatency = Math.max(...promptModelComparisons.map((item) => item.p95LatencyMs ?? 0), 0);

  return (
    <section className="llm-insights-grid" aria-label="LLM analytics">
      <div className="llm-insight-card" aria-label="LLM cost by model">
        <div className="panel-header">
          <h3>LLM cost by model</h3>
          <span>{modelCosts.length} models</span>
        </div>
        {modelCosts.length === 0 ? <p className="muted-text">No model cost in this result set.</p> : null}
        {modelCosts.map((item) => (
          <div className="llm-cost-bar" key={item.label}>
            <span>{item.label}</span>
            <strong>{formatCurrency(item.cost)}</strong>
            <div aria-hidden="true">
              <span style={{ width: `${maxModelCost > 0 ? Math.max(4, (item.cost / maxModelCost) * 100) : 0}%` }} />
            </div>
            <small>{item.calls} calls</small>
          </div>
        ))}
      </div>

      <div className="llm-insight-card" aria-label="Top tenants by LLM cost">
        <div className="panel-header">
          <h3>Top tenants by LLM cost</h3>
          <span>{tenantCosts.length} tenants</span>
        </div>
        {tenantCosts.length === 0 ? <p className="muted-text">No tenant cost in this result set.</p> : null}
        {tenantCosts.map((item) => (
          <div className="llm-cost-bar tenant" key={item.label}>
            <span>{item.label}</span>
            <strong>{formatCurrency(item.cost)}</strong>
            <div aria-hidden="true">
              <span style={{ width: `${maxTenantCost > 0 ? Math.max(4, (item.cost / maxTenantCost) * 100) : 0}%` }} />
            </div>
            <small>{item.calls} calls</small>
          </div>
        ))}
      </div>

      <section className="llm-insight-card llm-comparison-card" aria-label="Prompt and model comparison">
        <div className="panel-header">
          <h3>Prompt and model comparison</h3>
          <span>{promptModelComparisons.length} combinations</span>
        </div>
        {promptModelComparisons.length === 0 ? <p className="muted-text">No prompt/model activity in this result set.</p> : null}
        {promptModelComparisons.length > 0 ? (
          <table className="llm-prompt-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Model</th>
                <th>Calls</th>
                <th>Cost</th>
                <th>P95</th>
                <th>Error rate</th>
                <th>Signals</th>
              </tr>
            </thead>
            <tbody>
              {promptModelComparisons.map((item) => {
                const isHighestCost = item.cost > 0 && item.cost === maxPromptModelCost;
                const isSlowest = item.p95LatencyMs !== null && item.p95LatencyMs === maxPromptModelLatency;
                return (
                  <tr key={`${item.prompt}:${item.model}`}>
                    <th scope="row">{item.prompt}</th>
                    <td>{item.model}</td>
                    <td>{item.calls} calls</td>
                    <td>{formatCurrency(item.cost)}</td>
                    <td>p95 {formatLatency(item.p95LatencyMs)}</td>
                    <td>{Math.round(item.errorRate * 100)}% errors</td>
                    <td>
                      <span className="llm-signal-tags">
                        {isHighestCost ? <strong>Highest cost</strong> : null}
                        {isSlowest ? <strong>Slowest</strong> : null}
                        {!isHighestCost && !isSlowest ? <span>Normal</span> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}
      </section>

      <div className="llm-insight-card llm-prompt-card" aria-label="Prompt ranking">
        <div className="panel-header">
          <h3>Prompt ranking</h3>
          <span>{promptRanking.length} prompts</span>
        </div>
        {promptRanking.length === 0 ? <p className="muted-text">No prompt activity in this result set.</p> : null}
        {promptRanking.length > 0 ? (
          <table className="llm-prompt-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Calls</th>
                <th>Cost</th>
                <th>Tokens</th>
                <th>P95</th>
                <th>Error rate</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {promptRanking.map((prompt) => (
                <tr key={prompt.prompt}>
                  <th scope="row">{prompt.prompt}</th>
                  <td>{prompt.calls} calls</td>
                  <td>{formatCurrency(prompt.cost)}</td>
                  <td>{prompt.tokens} tokens</td>
                  <td>p95 {formatLatency(prompt.p95LatencyMs)}</td>
                  <td>{Math.round(prompt.errorRate * 100)}% errors</td>
                  <td>{formatTimestamp(prompt.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

export function LlmInvestigationPanel({ client, projectId, environmentId, initialFilters }: Props) {
  const initialFilterKey = JSON.stringify(initialFilters ?? {});
  const hasSyncedInitialFilters = useRef(false);
  const [draftFilters, setDraftFilters] = useState<LlmFilterValues>(() => filtersWithDefaults(initialFilters));
  const [appliedFilters, setAppliedFilters] = useState<LlmFilterValues>(() => filtersWithDefaults(initialFilters));
  const [reloadToken, setReloadToken] = useState(0);
  const [aggregateReloadToken, setAggregateReloadToken] = useState(0);
  const [calls, setCalls] = useState<LlmCallRecord[]>([]);
  const [selectedCall, setSelectedCall] = useState<LlmCallRecord | undefined>();
  const [totals, setTotals] = useState<LlmAggregates | undefined>();
  const [state, setState] = useState<LoadState>("loading");
  const [aggregateState, setAggregateState] = useState<AggregateState>("loading");
  const query = useMemo(
    () => queryFromValues(projectId, environmentId, appliedFilters),
    [projectId, environmentId, appliedFilters]
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setSelectedCall(undefined);

    void client.listLlmCalls(query).then(
      ({ data }) => {
        if (cancelled) return;
        setCalls(data);
        setState(data.length > 0 ? "ready" : "empty");
      },
      () => {
        if (cancelled) return;
        setCalls([]);
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, reloadToken]);

  useEffect(() => {
    if (!hasSyncedInitialFilters.current) {
      hasSyncedInitialFilters.current = true;
      return;
    }

    const next = filtersWithDefaults(initialFilters);
    setDraftFilters(next);
    setAppliedFilters(next);
  }, [initialFilterKey]);

  useEffect(() => {
    let cancelled = false;
    setAggregateState("loading");

    void client.getLlmAggregates(query).then(
      ({ data }) => {
        if (cancelled) return;
        setTotals(data);
        setAggregateState("ready");
      },
      () => {
        if (cancelled) return;
        setTotals(undefined);
        setAggregateState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, query, aggregateReloadToken]);

  function applyFilters() {
    setAppliedFilters({ ...draftFilters });
  }

  function resetFilters() {
    setDraftFilters(defaultFilters);
    setAppliedFilters({ ...defaultFilters });
    setReloadToken((current) => current + 1);
    setAggregateReloadToken((current) => current + 1);
  }

  function retryCalls() {
    setReloadToken((current) => current + 1);
  }

  function retryTotals() {
    setAggregateReloadToken((current) => current + 1);
  }

  return (
    <section className="investigation-layout">
      <div className="panel event-panel">
        <div className="panel-header">
          <h2>LLM</h2>
        </div>
        <LlmAggregateStrip onRetry={retryTotals} state={aggregateState} totals={totals} />
        <LlmFilters values={draftFilters} onApply={applyFilters} onChange={setDraftFilters} onReset={resetFilters} />
        {state === "loading" ? <p className="muted-text">Loading LLM calls</p> : null}
        {state === "unavailable" ? (
          <div className="status-box unavailable">
            <strong>LLM calls unavailable</strong>
            <button onClick={retryCalls} type="button">
              Retry calls
            </button>
          </div>
        ) : null}
        {state === "empty" ? <p className="muted-text">No LLM calls found</p> : null}
        {state === "ready" ? (
          <>
            <LlmInsights calls={calls} />
            <LlmCallList calls={calls} onSelect={setSelectedCall} selectedCallId={selectedCall?.id} />
          </>
        ) : null}
      </div>
      <LlmCallDetailDrawer call={selectedCall} />
    </section>
  );
}
