import type { Environment } from "../api/types";

type Props = {
  activeEnvironment?: Environment;
  activeProjectId?: string;
  apiEndpoint?: string;
  latestSecret?: string;
};

export function ProjectOnboardingChecklist(_props: Props) {
  const props = _props;
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
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
