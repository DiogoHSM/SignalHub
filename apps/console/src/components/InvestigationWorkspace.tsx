import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import { EntitiesInvestigationPanel } from "./EntitiesInvestigationPanel";
import type { ErrorFilterValues } from "./ErrorFilters";
import { ErrorInvestigationPanel } from "./ErrorInvestigationPanel";
import type { EventFilterValues } from "./EventFilters";
import { EventInvestigationPanel } from "./EventInvestigationPanel";
import type { LlmFilterValues } from "./LlmFilters";
import { LlmInvestigationPanel } from "./LlmInvestigationPanel";
import { TraceInvestigationPanel } from "./TraceInvestigationPanel";
import type { TraceFilterValues } from "./TraceFilters";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  initialTab?: InvestigationTab;
  initialFilters?: InvestigationInitialFilters;
};

export type InvestigationTab = "events" | "errors" | "traces" | "llm" | "entities";

export type InvestigationInitialFilters = {
  events?: Partial<EventFilterValues>;
  errors?: Partial<ErrorFilterValues>;
  traces?: Partial<TraceFilterValues>;
  llm?: Partial<LlmFilterValues>;
  entities?: { tenantId?: string };
};

export type InvestigationDrilldown =
  | { tab: "events"; filters: Partial<EventFilterValues> }
  | { tab: "errors"; filters: Partial<ErrorFilterValues> }
  | { tab: "traces"; filters: Partial<TraceFilterValues> }
  | { tab: "llm"; filters: Partial<LlmFilterValues> };

export function InvestigationWorkspace({ client, projectId, environmentId, initialTab, initialFilters }: Props) {
  const [activeTab, setActiveTab] = useState<InvestigationTab>(initialTab ?? "events");
  const [localInitialFilters, setLocalInitialFilters] = useState<InvestigationInitialFilters>({});
  const mergedInitialFilters: InvestigationInitialFilters = {
    events: { ...initialFilters?.events, ...localInitialFilters.events },
    errors: { ...initialFilters?.errors, ...localInitialFilters.errors },
    traces: { ...initialFilters?.traces, ...localInitialFilters.traces },
    llm: { ...initialFilters?.llm, ...localInitialFilters.llm },
    entities: initialFilters?.entities
  };

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    setLocalInitialFilters({});
  }, [projectId, environmentId]);

  function handleEntityDrilldown(drilldown: InvestigationDrilldown) {
    setLocalInitialFilters((current) => ({
      ...current,
      [drilldown.tab]: drilldown.filters
    }));
    setActiveTab(drilldown.tab);
  }

  if (!projectId || !environmentId) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Investigate</h2>
        </div>
        <p className="muted-text">Select a project and environment in Setup to investigate telemetry.</p>
      </section>
    );
  }

  return (
    <section className="investigation-workspace">
      <div className="panel-header">
        <h2>Investigate</h2>
      </div>
      <nav className="investigation-tabs" aria-label="Investigation views">
        <button aria-pressed={activeTab === "events"} onClick={() => setActiveTab("events")} type="button">
          Events
        </button>
        <button aria-pressed={activeTab === "errors"} onClick={() => setActiveTab("errors")} type="button">
          Errors
        </button>
        <button aria-pressed={activeTab === "traces"} onClick={() => setActiveTab("traces")} type="button">
          Traces
        </button>
        <button aria-pressed={activeTab === "llm"} onClick={() => setActiveTab("llm")} type="button">
          LLM
        </button>
        <button aria-pressed={activeTab === "entities"} onClick={() => setActiveTab("entities")} type="button">
          Entities
        </button>
      </nav>
      {activeTab === "events" ? (
        <EventInvestigationPanel
          client={client}
          environmentId={environmentId}
          initialFilters={mergedInitialFilters.events}
          projectId={projectId}
        />
      ) : null}
      {activeTab === "errors" ? (
        <ErrorInvestigationPanel
          client={client}
          environmentId={environmentId}
          initialFilters={mergedInitialFilters.errors}
          projectId={projectId}
        />
      ) : null}
      {activeTab === "traces" ? (
        <TraceInvestigationPanel
          client={client}
          environmentId={environmentId}
          initialFilters={mergedInitialFilters.traces}
          projectId={projectId}
        />
      ) : null}
      {activeTab === "llm" ? (
        <LlmInvestigationPanel client={client} environmentId={environmentId} initialFilters={mergedInitialFilters.llm} projectId={projectId} />
      ) : null}
      {activeTab === "entities" ? (
        <EntitiesInvestigationPanel
          client={client}
          environmentId={environmentId}
          initialTenantId={mergedInitialFilters.entities?.tenantId}
          onDrilldown={handleEntityDrilldown}
          projectId={projectId}
        />
      ) : null}
    </section>
  );
}
