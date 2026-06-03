import { useEffect, useState } from "react";
import { createApiClient } from "./api/client";
import type { ConsoleConfig } from "./api/types";
import { AuthGate } from "./components/AuthGate";
import { ConsoleShell } from "./components/ConsoleShell";

const bootstrapClient = createApiClient();

type RuntimeState =
  | { status: "loading" }
  | { status: "ready"; config: ConsoleConfig; client: ReturnType<typeof createApiClient> }
  | { status: "unavailable" };

function resolveApiEndpoint(apiEndpoint: string): string {
  return apiEndpoint || window.location.origin;
}

export function App() {
  const [runtime, setRuntime] = useState<RuntimeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void bootstrapClient.getConsoleConfig().then(
      (config) => {
        if (cancelled) return;
        setRuntime({
          status: "ready",
          config,
          client: createApiClient(config.apiBasePath)
        });
      },
      () => {
        if (cancelled) return;
        setRuntime({ status: "unavailable" });
      }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  if (runtime.status === "loading") {
    return (
      <div className="center-panel">
        <p>Loading...</p>
      </div>
    );
  }

  if (runtime.status === "unavailable") {
    return (
      <div className="center-panel">
        <h1>Console unavailable</h1>
      </div>
    );
  }

  return (
    <AuthGate client={runtime.client}>
      {({ user, signOut }) => (
        <ConsoleShell apiEndpoint={resolveApiEndpoint(runtime.config.apiEndpoint)} client={runtime.client} onSignOut={signOut} user={user} />
      )}
    </AuthGate>
  );
}
