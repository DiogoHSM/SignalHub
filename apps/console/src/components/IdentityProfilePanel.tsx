type IdentityProfilePanelProps = {
  kind: "tenant" | "user";
  traits?: Record<string, unknown> | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  profileUpdatedAt?: string | null;
};

function formatTimestamp(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "none";
}

function formatTraitValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function IdentityProfilePanel({ kind, traits, firstSeenAt, lastSeenAt, profileUpdatedAt }: IdentityProfilePanelProps) {
  const entries = Object.entries(traits ?? {}).sort(([left], [right]) => left.localeCompare(right));
  const identifyMethod = kind === "tenant" ? "identifyTenant" : "identifyUser";

  return (
    <section className="identity-profile-panel" aria-label={`${kind} identity profile`}>
      <div className="identity-profile-panel__header">
        <div>
          <h3>Identity profile</h3>
          <p>Traits captured by identify calls for this project and environment.</p>
        </div>
      </div>
      <dl className="identity-profile-panel__meta">
        <div>
          <dt>Profile first seen</dt>
          <dd>{formatTimestamp(firstSeenAt)}</dd>
        </div>
        <div>
          <dt>Last activity</dt>
          <dd>{formatTimestamp(lastSeenAt)}</dd>
        </div>
        <div>
          <dt>Traits updated</dt>
          <dd>{formatTimestamp(profileUpdatedAt)}</dd>
        </div>
      </dl>
      {entries.length > 0 ? (
        <dl className="identity-traits-list">
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{formatTraitValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="identity-profile-empty">
          <strong>No identify traits yet.</strong>
          <span>Send {identifyMethod} traits from the SDK or REST API to build this profile.</span>
        </div>
      )}
    </section>
  );
}
