import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ErrorGroupRecord, ErrorGroupStatus } from "../api/types";

type Props = {
  client: ApiClient;
  group?: ErrorGroupRecord;
  projectId: string;
  environmentId: string;
  onStatusUpdated: (group: ErrorGroupRecord) => void;
};

type SaveState = "idle" | "saving" | "unavailable";

const statusOptions: ErrorGroupStatus[] = ["open", "investigating", "resolved", "ignored"];

function detailValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "none" : String(value);
}

function formatTimestamp(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "none";
}

export function ErrorGroupDetail({ client, group, projectId, environmentId, onStatusUpdated }: Props) {
  const [draftStatus, setDraftStatus] = useState<ErrorGroupStatus>("open");
  const [saveState, setSaveState] = useState<SaveState>("idle");

  useEffect(() => {
    setDraftStatus(group?.status ?? "open");
    setSaveState("idle");
  }, [group?.id, group?.status]);

  if (!group) {
    return (
      <aside className="detail-drawer">
        <p className="muted-text">Select an error group to inspect its details.</p>
      </aside>
    );
  }

  function saveStatus() {
    if (!group) return;

    setSaveState("saving");
    void client
      .updateErrorGroupStatus(group.id, {
        projectId,
        environmentId,
        status: draftStatus
      })
      .then(
        ({ data }) => {
          onStatusUpdated(data);
          setSaveState("idle");
        },
        () => {
          setSaveState("unavailable");
        }
      );
  }

  return (
    <aside className="detail-drawer error-group-detail">
      <div className="panel-header">
        <h2>{group.message}</h2>
      </div>
      <div className="error-group-status-form">
        <label>
          Group status
          <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as ErrorGroupStatus)}>
            {statusOptions.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button disabled={saveState === "saving"} onClick={saveStatus} type="button">
          {saveState === "saving" ? "Saving" : "Save status"}
        </button>
      </div>
      {saveState === "unavailable" ? <p className="muted-text">Status update failed.</p> : null}
      <dl className="detail-grid">
        <dt>ID</dt>
        <dd>
          <code>{group.id}</code>
        </dd>
        <dt>Project</dt>
        <dd>{group.projectId}</dd>
        <dt>Environment</dt>
        <dd>{group.environmentId}</dd>
        <dt>Type</dt>
        <dd>{detailValue(group.type)}</dd>
        <dt>Severity</dt>
        <dd>{group.severity}</dd>
        <dt>Status</dt>
        <dd>{group.status}</dd>
        <dt>Fingerprint</dt>
        <dd>{group.groupingFingerprint}</dd>
        <dt>Top frame</dt>
        <dd>{detailValue(group.topStackFrame)}</dd>
        <dt>Occurrences</dt>
        <dd>{group.occurrenceCount}</dd>
        <dt>Users</dt>
        <dd>{group.affectedUsersCount}</dd>
        <dt>Tenants</dt>
        <dd>{group.affectedTenantsCount}</dd>
        <dt>Latest error</dt>
        <dd>{detailValue(group.latestErrorId)}</dd>
        <dt>Latest release</dt>
        <dd>{detailValue(group.latestRelease)}</dd>
        <dt>First seen</dt>
        <dd>{formatTimestamp(group.firstSeenAt)}</dd>
        <dt>Last seen</dt>
        <dd>{formatTimestamp(group.lastSeenAt)}</dd>
        <dt>Last regressed</dt>
        <dd>{formatTimestamp(group.lastRegressedAt)}</dd>
        <dt>Resolved</dt>
        <dd>{formatTimestamp(group.resolvedAt)}</dd>
        <dt>Ignored</dt>
        <dd>{formatTimestamp(group.ignoredAt)}</dd>
      </dl>
    </aside>
  );
}
