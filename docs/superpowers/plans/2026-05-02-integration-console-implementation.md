# Integration Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first admin-only SignalHub web console for managing projects, environments, API keys, generated integration snippets, and a lightweight connection check.

**Architecture:** Add `apps/console` as a Vite + React + TypeScript app. The API exposes a non-secret console config route and serves the built console assets in production. The browser uses existing session auth, admin routes, and query routes; API key secrets are held only in component memory immediately after creation.

**Tech Stack:** pnpm workspace, TypeScript, Fastify, `@fastify/static`, Vite, React, Vitest, Testing Library, jsdom, Docker Compose.

---

## File Structure

- Create `apps/console/package.json`: console package scripts and dependencies.
- Create `apps/console/index.html`: Vite HTML entry.
- Create `apps/console/tsconfig.json`: console TypeScript config.
- Create `apps/console/vite.config.ts`: Vite dev/test config with API proxy and jsdom.
- Create `apps/console/src/main.tsx`: React bootstrap.
- Create `apps/console/src/App.tsx`: top-level auth gate and console shell composition.
- Create `apps/console/src/api/client.ts`: typed API wrapper for auth, admin resources, query checks, and users.
- Create `apps/console/src/api/types.ts`: shared frontend API types.
- Create `apps/console/src/components/AuthGate.tsx`: session resolution, login, denied state, and logout handoff.
- Create `apps/console/src/components/ConsoleShell.tsx`: app layout, active project/environment state, and panel coordination.
- Create `apps/console/src/components/ProjectSwitcher.tsx`: project list/create/rename/archive/select.
- Create `apps/console/src/components/EnvironmentSelector.tsx`: environment list/create/rename/archive/select.
- Create `apps/console/src/components/ApiKeyPanel.tsx`: API key list/create/revoke and one-time secret display.
- Create `apps/console/src/components/SnippetPanel.tsx`: SDK, HTTP, and env snippet generation.
- Create `apps/console/src/components/ConnectionCheck.tsx`: recent telemetry check using query endpoints.
- Create `apps/console/src/components/UserAdminPanel.tsx`: simple admin user list/create/archive.
- Create `apps/console/src/styles.css`: compact infrastructure UI styling.
- Create `apps/console/src/test/setup.ts`: Testing Library setup.
- Create focused tests beside components under `apps/console/src/**/*.test.tsx`.
- Modify `package.json`: add root `dev:console` and keep recursive build/test working.
- Modify `apps/api/package.json`: add `@fastify/static`.
- Modify `apps/api/src/app.ts`: register console config and static routes.
- Create `apps/api/src/routes/console.ts`: `GET /console/config` plus production asset serving helper.
- Modify `apps/api/src/main.ts`: pass console options into `buildApp`.
- Modify `Dockerfile`: copy `apps/console` and allow workspace install/build/test to include it.
- Modify `.claude/docs/ARCHITECTURE.md`, `.claude/docs/STACK.md`, `.claude/docs/DEPLOYMENT.md`, `.claude/docs/UI-UX.md`: document the console architecture and operation.

## Task 1: Backend Console Config And Asset Delivery

**Files:**
- Create: `apps/api/src/routes/console.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/test/console.test.ts`

- [ ] **Step 1: Add failing API tests for console config and admin-independent asset behavior**

Create `apps/api/test/console.test.ts`:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const readiness = async () => ({ postgres: true, redis: true });

