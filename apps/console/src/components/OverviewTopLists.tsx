import type { OverviewResponse } from "../api/types";
import type { OverviewDrilldown } from "./OverviewDashboard";

type Props = {
  onDrilldown: (drilldown: OverviewDrilldown) => void;
  top: OverviewResponse["top"];
};

type Row = {
  label: string;
  value: string;
  drilldown: OverviewDrilldown;
  disabled?: boolean;
};

type List = {
  title: string;
  emptyText: string;
  rows: Row[];
};

function count(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function renderList(list: List, onDrilldown: Props["onDrilldown"]) {
  return (
    <article className="overview-list" key={list.title}>
      <h3>{list.title}</h3>
      {list.rows.length === 0 ? <p className="muted-text">{list.emptyText}</p> : null}
      {list.rows.map((row) => (
        <button disabled={row.disabled} key={`${list.title}-${row.label}`} onClick={() => onDrilldown(row.drilldown)} type="button">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </button>
      ))}
    </article>
  );
}

export function OverviewTopLists({ onDrilldown, top }: Props) {
  const lists: List[] = [
    {
      title: "Top events",
      emptyText: "No event activity in this window.",
      rows: top.events.map((row) => ({
        label: row.name,
        value: count(row.total),
        drilldown: { tab: "events", filters: { eventName: row.name } }
      }))
    },
    {
      title: "Error severity",
      emptyText: "No errors in this window.",
      rows: top.errorSeverity.map((row) => ({
        label: row.severity,
        value: count(row.total),
        drilldown: { tab: "errors", filters: { severity: row.severity } }
      }))
    },
    {
      title: "Error status",
      emptyText: "No error statuses in this window.",
      rows: top.errorStatus.map((row) => ({
        label: row.status,
        value: count(row.total),
        drilldown: { tab: "errors", filters: { status: row.status } }
      }))
    },
    {
      title: "LLM providers",
      emptyText: "No LLM calls in this window.",
      rows: top.llmProviders.map((row) => ({
        label: row.provider,
        value: `${count(row.total)} / ${row.totalCostUsd}`,
        drilldown: { tab: "llm", filters: { provider: row.provider } }
      }))
    },
    {
      title: "LLM models",
      emptyText: "No LLM models in this window.",
      rows: top.llmModels.map((row) => ({
        label: row.model,
        value: `${count(row.total)} / ${row.totalCostUsd}`,
        drilldown: { tab: "llm", filters: { model: row.model } }
      }))
    },
    {
      title: "LLM prompts",
      emptyText: "No LLM prompts in this window.",
      rows: top.llmPrompts.map((row) => ({
        label: row.promptName,
        value: `${count(row.total)} / ${row.totalCostUsd}`,
        drilldown: { tab: "llm", filters: { promptName: row.promptName } },
        disabled: row.promptName === "Unspecified"
      }))
    },
    {
      title: "Tenant usage",
      emptyText: "No tenant usage in this window.",
      rows: top.tenantsByUsage.map((row) => ({
        label: row.tenantId,
        value: count(row.total),
        drilldown: { tab: "entities", filters: { tenantId: row.tenantId } }
      }))
    },
    {
      title: "Tenant errors",
      emptyText: "No tenant errors in this window.",
      rows: top.tenantsByErrors.map((row) => ({
        label: row.tenantId,
        value: count(row.total),
        drilldown: { tab: "entities", filters: { tenantId: row.tenantId } }
      }))
    },
    {
      title: "Tenant LLM calls",
      emptyText: "No tenant LLM calls in this window.",
      rows: top.tenantsByLlmCalls.map((row) => ({
        label: row.tenantId,
        value: count(row.total),
        drilldown: { tab: "entities", filters: { tenantId: row.tenantId } }
      }))
    },
    {
      title: "Tenant LLM cost",
      emptyText: "No tenant LLM cost in this window.",
      rows: top.tenantsByLlmCost.map((row) => ({
        label: row.tenantId,
        value: row.totalCostUsd,
        drilldown: { tab: "entities", filters: { tenantId: row.tenantId } }
      }))
    }
  ];

  return (
    <section className="overview-lists" aria-label="Overview top lists">
      {lists.map((list) => renderList(list, onDrilldown))}
    </section>
  );
}
