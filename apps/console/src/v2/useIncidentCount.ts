import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";

/** Unknown stays unknown; responses from previous scopes never replace the current count. */
export function useIncidentCount(client: ApiClient, projectId: string | undefined, environmentId: string | undefined, revision: number): number | null {
  const scope = `${projectId ?? ""}/${environmentId ?? ""}`;
  const [result, setResult] = useState<{ scope: string; count: number | null } | null>(null);
  useEffect(() => {
    let active = true;
    let busy = false;
    setResult(null);
    const refresh = async () => {
      if (!projectId || !environmentId || !client.getOperations || busy) return;
      busy = true;
      try {
        const response = await client.getOperations({ projectId, environmentId, window: "24h" });
        const incidents = response.data.summary.incidents;
        const count = incidents.open + incidents.investigating;
        if (active) setResult({ scope, count: Number.isFinite(count) && count >= 0 ? count : null });
      } catch {
        if (active) setResult({ scope, count: null });
      } finally { busy = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [client, projectId, environmentId, scope, revision]);
  return result?.scope === scope ? result.count : null;
}