describe("console routes", () => {
  it("returns non-secret console runtime config", async () => {
    app = await buildApp({
      readiness,
      googleOAuthEnabled: true,
      console: {
        enabled: false,
        apiBasePath: "/"
      }
    });

    const response = await app.inject({ method: "GET", url: "/console/config" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      apiBasePath: "/",
      googleOAuthEnabled: true
    });
  });

  it("serves built console index when console assets are configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "signalhub-console-"));
    await writeFile(join(dir, "index.html"), "<!doctype html><div id=\"root\"></div>");

    app = await buildApp({
      readiness,
      googleOAuthEnabled: false,
      console: {
        enabled: true,
        apiBasePath: "/",
        assetsDir: dir
      }
    });

    const response = await app.inject({ method: "GET", url: "/console" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("<div id=\"root\"></div>");
  });

  it("returns 404 for console assets when static serving is disabled", async () => {
    app = await buildApp({
      readiness,
      googleOAuthEnabled: false,
      console: {
        enabled: false,
        apiBasePath: "/"
      }
    });

    const response = await app.inject({ method: "GET", url: "/console" });

    expect(response.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run the failing API test**

Run:

```bash
pnpm test apps/api/test/console.test.ts
```

Expected: fail because `buildApp` does not accept `console` options and `/console/config` is not registered.

- [ ] **Step 3: Add static dependency**

Run:

```bash
pnpm --filter @signal-hub/api add @fastify/static
```

Expected: `apps/api/package.json` and `pnpm-lock.yaml` update with `@fastify/static`.

- [ ] **Step 4: Implement console routes**

Create `apps/api/src/routes/console.ts`:

```ts
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { join } from "node:path";

export type ConsoleRouteOptions = {
  enabled: boolean;
  apiBasePath: string;
  assetsDir?: string;
  googleOAuthEnabled: boolean;
};

export async function registerConsoleRoutes(app: FastifyInstance, options: ConsoleRouteOptions): Promise<void> {
  app.get("/console/config", async (_request, reply) =>
    reply.send({
      apiBasePath: options.apiBasePath,
      googleOAuthEnabled: options.googleOAuthEnabled
    })
  );

  if (!options.enabled || !options.assetsDir) {
    return;
  }

  await app.register(fastifyStatic, {
    root: options.assetsDir,
    prefix: "/console/assets/"
  });

  app.get("/console", async (_request, reply) => reply.sendFile("index.html", options.assetsDir));
  app.get("/console/*", async (request, reply) => {
    const url = request.url;
    if (url.startsWith("/console/assets/")) {
      return reply.callNotFound();
    }

    return reply.sendFile("index.html", options.assetsDir);
  });
}

export function defaultConsoleAssetsDir(): string {
  return join(process.cwd(), "apps", "console", "dist");
}
```

- [ ] **Step 5: Wire console routes into the API app**

Modify `apps/api/src/app.ts`:

```ts
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { registerRequestContext } from "./plugins/request-context.js";
import {
  registerAdminRoutes,
  type AdminResourceDependencies,
  type UserAdministrationDependencies
} from "./routes/admin.js";
import { registerAuthRoutes, type AuthDependencies } from "./routes/auth.js";
import { registerConsoleRoutes, type ConsoleRouteOptions } from "./routes/console.js";
import { registerHealthRoutes, type ReadinessCheck } from "./routes/health.js";
import { registerIngestionRoutes, type IngestionDependencies } from "./routes/ingestion.js";
import { registerQueryRoutes, type QueryDependencies } from "./routes/query.js";

export type BuildAppOptions = {
  readiness: ReadinessCheck;
  auth?: AuthDependencies;
  users?: UserAdministrationDependencies;
  adminResources?: AdminResourceDependencies;
  ingestion?: IngestionDependencies;
  query?: QueryDependencies;
  apiKeyPepper?: string;
  hashApiKeySecret?: (secret: string) => Promise<string>;
  googleOAuthEnabled?: boolean;
  corsOrigin?: string | string[];
  console?: Omit<ConsoleRouteOptions, "googleOAuthEnabled">;
};

export async function buildApp(options: BuildAppOptions) {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: options.corsOrigin ?? false,
    credentials: options.corsOrigin !== undefined
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });

  registerRequestContext(app);
  registerHealthRoutes(app, options.readiness);
  registerAuthRoutes(app, {
    auth: options.auth,
    googleOAuthEnabled: options.googleOAuthEnabled
  });
  await registerConsoleRoutes(app, {
    enabled: options.console?.enabled ?? false,
    apiBasePath: options.console?.apiBasePath ?? "/",
    assetsDir: options.console?.assetsDir,
    googleOAuthEnabled: options.googleOAuthEnabled ?? false
  });
  registerAdminRoutes(app, {
    auth: options.auth,
    users: options.users,
    adminResources: options.adminResources,
    apiKeyPepper: options.apiKeyPepper,
    hashApiKeySecret: options.hashApiKeySecret
  });
  registerIngestionRoutes(app, options.ingestion);
  registerQueryRoutes(app, {
    auth: options.auth,
    query: options.query
  });

  return app;
}
```

- [ ] **Step 6: Enable console serving from the API entrypoint**

Modify the final `buildApp` call in `apps/api/src/main.ts` so the options include:

```ts
  apiKeyPepper: config.apiKeyPepper,
  googleOAuthEnabled: config.googleOAuth.enabled,
  console: {
    enabled: config.nodeEnv === "production",
    apiBasePath: "/",
    assetsDir: config.nodeEnv === "production" ? new URL("../../console/dist", import.meta.url).pathname : undefined
  }
});
```

- [ ] **Step 7: Run backend verification**

Run:

```bash
pnpm test apps/api/test/console.test.ts
pnpm --filter @signal-hub/api build
```

Expected: both commands pass.

- [ ] **Step 8: Commit backend console delivery**

Run:

```bash
git add package.json pnpm-lock.yaml apps/api/package.json apps/api/src/app.ts apps/api/src/main.ts apps/api/src/routes/console.ts apps/api/test/console.test.ts
git commit -m "feat: add console runtime routes"
```

## Task 2: Scaffold The Console App

**Files:**
- Create: `apps/console/package.json`
- Create: `apps/console/index.html`
- Create: `apps/console/tsconfig.json`
- Create: `apps/console/vite.config.ts`
- Create: `apps/console/src/main.tsx`
- Create: `apps/console/src/App.tsx`
- Create: `apps/console/src/styles.css`
- Create: `apps/console/src/test/setup.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the console package files**

Create `apps/console/package.json`:

```json
{
  "name": "@signal-hub/console",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit && vite build",
    "dev": "vite --host 0.0.0.0",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "lucide-react": "^0.468.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.1",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

Create `apps/console/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SignalHub Console</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `apps/console/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `apps/console/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/console/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/auth": "http://localhost:3000",
      "/admin": "http://localhost:3000",
      "/query": "http://localhost:3000",
      "/console/config": "http://localhost:3000"
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
});
```

Create `apps/console/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `apps/console/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

Create `apps/console/src/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <section className="empty-state">
        <h1>SignalHub Console</h1>
        <p>Console scaffold ready.</p>
      </section>
    </main>
  );
}
```

Create `apps/console/src/styles.css`:

```css
:root {
  color: #111827;
  background: #f6f7f9;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

button,
input,
select {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
}

.empty-state {
  display: grid;
  min-height: 100vh;
  place-items: center;
  text-align: center;
}
```

- [ ] **Step 2: Install the console package dependencies**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updates and `pnpm --filter @signal-hub/console build` can resolve React, Vite, and Testing Library packages.

- [ ] **Step 3: Add package scripts**

Modify root `package.json` scripts to include:

```json
{
  "dev:console": "pnpm --filter @signal-hub/console dev",
  "build:console": "pnpm --filter @signal-hub/console build"
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: Create the console package files**

- [ ] **Step 4: Run scaffold verification**

Run:

```bash
pnpm --filter @signal-hub/console build
pnpm --filter @signal-hub/console test
pnpm build
```

Expected: all commands pass and `apps/console/dist` is created by the console build.

- [ ] **Step 5: Commit the console scaffold**

Run:

```bash
git add package.json pnpm-lock.yaml apps/console
git commit -m "feat: scaffold web console"
```

## Task 3: Auth Gate And API Client

**Files:**
- Create: `apps/console/src/api/types.ts`
- Create: `apps/console/src/api/client.ts`
- Create: `apps/console/src/components/AuthGate.tsx`
- Modify: `apps/console/src/App.tsx`
- Test: `apps/console/src/components/AuthGate.test.tsx`

- [ ] **Step 1: Write auth gate tests**

Create `apps/console/src/components/AuthGate.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthGate } from "./AuthGate";
import type { ApiClient } from "../api/client";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

describe("AuthGate", () => {
  it("renders children for admin users", async () => {
    render(
      <AuthGate
        client={client({
          getMe: vi.fn().mockResolvedValue({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } })
        })}
      >
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByText("Console loaded")).toBeInTheDocument();
  });

  it("shows login form when unauthenticated", async () => {
    render(
      <AuthGate client={client({ getMe: vi.fn().mockRejectedValue({ status: 401 }) })}>
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByLabelText("Email")).toBeInTheDocument();
    expect(screen.queryByText("Console loaded")).not.toBeInTheDocument();
  });

  it("logs in and renders children", async () => {
    const api = client({
      getMe: vi.fn().mockRejectedValue({ status: 401 }),
      login: vi.fn().mockResolvedValue({ user: { id: "usr_1", email: "admin@example.com", isAdmin: true } })
    });

    render(
      <AuthGate client={api}>
        <div>Console loaded</div>
      </AuthGate>
    );

    await userEvent.type(await screen.findByLabelText("Email"), "admin@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "very-secure-password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(api.login).toHaveBeenCalledWith("admin@example.com", "very-secure-password"));
    expect(await screen.findByText("Console loaded")).toBeInTheDocument();
  });

  it("blocks authenticated non-admin users", async () => {
    render(
      <AuthGate
        client={client({
          getMe: vi.fn().mockResolvedValue({ user: { id: "usr_2", email: "user@example.com", isAdmin: false } })
        })}
      >
        <div>Console loaded</div>
      </AuthGate>
    );

    expect(await screen.findByText("Admin access required")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing auth tests**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/AuthGate.test.tsx
```

Expected: fail because the API client and `AuthGate` do not exist.

- [ ] **Step 3: Implement API types and client**

Create `apps/console/src/api/types.ts`:

```ts
export type User = {
  id: string;
  email: string;
  isAdmin: boolean;
};

export type Project = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type Environment = {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type ApiKey = {
  id: string;
  projectId: string;
  environmentId: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CreatedApiKey = ApiKey & {
  secret: string;
};

export type ConsoleConfig = {
  apiBasePath: string;
  googleOAuthEnabled: boolean;
};

export type QueryListResponse<T> = {
  data: T[];
  cursor?: string;
};

export type AggregateResponse<T> = {
  data: T;
};
```

Create `apps/console/src/api/client.ts`:

```ts
import type {
  AggregateResponse,
  ApiKey,
  ConsoleConfig,
  CreatedApiKey,
  Environment,
  Project,
  QueryListResponse,
  User
} from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(code);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new ApiError(response.status, json.error ?? "request_failed");
  }

  return json as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    },
    ...init
  });
  return parseResponse<T>(response);
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient() {
  return {
    getConsoleConfig: () => request<ConsoleConfig>("/console/config"),
    getMe: () => request<{ user: User }>("/auth/me"),
    login: (email: string, password: string) =>
      request<{ user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    listProjects: () => request<{ projects: Project[] }>("/admin/projects"),
    createProject: (name: string) =>
      request<{ project: Project }>("/admin/projects", {
        method: "POST",
        body: JSON.stringify({ name })
      }),
    updateProject: (id: string, name: string) =>
      request<{ project: Project }>(`/admin/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      }),
    archiveProject: (id: string) => request<void>(`/admin/projects/${id}`, { method: "DELETE" }),
    listEnvironments: (projectId: string) => request<{ environments: Environment[] }>(`/admin/projects/${projectId}/environments`),
    createEnvironment: (projectId: string, name: string) =>
      request<{ environment: Environment }>(`/admin/projects/${projectId}/environments`, {
        method: "POST",
        body: JSON.stringify({ name })
      }),
    updateEnvironment: (id: string, name: string) =>
      request<{ environment: Environment }>(`/admin/environments/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name })
      }),
    archiveEnvironment: (id: string) => request<void>(`/admin/environments/${id}`, { method: "DELETE" }),
    listApiKeys: (projectId: string) => request<{ apiKeys: ApiKey[] }>(`/admin/projects/${projectId}/api-keys`),
    createApiKey: (projectId: string, environmentId: string, name: string) =>
      request<{ apiKey: CreatedApiKey }>(`/admin/projects/${projectId}/api-keys`, {
        method: "POST",
        body: JSON.stringify({ environmentId, name })
      }),
    revokeApiKey: (id: string) => request<void>(`/admin/api-keys/${id}`, { method: "DELETE" }),
    listEvents: (projectId: string, environmentId: string) =>
      request<QueryListResponse<unknown>>(`/query/events?project_id=${projectId}&environment_id=${environmentId}&limit=1`),
    listErrors: (projectId: string, environmentId: string) =>
      request<QueryListResponse<unknown>>(`/query/errors?project_id=${projectId}&environment_id=${environmentId}&limit=1`),
    getEventAggregates: (projectId: string, environmentId: string) =>
      request<AggregateResponse<unknown>>(`/query/aggregates/events?project_id=${projectId}&environment_id=${environmentId}`),
    getErrorAggregates: (projectId: string, environmentId: string) =>
      request<AggregateResponse<unknown>>(`/query/aggregates/errors?project_id=${projectId}&environment_id=${environmentId}`),
    listUsers: () => request<{ users: User[] }>("/admin/users"),
    createUser: (email: string, password: string, isAdmin: boolean) =>
      request<{ user: User }>("/admin/users", {
        method: "POST",
        body: JSON.stringify({ email, password, isAdmin })
      }),
    updateUser: (id: string, input: Partial<Pick<User, "email" | "isAdmin">> & { password?: string }) =>
      request<{ user: User }>(`/admin/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input)
      }),
    archiveUser: (id: string) => request<void>(`/admin/users/${id}`, { method: "DELETE" })
  };
}
```

- [ ] **Step 4: Implement AuthGate**

Create `apps/console/src/components/AuthGate.tsx`:

```tsx
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { User } from "../api/types";

type AuthState =
  | { status: "loading" }
  | { status: "login"; message?: string }
  | { status: "denied"; user: User }
  | { status: "authenticated"; user: User };

export function AuthGate({ client, children }: { client: ApiClient; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let cancelled = false;

    client.getMe().then(
      ({ user }) => {
        if (cancelled) return;
        setState(user.isAdmin ? { status: "authenticated", user } : { status: "denied", user });
      },
      () => {
        if (cancelled) return;
        setState({ status: "login" });
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const { user } = await client.login(email, password);
      setState(user.isAdmin ? { status: "authenticated", user } : { status: "denied", user });
    } catch {
      setState({ status: "login", message: "Invalid email or password" });
    }
  }

  if (state.status === "loading") {
    return <div className="center-panel">Loading console...</div>;
  }

  if (state.status === "denied") {
    return (
      <div className="center-panel">
        <h1>Admin access required</h1>
        <p>{state.user.email} is signed in, but this console is limited to administrators.</p>
      </div>
    );
  }

  if (state.status === "login") {
    return (
      <main className="auth-page">
        <form className="auth-form" onSubmit={submit}>
          <h1>SignalHub Console</h1>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {state.message ? <p className="form-error">{state.message}</p> : null}
          <button type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  return <>{children}</>;
}
```

Modify `apps/console/src/App.tsx`:

```tsx
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
```

- [ ] **Step 5: Add required auth styles**

Append to `apps/console/src/styles.css`:

```css
.auth-page,
.center-panel {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px;
}

.auth-form {
  display: grid;
  width: min(100%, 380px);
  gap: 14px;
  padding: 24px;
  border: 1px solid #d7dde7;
  border-radius: 8px;
  background: #fff;
}

.auth-form h1 {
  margin: 0 0 8px;
  font-size: 22px;
}

.auth-form label {
  display: grid;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}

.auth-form input {
  min-height: 38px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 8px 10px;
}

.auth-form button {
  min-height: 38px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
}

.form-error {
  margin: 0;
  color: #b91c1c;
  font-size: 13px;
}
```

- [ ] **Step 6: Run auth verification**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/AuthGate.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: both commands pass.

- [ ] **Step 7: Commit auth gate**

Run:

```bash
git add apps/console/src
git commit -m "feat: add console auth gate"
```

## Task 4: Project And Environment Workspace

**Files:**
- Create: `apps/console/src/components/ConsoleShell.tsx`
- Create: `apps/console/src/components/ProjectSwitcher.tsx`
- Create: `apps/console/src/components/EnvironmentSelector.tsx`
- Modify: `apps/console/src/App.tsx`
- Modify: `apps/console/src/styles.css`
- Test: `apps/console/src/components/ConsoleShell.test.tsx`

- [ ] **Step 1: Write workspace tests**

Create `apps/console/src/components/ConsoleShell.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConsoleShell } from "./ConsoleShell";
import type { ApiClient } from "../api/client";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn().mockResolvedValue({ projects: [] }),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn().mockResolvedValue({ environments: [] }),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [] }),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn().mockResolvedValue({ users: [] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

describe("ConsoleShell", () => {
  it("loads projects and environments for the selected project", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      listEnvironments: vi.fn().mockResolvedValue({
        environments: [{ id: "env_1", projectId: "prj_1", name: "Production", createdAt: "", updatedAt: "", archivedAt: null }]
      })
    });

    render(<ConsoleShell client={api} />);

    expect(await screen.findByRole("button", { name: "Acme App" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Production" })).toBeInTheDocument();
    expect(api.listEnvironments).toHaveBeenCalledWith("prj_1");
  });

  it("creates a project and selects it", async () => {
    const api = client({
      createProject: vi.fn().mockResolvedValue({
        project: { id: "prj_2", name: "New Project", createdAt: "", updatedAt: "", archivedAt: null }
      })
    });

    render(<ConsoleShell client={api} />);

    await userEvent.type(await screen.findByLabelText("New project name"), "New Project");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith("New Project"));
    expect(await screen.findByRole("heading", { name: "New Project" })).toBeInTheDocument();
  });

  it("creates an environment under the selected project", async () => {
    const api = client({
      listProjects: vi.fn().mockResolvedValue({
        projects: [{ id: "prj_1", name: "Acme App", createdAt: "", updatedAt: "", archivedAt: null }]
      }),
      createEnvironment: vi.fn().mockResolvedValue({
        environment: { id: "env_2", projectId: "prj_1", name: "Staging", createdAt: "", updatedAt: "", archivedAt: null }
      })
    });

    render(<ConsoleShell client={api} />);

    await userEvent.type(await screen.findByLabelText("New environment name"), "Staging");
    await userEvent.click(screen.getByRole("button", { name: "Create environment" }));

    await waitFor(() => expect(api.createEnvironment).toHaveBeenCalledWith("prj_1", "Staging"));
    expect(await screen.findByRole("button", { name: "Staging" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing workspace tests**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/ConsoleShell.test.tsx
```

Expected: fail because workspace components do not exist.

- [ ] **Step 3: Implement project and environment components**

Create `apps/console/src/components/ProjectSwitcher.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import type { Project } from "../api/types";

type Props = {
  projects: Project[];
  activeProjectId?: string;
  onSelect: (project: Project) => void;
  onCreate: (name: string) => Promise<void>;
};

export function ProjectSwitcher({ projects, activeProjectId, onSelect, onCreate }: Props) {
  const [name, setName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await onCreate(trimmed);
    setName("");
  }

  return (
    <aside className="project-sidebar">
      <div className="section-label">Projects</div>
      <div className="project-list">
        {projects.map((project) => (
          <button
            key={project.id}
            className={project.id === activeProjectId ? "nav-item active" : "nav-item"}
            type="button"
            onClick={() => onSelect(project)}
          >
            {project.name}
          </button>
        ))}
      </div>
      <form className="compact-form" onSubmit={submit}>
        <label>
          New project name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit">Create project</button>
      </form>
    </aside>
  );
}
```

Create `apps/console/src/components/EnvironmentSelector.tsx`:

```tsx
import { type FormEvent, useState } from "react";
import type { Environment } from "../api/types";

type Props = {
  environments: Environment[];
  activeEnvironmentId?: string;
  disabled: boolean;
  onSelect: (environment: Environment) => void;
  onCreate: (name: string) => Promise<void>;
};

export function EnvironmentSelector({ environments, activeEnvironmentId, disabled, onSelect, onCreate }: Props) {
  const [name, setName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || disabled) return;
    await onCreate(trimmed);
    setName("");
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Environments</h2>
      </div>
      <div className="button-row">
        {environments.map((environment) => (
          <button
            key={environment.id}
            className={environment.id === activeEnvironmentId ? "pill active" : "pill"}
            type="button"
            onClick={() => onSelect(environment)}
          >
            {environment.name}
          </button>
        ))}
      </div>
      <form className="inline-form" onSubmit={submit}>
        <label>
          New environment name
          <input value={name} onChange={(event) => setName(event.target.value)} disabled={disabled} />
        </label>
        <button type="submit" disabled={disabled}>
          Create environment
        </button>
      </form>
    </section>
  );
}
```

Create `apps/console/src/components/ConsoleShell.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { ProjectSwitcher } from "./ProjectSwitcher";

export function ConsoleShell({ client }: { client: ApiClient }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [activeProject, setActiveProject] = useState<Project | undefined>();
  const [activeEnvironment, setActiveEnvironment] = useState<Environment | undefined>();

  useEffect(() => {
    void client.listProjects().then(({ projects }) => {
      setProjects(projects);
      setActiveProject((current) => current ?? projects[0]);
    });
  }, [client]);

  useEffect(() => {
    if (!activeProject) {
      setEnvironments([]);
      setActiveEnvironment(undefined);
      return;
    }

    void client.listEnvironments(activeProject.id).then(({ environments }) => {
      setEnvironments(environments);
      setActiveEnvironment((current) => current ?? environments[0]);
    });
  }, [client, activeProject]);

  async function createProject(name: string) {
    const { project } = await client.createProject(name);
    setProjects((current) => [...current, project]);
    setActiveProject(project);
    setActiveEnvironment(undefined);
  }

  async function createEnvironment(name: string) {
    if (!activeProject) return;
    const { environment } = await client.createEnvironment(activeProject.id, name);
    setEnvironments((current) => [...current, environment]);
    setActiveEnvironment(environment);
  }

  return (
    <main className="console-layout">
      <ProjectSwitcher projects={projects} activeProjectId={activeProject?.id} onSelect={setActiveProject} onCreate={createProject} />
      <section className="workspace">
        <header className="workspace-header">
          <div>
            <h1>{activeProject?.name ?? "No project selected"}</h1>
            <p>{activeEnvironment ? `Environment: ${activeEnvironment.name}` : "Create an environment to generate integration snippets."}</p>
          </div>
        </header>
        <EnvironmentSelector
          environments={environments}
          activeEnvironmentId={activeEnvironment?.id}
          disabled={!activeProject}
          onSelect={setActiveEnvironment}
          onCreate={createEnvironment}
        />
      </section>
    </main>
  );
}
```

Modify `apps/console/src/App.tsx`:

```tsx
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
```

- [ ] **Step 4: Add workspace styles**

Append to `apps/console/src/styles.css`:

```css
.console-layout {
  display: grid;
  min-height: 100vh;
  grid-template-columns: 240px minmax(0, 1fr);
}

.project-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-right: 1px solid #d7dde7;
  background: #fff;
  padding: 18px;
}

.section-label {
  color: #64748b;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.project-list {
  display: grid;
  gap: 6px;
}

.nav-item,
.pill {
  min-height: 36px;
  border: 1px solid #d7dde7;
  border-radius: 6px;
  background: #fff;
  color: #111827;
  cursor: pointer;
  text-align: left;
}

.nav-item {
  padding: 8px 10px;
}

.nav-item.active,
.pill.active {
  border-color: #2563eb;
  background: #dbeafe;
}

.workspace {
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 24px;
}

.workspace-header h1 {
  margin: 0;
  font-size: 26px;
}

.workspace-header p {
  margin: 4px 0 0;
  color: #64748b;
}

.panel {
  border: 1px solid #d7dde7;
  border-radius: 8px;
  background: #fff;
  padding: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.panel-header h2 {
  margin: 0;
  font-size: 16px;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pill {
  padding: 7px 10px;
}

.compact-form,
.inline-form {
  display: grid;
  gap: 8px;
}

.inline-form {
  grid-template-columns: minmax(220px, 1fr) auto;
  align-items: end;
  margin-top: 12px;
}

.compact-form label,
.inline-form label {
  display: grid;
  gap: 5px;
  color: #475569;
  font-size: 13px;
  font-weight: 700;
}

.compact-form input,
.inline-form input {
  min-height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 7px 9px;
}

.compact-form button,
.inline-form button {
  min-height: 36px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: #fff;
  font-weight: 700;
}
```

- [ ] **Step 5: Run workspace verification**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: both commands pass.

- [ ] **Step 6: Commit project and environment workspace**

Run:

```bash
git add apps/console/src
git commit -m "feat: add console project workspace"
```

## Task 5: API Keys And Snippets

**Files:**
- Create: `apps/console/src/components/ApiKeyPanel.tsx`
- Create: `apps/console/src/components/SnippetPanel.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/styles.css`
- Test: `apps/console/src/components/ApiKeyPanel.test.tsx`
- Test: `apps/console/src/components/SnippetPanel.test.tsx`

- [ ] **Step 1: Write API key and snippet tests**

Create `apps/console/src/components/ApiKeyPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyPanel } from "./ApiKeyPanel";
import type { ApiClient } from "../api/client";

const baseKey = {
  id: "key_1",
  projectId: "prj_1",
  environmentId: "env_1",
  name: "prod-web",
  prefix: "sh_123456789",
  createdAt: "",
  revokedAt: null
};

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn().mockResolvedValue({ apiKeys: [baseKey] }),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

describe("ApiKeyPanel", () => {
  it("lists existing keys without secrets", async () => {
    render(<ApiKeyPanel client={client({})} projectId="prj_1" environmentId="env_1" onSecretCreated={vi.fn()} />);

    expect(await screen.findByText("prod-web")).toBeInTheDocument();
    expect(screen.getByText("sh_123456789")).toBeInTheDocument();
    expect(screen.queryByText("Secret")).not.toBeInTheDocument();
  });

  it("creates a key and surfaces the one-time secret", async () => {
    const onSecretCreated = vi.fn();
    const api = client({
      createApiKey: vi.fn().mockResolvedValue({
        apiKey: { ...baseKey, id: "key_2", name: "worker", secret: "sh_secret_value" }
      })
    });

    render(<ApiKeyPanel client={api} projectId="prj_1" environmentId="env_1" onSecretCreated={onSecretCreated} />);

    await userEvent.type(await screen.findByLabelText("New key name"), "worker");
    await userEvent.click(screen.getByRole("button", { name: "Create key" }));

    await waitFor(() => expect(api.createApiKey).toHaveBeenCalledWith("prj_1", "env_1", "worker"));
    expect(await screen.findByText("sh_secret_value")).toBeInTheDocument();
    expect(onSecretCreated).toHaveBeenCalledWith("sh_secret_value");
  });
});
```

Create `apps/console/src/components/SnippetPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SnippetPanel } from "./SnippetPanel";

describe("SnippetPanel", () => {
  it("renders SDK and HTTP snippets for selected scope", () => {
    render(<SnippetPanel projectId="prj_1" environmentId="env_1" latestSecret="sh_secret_value" />);

    expect(screen.getByText(/@signal-hub\/sdk/)).toBeInTheDocument();
    expect(screen.getByText(/Key scope: prj_1 \/ env_1/)).toBeInTheDocument();
    expect(screen.getByText(/Authorization: Bearer sh_secret_value/)).toBeInTheDocument();
  });

  it("uses an explicit variable when no one-time secret is available", () => {
    render(<SnippetPanel projectId="prj_1" environmentId="env_1" latestSecret={undefined} />);

    expect(screen.getAllByText(/SIGNAL_HUB_API_KEY/).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the failing key/snippet tests**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/ApiKeyPanel.test.tsx src/components/SnippetPanel.test.tsx
```

Expected: fail because the components do not exist.

- [ ] **Step 3: Implement API key panel**

Create `apps/console/src/components/ApiKeyPanel.tsx`:

```tsx
import { type FormEvent, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { ApiKey } from "../api/types";

export function ApiKeyPanel({
  client,
  projectId,
  environmentId,
  onSecretCreated
}: {
  client: ApiClient;
  projectId?: string;
  environmentId?: string;
  onSecretCreated: (secret: string) => void;
}) {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | undefined>();

  useEffect(() => {
    if (!projectId) {
      setApiKeys([]);
      return;
    }
    void client.listApiKeys(projectId).then(({ apiKeys }) => setApiKeys(apiKeys));
  }, [client, projectId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!projectId || !environmentId || !trimmed) return;
    const { apiKey } = await client.createApiKey(projectId, environmentId, trimmed);
    setApiKeys((current) => [...current, apiKey]);
    setSecret(apiKey.secret);
    onSecretCreated(apiKey.secret);
    setName("");
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>API Keys</h2>
      </div>
      <div className="table-list">
        {apiKeys.map((apiKey) => (
          <div className="table-row" key={apiKey.id}>
            <strong>{apiKey.name}</strong>
            <code>{apiKey.prefix}</code>
            <span>{apiKey.revokedAt ? "Revoked" : "Active"}</span>
          </div>
        ))}
      </div>
      {secret ? (
        <div className="secret-box">
          <strong>One-time secret</strong>
          <code>{secret}</code>
          <p>This value is shown once. Store it in your deployment secrets before closing this page.</p>
        </div>
      ) : null}
      <form className="inline-form" onSubmit={submit}>
        <label>
          New key name
          <input value={name} onChange={(event) => setName(event.target.value)} disabled={!environmentId} />
        </label>
        <button type="submit" disabled={!environmentId}>
          Create key
        </button>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Implement snippet panel**

Create `apps/console/src/components/SnippetPanel.tsx`:

```tsx
export function SnippetPanel({
  projectId,
  environmentId,
  latestSecret
}: {
  projectId?: string;
  environmentId?: string;
  latestSecret?: string;
}) {
  const apiKey = latestSecret ?? "SIGNAL_HUB_API_KEY";
  const safeProjectId = projectId ?? "SIGNAL_HUB_PROJECT_ID";
  const safeEnvironmentId = environmentId ?? "SIGNAL_HUB_ENVIRONMENT_ID";

  const sdkSnippet = `import { createSignalHubClient } from "@signal-hub/sdk";

// Key scope: ${safeProjectId} / ${safeEnvironmentId}
const signal = createSignalHubClient({
  endpoint: "http://localhost:3000",
  apiKey: "${apiKey}"
});

signal.event("checkout_completed", { plan: "pro" });`;

  const httpSnippet = `# Key scope: ${safeProjectId} / ${safeEnvironmentId}
curl -X POST http://localhost:3000/v1/events \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"checkout_completed","properties":{"plan":"pro"}}'`;

  const envSnippet = `SIGNAL_HUB_ENDPOINT=http://localhost:3000
SIGNAL_HUB_API_KEY=${apiKey}
SIGNAL_HUB_PROJECT_ID=${safeProjectId}
SIGNAL_HUB_ENVIRONMENT_ID=${safeEnvironmentId}`;

  return (
    <section className="panel snippets-panel">
      <div className="panel-header">
        <h2>Integration Snippets</h2>
      </div>
      <h3>JS SDK</h3>
      <pre>{sdkSnippet}</pre>
      <h3>HTTP</h3>
      <pre>{httpSnippet}</pre>
      <h3>Environment</h3>
      <pre>{envSnippet}</pre>
    </section>
  );
}
```

- [ ] **Step 5: Wire panels into ConsoleShell**

Modify `apps/console/src/components/ConsoleShell.tsx` imports:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { Environment, Project } from "../api/types";
import { ApiKeyPanel } from "./ApiKeyPanel";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SnippetPanel } from "./SnippetPanel";
```

Add state inside `ConsoleShell`:

```tsx
  const [latestSecret, setLatestSecret] = useState<string | undefined>();
```

Reset the secret when project/environment changes by adding this effect:

```tsx
  useEffect(() => {
    setLatestSecret(undefined);
  }, [activeProject?.id, activeEnvironment?.id]);
```

Render these panels after `EnvironmentSelector`:

```tsx
        <div className="workspace-grid">
          <ApiKeyPanel
            client={client}
            projectId={activeProject?.id}
            environmentId={activeEnvironment?.id}
            onSecretCreated={setLatestSecret}
          />
          <SnippetPanel projectId={activeProject?.id} environmentId={activeEnvironment?.id} latestSecret={latestSecret} />
        </div>
```

- [ ] **Step 6: Add key/snippet styles**

Append to `apps/console/src/styles.css`:

```css
.workspace-grid {
  display: grid;
  grid-template-columns: minmax(280px, 0.8fr) minmax(360px, 1.2fr);
  gap: 16px;
}

.table-list {
  display: grid;
  gap: 8px;
}

.table-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 10px;
  align-items: center;
  min-height: 38px;
  border-bottom: 1px solid #edf1f7;
  font-size: 13px;
}

.secret-box {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  border: 1px solid #86efac;
  border-radius: 8px;
  background: #f0fdf4;
  padding: 12px;
}

.secret-box p {
  margin: 0;
  color: #166534;
  font-size: 13px;
}

.snippets-panel h3 {
  margin: 14px 0 6px;
  font-size: 13px;
}

.snippets-panel pre {
  overflow: auto;
  margin: 0;
  border: 1px solid #d7dde7;
  border-radius: 6px;
  background: #f8fafc;
  padding: 12px;
  font-size: 12px;
  line-height: 1.5;
}
```

- [ ] **Step 7: Run key/snippet verification**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/ApiKeyPanel.test.tsx src/components/SnippetPanel.test.tsx src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: all commands pass.

- [ ] **Step 8: Commit key and snippet work**

Run:

```bash
git add apps/console/src
git commit -m "feat: add console api keys and snippets"
```

## Task 6: Connection Check And User Administration

**Files:**
- Create: `apps/console/src/components/ConnectionCheck.tsx`
- Create: `apps/console/src/components/UserAdminPanel.tsx`
- Modify: `apps/console/src/components/ConsoleShell.tsx`
- Modify: `apps/console/src/styles.css`
- Test: `apps/console/src/components/ConnectionCheck.test.tsx`
- Test: `apps/console/src/components/UserAdminPanel.test.tsx`

- [ ] **Step 1: Write connection and user admin tests**

Create `apps/console/src/components/ConnectionCheck.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConnectionCheck } from "./ConnectionCheck";
import type { ApiClient } from "../api/client";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn().mockResolvedValue({ data: [{}] }),
    listErrors: vi.fn().mockResolvedValue({ data: [] }),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

describe("ConnectionCheck", () => {
  it("shows connected when recent telemetry exists", async () => {
    render(<ConnectionCheck client={client({})} projectId="prj_1" environmentId="env_1" />);

    expect(await screen.findByText("Telemetry received")).toBeInTheDocument();
  });

  it("shows empty state when no telemetry exists", async () => {
    render(
      <ConnectionCheck
        client={client({
          listEvents: vi.fn().mockResolvedValue({ data: [] }),
          listErrors: vi.fn().mockResolvedValue({ data: [] })
        })}
        projectId="prj_1"
        environmentId="env_1"
      />
    );

    expect(await screen.findByText("No telemetry yet")).toBeInTheDocument();
  });

  it("shows unavailable state when query fails", async () => {
    render(
      <ConnectionCheck
        client={client({
          listEvents: vi.fn().mockRejectedValue(new Error("query_unavailable")),
          listErrors: vi.fn().mockRejectedValue(new Error("query_unavailable"))
        })}
        projectId="prj_1"
        environmentId="env_1"
      />
    );

    expect(await screen.findByText("Connection check unavailable")).toBeInTheDocument();
  });
});
```

Create `apps/console/src/components/UserAdminPanel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UserAdminPanel } from "./UserAdminPanel";
import type { ApiClient } from "../api/client";

function client(overrides: Partial<ApiClient>): ApiClient {
  return {
    getConsoleConfig: vi.fn(),
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    listProjects: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    archiveProject: vi.fn(),
    listEnvironments: vi.fn(),
    createEnvironment: vi.fn(),
    updateEnvironment: vi.fn(),
    archiveEnvironment: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    listEvents: vi.fn(),
    listErrors: vi.fn(),
    getEventAggregates: vi.fn(),
    getErrorAggregates: vi.fn(),
    listUsers: vi.fn().mockResolvedValue({ users: [{ id: "usr_1", email: "admin@example.com", isAdmin: true }] }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides
  };
}

describe("UserAdminPanel", () => {
  it("lists users", async () => {
    render(<UserAdminPanel client={client({})} />);

    expect(await screen.findByText("admin@example.com")).toBeInTheDocument();
  });

  it("creates a non-admin user", async () => {
    const api = client({
      createUser: vi.fn().mockResolvedValue({ user: { id: "usr_2", email: "viewer@example.com", isAdmin: false } })
    });

    render(<UserAdminPanel client={api} />);

    await userEvent.type(await screen.findByLabelText("User email"), "viewer@example.com");
    await userEvent.type(screen.getByLabelText("Temporary password"), "long-temporary-password");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith("viewer@example.com", "long-temporary-password", false));
    expect(await screen.findByText("viewer@example.com")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the failing connection/user tests**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/ConnectionCheck.test.tsx src/components/UserAdminPanel.test.tsx
```

Expected: fail because the components do not exist.

- [ ] **Step 3: Implement connection check**

Create `apps/console/src/components/ConnectionCheck.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";

type State = "idle" | "loading" | "received" | "empty" | "unavailable";

export function ConnectionCheck({ client, projectId, environmentId }: { client: ApiClient; projectId?: string; environmentId?: string }) {
  const [state, setState] = useState<State>("idle");

  useEffect(() => {
    if (!projectId || !environmentId) {
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("loading");

    Promise.all([client.listEvents(projectId, environmentId), client.listErrors(projectId, environmentId)]).then(
      ([events, errors]) => {
        if (cancelled) return;
        setState(events.data.length > 0 || errors.data.length > 0 ? "received" : "empty");
      },
      () => {
        if (cancelled) return;
        setState("unavailable");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, projectId, environmentId]);

  const label =
    state === "received"
      ? "Telemetry received"
      : state === "empty"
        ? "No telemetry yet"
        : state === "unavailable"
          ? "Connection check unavailable"
          : state === "loading"
            ? "Checking telemetry..."
            : "Select an environment";

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Connection Check</h2>
      </div>
      <div className={`status-box ${state}`}>{label}</div>
    </section>
  );
}
```

- [ ] **Step 4: Implement user admin panel**

Create `apps/console/src/components/UserAdminPanel.tsx`:

```tsx
import { type FormEvent, useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { User } from "../api/types";

export function UserAdminPanel({ client }: { client: ApiClient }) {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    void client.listUsers().then(({ users }) => setUsers(users));
  }, [client]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) return;
    const { user } = await client.createUser(trimmedEmail, password, false);
    setUsers((current) => [...current, user]);
    setEmail("");
    setPassword("");
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Users</h2>
      </div>
      <div className="table-list">
        {users.map((user) => (
          <div className="table-row" key={user.id}>
            <strong>{user.email}</strong>
            <span>{user.isAdmin ? "Admin" : "User"}</span>
          </div>
        ))}
      </div>
      <form className="inline-form" onSubmit={submit}>
        <label>
          User email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" />
        </label>
        <label>
          Temporary password
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" />
        </label>
        <button type="submit">Create user</button>
      </form>
    </section>
  );
}
```

- [ ] **Step 5: Wire connection and users into ConsoleShell**

Modify `apps/console/src/components/ConsoleShell.tsx` imports:

```tsx
import { ApiKeyPanel } from "./ApiKeyPanel";
import { ConnectionCheck } from "./ConnectionCheck";
import { EnvironmentSelector } from "./EnvironmentSelector";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { SnippetPanel } from "./SnippetPanel";
import { UserAdminPanel } from "./UserAdminPanel";
```

Render these panels after the existing workspace grid:

```tsx
        <div className="workspace-grid">
          <ConnectionCheck client={client} projectId={activeProject?.id} environmentId={activeEnvironment?.id} />
          <UserAdminPanel client={client} />
        </div>
```

- [ ] **Step 6: Add status styles**

Append to `apps/console/src/styles.css`:

```css
.status-box {
  border: 1px solid #d7dde7;
  border-radius: 8px;
  padding: 14px;
  color: #475569;
  font-weight: 700;
}

.status-box.received {
  border-color: #86efac;
  background: #f0fdf4;
  color: #166534;
}

.status-box.empty {
  border-color: #fde68a;
  background: #fffbeb;
  color: #92400e;
}

.status-box.unavailable {
  border-color: #fecaca;
  background: #fef2f2;
  color: #991b1b;
}
```

- [ ] **Step 7: Run connection/user verification**

Run:

```bash
pnpm --filter @signal-hub/console test src/components/ConnectionCheck.test.tsx src/components/UserAdminPanel.test.tsx src/components/ConsoleShell.test.tsx
pnpm --filter @signal-hub/console build
```

Expected: all commands pass.

- [ ] **Step 8: Commit connection and user admin**

Run:

```bash
git add apps/console/src
git commit -m "feat: add console connection and user panels"
```

## Task 7: Packaging, Documentation, And Final Verification

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml` only if a console dev port is exposed.
- Modify: `.claude/docs/ARCHITECTURE.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/DEPLOYMENT.md`
- Create or modify: `.claude/docs/UI-UX.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Dockerfile for console builds**

Modify `Dockerfile` so the workspace has everything needed to install, build, and run both API and console packages:

```dockerfile
FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json vitest.config.ts ./

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @signal-hub/console build

CMD ["pnpm", "dev:api"]
```

- [ ] **Step 2: Keep Compose single-entry for self-host**

Run:

```bash
docker compose config --quiet
```

Expected: pass. Do not add a production console service; the API serves built console assets at `/console`.

- [ ] **Step 3: Add console docs**

Create `.claude/docs/UI-UX.md`:

```md
# UI and UX

SignalHub includes an admin-only Integration Console.

## Console Principles

- The console is an operational workspace, not a marketing page.
- The first screen focuses on projects, environments, API keys, snippets, connection status, and simple user administration.
- API key secrets are shown only immediately after creation and are not stored in browser storage.
- The visual style should remain compact, quiet, and optimized for repeated setup work.
```

Append this section to `.claude/docs/ARCHITECTURE.md`:

```md
## Integration Console

`apps/console` contains the Vite + React + TypeScript browser console.

The API exposes `GET /console/config` for non-secret browser configuration and serves built console assets from `/console` in production. The console uses existing session authentication, admin routes, and query routes.
```

Append this section to `.claude/docs/STACK.md`:

```md
## Console Stack

- Vite + React + TypeScript for `apps/console`.
- Testing Library + jsdom for browser component tests.
- `@fastify/static` for production console asset delivery from the API.
```

Append this section to `.claude/docs/DEPLOYMENT.md`:

```md
## Console Deployment

Production builds include `apps/console/dist`. The API serves the console at `/console` and exposes non-secret runtime config at `/console/config`.

Local development can run the API with `pnpm dev:api` and the console with `pnpm dev:console`.
```

Modify `CLAUDE.md` canonical docs list to include:

```md
- `.claude/docs/UI-UX.md`: console UX principles and visual conventions.
```

Modify `CLAUDE.md` project conventions to include:

```md
- Keep the admin console in `apps/console` and serve its production build from the API at `/console`.
```

- [ ] **Step 4: Run full verification**

Run:

```bash
pnpm test
pnpm build
docker compose config --quiet
```

Expected: all commands pass.

- [ ] **Step 5: Run browser smoke check**

Start the API and console dev servers in separate terminals:

```bash
pnpm dev:api
pnpm dev:console
```

Open `http://localhost:5173` and verify:

- unauthenticated users see the login form;
- admin login reaches the console;
- project creation works;
- environment creation works;
- API key creation shows the one-time secret;
- snippets include the selected project and environment.

- [ ] **Step 6: Commit packaging and docs**

Run:

```bash
git add Dockerfile docker-compose.yml CLAUDE.md .claude/docs apps/api apps/console package.json pnpm-lock.yaml
git commit -m "docs: document console operation"
```

## Final Review

- [ ] Run `git status -sb` and confirm only intentional files changed.
- [ ] Run `git log --oneline -8` and confirm the task commits are readable.
- [ ] Push the branch when the user asks for publication:

```bash
git push origin main
```
