type Props = {
  projectId?: string;
  environmentId?: string;
  latestSecret?: string;
};

const endpoint = "http://localhost:3000";

export function SnippetPanel({ projectId, environmentId, latestSecret }: Props) {
  const apiKey = latestSecret ?? "SIGNAL_HUB_API_KEY";
  const safeProjectId = projectId ?? "PROJECT_ID";
  const safeEnvironmentId = environmentId ?? "ENVIRONMENT_ID";
  const keyScope = projectId && environmentId ? `${projectId} / ${environmentId}` : "select project / environment";
  const sdkSnippet = `import { createSignalHubClient } from "@signal-hub/sdk";

const signalHub = createSignalHubClient({
  endpoint: "${endpoint}",
  apiKey: "${apiKey}"
});

// Key scope: ${keyScope}
signalHub.track("checkout.started", {
  plan: "team"
});

await signalHub.flush();`;
  const httpSnippet = `curl -X POST "${endpoint}/v1/events" \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "checkout.started",
    "properties": {
      "plan": "team"
    }
  }'

# Key scope: ${keyScope}
# Project: ${safeProjectId}
# Environment: ${safeEnvironmentId}`;
  const envSnippet = `SIGNAL_HUB_ENDPOINT=${endpoint}
SIGNAL_HUB_API_KEY=${apiKey}
SIGNAL_HUB_PROJECT_ID=${safeProjectId}
SIGNAL_HUB_ENVIRONMENT_ID=${safeEnvironmentId}`;

  return (
    <section className="panel snippet-panel">
      <div className="panel-header">
        <h2>Snippets</h2>
      </div>
      <div className="snippet-grid">
        <article className="snippet-card">
          <h3>SDK</h3>
          <pre>
            <code>{sdkSnippet}</code>
          </pre>
        </article>
        <article className="snippet-card">
          <h3>HTTP</h3>
          <pre>
            <code>{httpSnippet}</code>
          </pre>
        </article>
        <article className="snippet-card">
          <h3>Environment</h3>
          <pre>
            <code>{envSnippet}</code>
          </pre>
        </article>
      </div>
    </section>
  );
}
