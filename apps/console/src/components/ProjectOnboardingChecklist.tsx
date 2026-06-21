import type { Environment } from "../api/types";

type Props = {
  activeEnvironment?: Environment;
  activeProjectId?: string;
  apiEndpoint?: string;
  latestSecret?: string;
};

export function ProjectOnboardingChecklist(_props: Props) {
  const props = _props;
  const endpoint = props.apiEndpoint ?? "SIGMON_ENDPOINT";
  const steps = [
    {
      label: "Project selected",
      description: props.activeProjectId ? "Project scope is ready for configuration." : "Create or select a project.",
      ready: Boolean(props.activeProjectId)
    },
    {
      label: props.activeEnvironment ? `${props.activeEnvironment.name} environment selected` : "Select an environment",
      description: props.activeEnvironment ? "Telemetry will be scoped to this environment." : "Create or select dev, preview, or production.",
      ready: Boolean(props.activeEnvironment)
    },
    {
      label: "API endpoint available",
      description: props.apiEndpoint ? props.apiEndpoint : "Set the public Sigmon endpoint used by SDK snippets.",
      ready: Boolean(props.apiEndpoint)
    },
    {
      label: props.latestSecret ? "API key secret copied" : "Create and copy an API key",
      description: props.latestSecret
        ? "Use this one-time secret in the app before leaving setup."
        : "Generate a key and copy the one-time secret before integrating the SDK.",
      ready: Boolean(props.latestSecret)
    },
    {
      label: "Install SDK package",
      description: "Add the official SDK to the app or service that will emit telemetry.",
      command: "npm install @sigmon/sdk",
      ready: false
    },
    {
      label: "Initialize SDK snippet",
      description: "Copy the SDK or Next.js snippet into the app entry point, route handler, or worker bootstrap.",
      command: `endpoint: "${endpoint}"`,
      ready: false
    },
    {
      label: "Send first ping",
      description: "Run the HTTP snippet or trigger the instrumented app, then confirm the connection check receives telemetry.",
      command: "POST /v1/events",
      ready: false
    }
  ];
  const readyCount = steps.filter((step) => step.ready).length;

  return (
    <section className="panel project-onboarding-checklist" aria-label="Project setup checklist">
      <div className="panel-header">
        <div>
          <h2>Setup checklist</h2>
          <p>Fast read of what this project still needs before SDK integration.</p>
        </div>
        <span className="status-pill status-pill--neutral">{readyCount} of {steps.length} ready</span>
      </div>
      <ol className="project-onboarding-checklist__steps">
        {steps.map((step) => (
          <li className={step.ready ? "is-ready" : "is-pending"} key={step.label}>
            <span aria-hidden="true" className="project-onboarding-checklist__marker">
              {step.ready ? "OK" : "!"}
            </span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.description}</p>
              {step.command ? <code className="project-onboarding-checklist__command">{step.command}</code> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
