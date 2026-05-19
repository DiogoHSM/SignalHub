type Props = {
  projectId?: string;
  environmentId?: string;
  latestSecret?: string;
  apiEndpoint?: string;
};

function resolveEndpoint(apiEndpoint?: string): string {
  if (apiEndpoint) {
    return apiEndpoint.replace(/\/$/, "");
  }

  return window.location.origin;
}

export function SnippetPanel({ projectId, environmentId, latestSecret, apiEndpoint }: Props) {
  const endpoint = resolveEndpoint(apiEndpoint);
  const apiKey = latestSecret ?? "SIGMON_API_KEY";
  const safeProjectId = projectId ?? "PROJECT_ID";
  const safeEnvironmentId = environmentId ?? "ENVIRONMENT_ID";
  const keyScope = projectId && environmentId ? `${projectId} / ${environmentId}` : "select project / environment";
  const sdkSnippet = `import { createSignalMonitorClient } from "@sigmon/sdk";

const signalMonitor = createSignalMonitorClient({
  endpoint: "${endpoint}",
  apiKey: "${apiKey}"
});

// Key scope: ${keyScope}
signalMonitor.track("checkout.started", {
  plan: "team"
});

await signalMonitor.flush();`;
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
  const envSnippet = `SIGMON_ENDPOINT=${endpoint}
SIGMON_API_KEY=${apiKey}
SIGMON_PROJECT_ID=${safeProjectId}
SIGMON_ENVIRONMENT_ID=${safeEnvironmentId}`;

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
