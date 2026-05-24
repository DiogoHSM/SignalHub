# Scalar API Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add public Scalar API docs at `/docs` and a maintained OpenAPI 3.1 document at `/openapi.json`.

**Architecture:** Keep the first OpenAPI spec as a small typed module in the API package and register docs routes from a dedicated docs route module. Use Scalar's official Fastify plugin to render the interactive API reference from `/openapi.json` while keeping all existing endpoint auth unchanged.

**Tech Stack:** Fastify 5, TypeScript, Vitest, OpenAPI 3.1, `@scalar/fastify-api-reference`.

---

## File Structure

- Create `apps/api/src/openapi.ts`: exports the OpenAPI document object.
- Create `apps/api/src/routes/docs.ts`: registers `/openapi.json` and `/docs` through Scalar.
- Modify `apps/api/src/app.ts`: registers docs routes before existing API/console routes.
- Create `apps/api/test/docs.test.ts`: verifies docs HTML, OpenAPI JSON, security schemes, paths, and security headers.
- Modify `apps/api/package.json`: adds `@scalar/fastify-api-reference`.
- Modify `README.md`: mentions deployed API docs.
- Modify `.claude/docs/DEPLOYMENT.md`: mentions `/docs` and `/openapi.json`.

## Task 1: Docs Route Tests

**Files:**
- Create: `apps/api/test/docs.test.ts`

- [x] **Step 1: Write failing docs tests**

Create `apps/api/test/docs.test.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("API docs", () => {
  async function createApp() {
    app = await buildApp({
      readiness: async () => ({ postgres: true, redis: true }),
      nodeEnv: "production"
    });
    return app;
  }

  it("serves an OpenAPI 3.1 document", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/openapi.json" });
    const spec = response.json();

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("SignalMonitor API");
    expect(spec.servers).toEqual([{ url: "https://my.sigmon.app", description: "Production" }]);
  });

  it("documents the public ingestion paths and auth schemes", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/openapi.json" });
    const spec = response.json();

    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        "/health",
        "/ready",
        "/v1/events",
        "/v1/errors",
        "/v1/breadcrumbs",
        "/v1/llm",
        "/v1/traces",
        "/v1/spans",
        "/v1/source-maps",
        "/auth/login",
        "/admin/projects",
        "/query/events",
        "/system/health"
      ])
    );
    expect(spec.components.securitySchemes).toMatchObject({
      ingestionApiKey: { type: "http", scheme: "bearer" },
      sourceMapUploadToken: { type: "http", scheme: "bearer" },
      sessionCookie: { type: "apiKey", in: "cookie", name: "__Host-sigmon_session" }
    });
    expect(spec.paths["/v1/events"].post.security).toEqual([{ ingestionApiKey: [] }]);
    expect(spec.paths["/v1/source-maps"].post.security).toEqual([{ sourceMapUploadToken: [] }]);
    expect(spec.paths["/query/events"].get.security).toEqual([{ sessionCookie: [] }]);
  });

  it("serves public Scalar docs HTML", async () => {
    const server = await createApp();

    const response = await server.inject({ method: "GET", url: "/docs" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("SignalMonitor API Reference");
    expect(response.body).toContain("/openapi.json");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
```

- [x] **Step 2: Verify tests fail**

Run:

```sh
pnpm test apps/api/test/docs.test.ts
```

Expected: FAIL with missing `/openapi.json` and `/docs` routes.

## Task 2: OpenAPI Document And Scalar Routes

**Files:**
- Create: `apps/api/src/openapi.ts`
- Create: `apps/api/src/routes/docs.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/package.json`

- [x] **Step 1: Add Scalar dependency**

Run:

```sh
pnpm --filter @sigmon/api add @scalar/fastify-api-reference
```

Expected: `apps/api/package.json` and `pnpm-lock.yaml` update.

- [x] **Step 2: Create OpenAPI document**

Create `apps/api/src/openapi.ts` with a typed OpenAPI document. Include:

