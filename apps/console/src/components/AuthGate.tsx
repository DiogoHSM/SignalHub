import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { ApiError, type ApiClient } from "../api/client";
import type { User } from "../api/types";

type AuthGateProps = {
  client: ApiClient;
  children: ReactNode;
};

type AuthState =
  | { status: "loading" }
  | { status: "login" }
  | { status: "authenticated"; user: User }
  | { status: "denied"; user: User }
  | { status: "unavailable" };

function isAuthStatus(error: unknown): boolean {
  return error instanceof ApiError && [400, 401, 403].includes(error.status);
}

export function AuthGate({ client, children }: AuthGateProps) {
  const [authState, setAuthState] = useState<AuthState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function loadSession(isCancelled: () => boolean = () => false) {
    setAuthState({ status: "loading" });

    try {
      const { user } = await client.getMe();
      if (isCancelled()) return;
      setAuthState(user.isAdmin ? { status: "authenticated", user } : { status: "denied", user });
    } catch (error) {
      if (isCancelled()) return;
      setAuthState(error instanceof ApiError && error.status === 401 ? { status: "login" } : { status: "unavailable" });
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadSession(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [client]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    setSubmitting(true);

    try {
      const { user } = await client.login(email, password);
      setAuthState(user.isAdmin ? { status: "authenticated", user } : { status: "denied", user });
    } catch (error) {
      setLoginError(isAuthStatus(error) ? "Invalid email or password" : "Console service unavailable");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      await client.logout();
    } catch {
      // Denied users need a local escape hatch even if the logout endpoint is unavailable.
    } finally {
      setAuthState({ status: "login" });
    }
  }

  if (authState.status === "loading") {
    return (
      <div className="center-panel">
        <p>Loading...</p>
      </div>
    );
  }

  if (authState.status === "denied") {
    return (
      <div className="center-panel">
        <h1>Admin access required</h1>
        <p>{authState.user.email}</p>
        <button onClick={handleSignOut} type="button">
          Sign out
        </button>
      </div>
    );
  }

  if (authState.status === "unavailable") {
    return (
      <div className="center-panel">
        <h1>Console unavailable</h1>
        <button onClick={() => loadSession()} type="button">
          Retry
        </button>
      </div>
    );
  }

  if (authState.status === "authenticated") {
    return <>{children}</>;
  }

  return (
    <main className="auth-page">
      <form className="auth-form" onSubmit={handleSubmit}>
        <h1>Sign in</h1>
        <label>
          Email
          <input
            autoComplete="email"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        {loginError ? <p className="form-error">{loginError}</p> : null}
        <button disabled={submitting} type="submit">
          Sign in
        </button>
      </form>
    </main>
  );
}
