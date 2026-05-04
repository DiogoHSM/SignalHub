import type { ApiClient } from "../api/client";
import { EventInvestigationPanel } from "./EventInvestigationPanel";

type Props = {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
};

export function InvestigationWorkspace({ client, projectId, environmentId }: Props) {
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
        <button aria-pressed="true" type="button">
          Events
        </button>
        <button disabled type="button">
          Errors
        </button>
        <button disabled type="button">
          Traces
        </button>
        <button disabled type="button">
          LLM
        </button>
      </nav>
      <EventInvestigationPanel client={client} environmentId={environmentId} projectId={projectId} />
    </section>
  );
}