- `openapi: "3.1.0"`
- `info.title: "SignalMonitor API"`
- `servers: [{ url: "https://my.sigmon.app", description: "Production" }]`
- Security schemes: `ingestionApiKey`, `sourceMapUploadToken`, `sessionCookie`.
- Paths for health/readiness, ingestion, source-map upload, auth/admin/query/system summaries.
- Schemas for accepted response, error response, event/error/breadcrumb/llm/trace/span payload examples.

- [x] **Step 3: Register docs routes**

Create `apps/api/src/routes/docs.ts` that:

```ts
import { apiReference } from "@scalar/fastify-api-reference";
import type { FastifyInstance } from "fastify";
import { openApiDocument } from "../openapi.js";

export async function registerDocsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/openapi.json", async (_request, reply) =>
    reply.type("application/json").send(openApiDocument)
  );

  await app.register(apiReference, {
    routePrefix: "/docs",
    configuration: {
      title: "SignalMonitor API Reference",
      spec: {
        url: "/openapi.json"
      }
    },
    logLevel: "silent"
  });
}
```

- [x] **Step 4: Wire docs into app**

In `apps/api/src/app.ts`, import and await docs registration after plugins are registered and before the console/admin routes:

```ts
import { registerDocsRoutes } from "./routes/docs.js";
```

```ts
registerRequestContext(app);
await registerDocsRoutes(app);
registerHealthRoutes(app, options.readiness);
```

- [x] **Step 5: Run docs tests**

Run:

```sh
pnpm test apps/api/test/docs.test.ts apps/api/test/security-headers.test.ts
pnpm --filter @sigmon/api lint
```

Expected: PASS.

- [x] **Step 6: Commit**

```sh
git add apps/api/package.json pnpm-lock.yaml apps/api/src/openapi.ts apps/api/src/routes/docs.ts apps/api/src/app.ts apps/api/test/docs.test.ts
git commit -m "feat: add scalar api docs"
```

## Task 3: Operator Documentation

**Files:**
- Modify: `README.md`
- Modify: `.claude/docs/DEPLOYMENT.md`

- [x] **Step 1: Update README docs section**

In `README.md`, add a short "API Documentation" section near the API examples:

```md
## API Documentation

Deployed SignalMonitor instances expose public API reference docs at `/docs` and the raw OpenAPI 3.1 document at `/openapi.json`.

For the EasyPanel deployment, use:

- `https://my.sigmon.app/docs`
- `https://my.sigmon.app/openapi.json`

The docs are public, but protected endpoints still require their normal ingestion API key, source-map upload token, or human session cookie.
```

- [x] **Step 2: Update deployment docs**

In `.claude/docs/DEPLOYMENT.md`, add the same operator note under Console Deployment or Readiness.

- [x] **Step 3: Run doc grep checks**

Run:

```sh
rg -n "/docs|/openapi.json|Scalar|API reference" README.md .claude/docs/DEPLOYMENT.md
git diff --check
```

Expected: docs mention the public reference and raw OpenAPI endpoint.

- [x] **Step 4: Commit docs**

```sh
git add README.md .claude/docs/DEPLOYMENT.md
git commit -m "docs: document scalar api reference"
```

## Task 4: Final Verification And Handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-05-24-scalar-api-docs-implementation.md`

- [x] **Step 1: Run final verification**

Run:

```sh
pnpm test apps/api/test/docs.test.ts apps/api/test/security-headers.test.ts apps/api/test/ingestion.test.ts apps/api/test/source-map-uploads.test.ts
pnpm --filter @sigmon/api lint
pnpm build
git diff --check
```

Expected: PASS.

- [x] **Step 2: Update this checklist**

Mark completed steps in this plan.

- [x] **Step 3: Commit checklist**

```sh
git add docs/superpowers/plans/2026-05-24-scalar-api-docs-implementation.md
git commit -m "docs: record scalar api docs implementation"
```

- [ ] **Step 4: Handoff**

Report:

- Branch name.
- `/docs` and `/openapi.json` behavior.
- Verification commands and results.
- Whether the branch is ready for PR.
