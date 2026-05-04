import { useState } from "react";
import type { ApiClient } from "../api/client";
import { ErrorInvestigationPanel } from "./ErrorInvestigationPanel";
import { EventInvestigationPanel } from "./EventInvestigationPanel";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

type InvestigationTab = "events" | "errors";

export function InvestigationWorkspace({ client, projectId, environmentId }: Props) {
  const [activeTab, setActiveTab] = useState<InvestigationTab>("events");

  if (!projectId || !environmentId) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h2>Investigate</h2>
        </div>
        <p className="muted-text">Select a project and environment in Setup to investigate events.</p>
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
        <button disabled type="button">
          Traces
        </button>
        <button disabled type="button">
          LLM
        </button>
      </nav>
      {activeTab === "events" ? <EventInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
      {activeTab === "errors" ? <ErrorInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} /> : null}
    </section>
  );
}
