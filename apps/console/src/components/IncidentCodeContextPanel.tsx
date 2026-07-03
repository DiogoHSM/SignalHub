import type { ErrorGroupIncident } from "../api/types";

type CodeContext = ErrorGroupIncident["codeContext"];

const missingCodeContext: CodeContext = {
  status: "limited",
  summary: "Code context is unavailable for this incident response. Refresh after the API deploy or connect release metadata and source maps.",
  repository: null,
  release: {
    release: null,
    commitSha: null,
    commitUrl: null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    deployedBy: null
  },
  suspectedFiles: [],
  evidence: [],
  suggestedNextSteps: [
    "Refresh the incident after the latest API deploy.",
    "Attach release metadata and upload source maps for stronger code context."
  ],
  privacy: {
    aiEnabled: false,
    outboundCodeSharing: false,
    reason: "No external AI provider is used for this local fallback."
  }
};

function formatLocation(file: CodeContext["suspectedFiles"][number]): string {
  const line = file.line == null ? "" : `:${file.line}`;
  const column = file.column == null ? "" : `:${file.column}`;
  return `${file.path}${line}${column}`;
}

function confidenceLabel(confidence: "high" | "medium" | "low"): string {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  return "Low confidence";
}

export function IncidentCodeContextPanel({
  codeContext,
  variant = "classic"
}: {
  codeContext?: CodeContext;
  variant?: "classic" | "v2";
}) {
  const context = codeContext ?? missingCodeContext;
  const isV2 = variant === "v2";
  const sectionClass = isV2 ? "sh-card incident-code-context-card" : "incident-code-context-panel";
  const bodyClass = isV2 ? "sh-card__body incident-code-context" : "incident-code-context";

  return (
    <section aria-label="Code context" className={sectionClass}>
      {isV2 ? (
        <div className="sh-card__head">
          <h2 className="sh-h2">Code context</h2>
          <span className={`sh-tag ${context.status === "ready" ? "ok" : "warn"}`}>
            {context.status}
          </span>
        </div>
      ) : (
        <header className="incident-code-context__header">
          <div>
            <p className="incident-code-context__eyebrow">AI-ready analysis</p>
            <h3>Code context</h3>
          </div>
          <span className={`incident-code-context__status ${context.status}`}>{context.status}</span>
        </header>
      )}

      <div className={bodyClass}>
        <p className="incident-code-context__summary">{context.summary}</p>

        <div className="incident-code-context__meta">
          <div>
            <span>Repository</span>
            {context.repository ? (
              <a href={context.repository.url} rel="noreferrer" target="_blank">
                {context.repository.owner}/{context.repository.repo}
              </a>
            ) : (
              <strong>Not connected</strong>
            )}
          </div>
          <div>
            <span>Release</span>
            <strong>{context.release.release ?? "none"}</strong>
          </div>
          <div>
            <span>Commit</span>
            {context.release.commitUrl ? (
              <a href={context.release.commitUrl} rel="noreferrer" target="_blank">
                {context.release.commitSha?.slice(0, 12) ?? "open commit"}
              </a>
            ) : (
              <strong>{context.release.commitSha?.slice(0, 12) ?? "none"}</strong>
            )}
          </div>
          <div>
            <span>Pull request</span>
            {context.release.pullRequestUrl ? (
              <a href={context.release.pullRequestUrl} rel="noreferrer" target="_blank">
                #{context.release.pullRequestNumber ?? "open"}
              </a>
            ) : (
              <strong>none</strong>
            )}
          </div>
        </div>

        <div className="incident-code-context__section">
          <h4>Probable files</h4>
          {context.suspectedFiles.length === 0 ? (
            <p className="muted-text">No probable files yet. Add release metadata and source maps for stronger evidence.</p>
          ) : (
            <div className="incident-code-context__files">
              {context.suspectedFiles.map((file) => (
                <div className="incident-code-context__file" key={`${file.path}:${file.line ?? ""}:${file.column ?? ""}`}>
                  <div>
                    <strong>{formatLocation(file)}</strong>
                    {file.functionName ? <span>{file.functionName}</span> : null}
                  </div>
                  <span className={`incident-code-context__confidence ${file.confidence}`}>
                    {confidenceLabel(file.confidence)}
                  </span>
                  <small>{file.evidence.join(" · ")}</small>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="incident-code-context__section">
          <h4>Evidence</h4>
          <div className="incident-code-context__evidence">
            {context.evidence.map((item) => (
              <div key={`${item.type}:${item.label}`} className="incident-code-context__evidence-item">
                <strong>{item.label}</strong>
                <span>{item.value ?? "none"}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="incident-code-context__section">
          <h4>Next steps</h4>
          <ol>
            {context.suggestedNextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="incident-code-context__privacy">
          <strong>{context.privacy.aiEnabled ? "AI enabled" : "External AI disabled"}</strong>
          <span>{context.privacy.reason}</span>
        </div>
      </div>
    </section>
  );
}
