import { createApiClient } from "./api/client";
import { AuthGate } from "./components/AuthGate";

const client = createApiClient();

export function App() {
  return (
    <AuthGate client={client}>
      <main className="app-shell">
        <section className="empty-state">
          <h1>SignalHub Console</h1>
          <p>Authenticated console ready.</p>
        </section>
      </main>
    </AuthGate>
  );
}
