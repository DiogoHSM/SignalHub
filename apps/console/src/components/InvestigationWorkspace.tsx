import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorFilterValues } from "./ErrorFilters";
import { ErrorInvestigationPanel } from "./ErrorInvestigationPanel";
import type { EventFilterValues } from "./EventFilters";
import { EventInvestigationPanel } from "./EventInvestigationPanel";
import type { LlmFilterValues } from "./LlmFilters";
import { LlmInvestigationPanel } from "./LlmInvestigationPanel";
import { TraceInvestigationPanel } from "./TraceInvestigationPanel";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  initialTab?: InvestigationTab;
  initialFilters?: InvestigationInitialFilters;
};

export type InvestigationTab = "events" | "errors" | "traces" | "llm";

export type InvestigationInitialFilters = {
  events?: Partial<EventFilterValues>;
  errors?: Partial<ErrorFilterValues>;
  llm?: Partial<LlmFilterValues>;
};

export function InvestigationWorkspace({ client, projectId, environmentId, initialTab, initialFilters }: Props) {
  const [activeTab, setActiveTab] = useState<InvestigationTab>(initialTab ?? "events");

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

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
      </nav>
      {activeTab === "events" ? (
        <EventInvestigationPanel client={client} environmentId={environmentId} initialFilters={initialFilters?.events} projectId={projectId} />
      ) : null}
      {activeTab === "errors" ? (
        <ErrorInvestigationPanel client={client} environmentId={environmentId} initialFilters={initialFilters?.errors} projectId={projectId} />
      ) : null}
      {activeTab === "traces" ? <TraceInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
      {activeTab === "llm" ? (
        <LlmInvestigationPanel client={client} environmentId={environmentId} initialFilters={initialFilters?.llm} projectId={projectId} />
      ) : null}
    </section>
  );
}
