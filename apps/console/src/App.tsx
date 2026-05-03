import { createApiClient } from "./api/client";
import { AuthGate } from "./components/AuthGate";
import { ConsoleShell } from "./components/ConsoleShell";

const client = createApiClient();

export function App() {
  return (
    <AuthGate client={client}>
      <ConsoleShell client={client} />
    </AuthGate>
  );
}
