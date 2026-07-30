import { useEffect, useState } from "react";
import { createApiClient } from "./api/client";
import { AuthGate } from "./components/AuthGate";
import { ConsoleShellV2 } from "./v2/ConsoleShellV2";

const bootstrapClient = createApiClient();

type RuntimeState =
  | { status: "loading" }
  | {
      status: "ready";
      client: ReturnType<typeof createApiClient>;
      apiBasePath: string;
      apiEndpoint: string;
      googleOAuthEnabled: boolean;
    }
  | { status: "unavailable" };

export function App() {
  const [runtime, setRuntime] = useState<RuntimeState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    void bootstrapClient.getConsoleConfig().then(
      (config) => {
        if (cancelled) return;
        setRuntime({
          status: "ready",
          client: createApiClient(config.apiBasePath),
          apiBasePath: config.apiBasePath,
          apiEndpoint: config.apiEndpoint,
          googleOAuthEnabled: config.googleOAuthEnabled
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
    <AuthGate
      apiBasePath={runtime.apiBasePath}
      client={runtime.client}
      googleOAuthEnabled={runtime.googleOAuthEnabled}
    >
      {({ user, signOut }) => (
        <ConsoleShellV2 client={runtime.client} apiEndpoint={runtime.apiEndpoint} user={user} onSignOut={signOut} />
      )}
    </AuthGate>
  );
}
