# Next.js SDK Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an official `@sigmon/sdk/next` entrypoint that makes Next.js App Router instrumentation natural for MicroERP-style apps.

**Architecture:** Keep the existing SDK transport and queue untouched. Add a thin Next.js-focused wrapper layer that builds default context from request-like objects, wraps route handlers and server actions, and optionally installs browser global error capture through explicit opt-in. Avoid Next.js runtime dependencies so the SDK remains small and testable in plain TypeScript.

**Tech Stack:** TypeScript, existing `@sigmon/sdk` client, Web `Request`/`Response` shapes, Vitest, Vite/tsc package build.

---

## File Map

- Create `packages/sdk/src/next.ts`: Next.js wrapper types and helpers.
- Create `packages/sdk/test/next.test.ts`: wrapper unit tests with fake requests, handlers, and actions.
- Modify `packages/sdk/src/types.ts`: add `correlationId` to `SignalContext` only if the implementation decides to send it inside `metadata`; otherwise keep the transport envelope unchanged and put it under `metadata.correlation_id`.
- Modify `packages/sdk/src/index.ts`: export Next.js types only if they are useful from root; the primary public path is `@sigmon/sdk/next`.
- Modify `packages/sdk/package.json`: add `./next` export.
- Modify `packages/sdk/test/exports.test.ts`: assert the new subpath export is safe and root/browser/node boundaries remain valid.
- Modify `README.md`: add a Next.js App Router recipe.
- Modify `.claude/docs/STACK.md`: document `@sigmon/sdk/next`.
- Modify `.claude/docs/PROJECT-SUMMARY.md`: mention official Next.js wrapper.
- Modify `.claude/docs/CONSTRAINTS.md`: record that the wrapper does not use compiler/plugin integration.

## Public Contract

`@sigmon/sdk/next` exports:

```ts
import type {
  ErrorInput,
  SignalContext,
  SignalMetadata,
  SignalMonitorClient,
  SignalMonitorClientOptions
} from "@sigmon/sdk";

export type NextRequestLike = {
  method?: string;
  url?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
};

export type NextContextInput = SignalContext & {
  request?: NextRequestLike;
  routeName?: string;
  module?: string;
  correlationHeader?: string;
};

export type SignalMonitorNextClient = SignalMonitorClient & {
  captureRequestError: (error: unknown, input?: NextContextInput & ErrorInput) => void;
};

export function createSignalMonitorNextClient(
  options: SignalMonitorClientOptions
): SignalMonitorNextClient;

export function buildNextContext(input?: NextContextInput): SignalContext;

export function withSignalMonitorRoute<TResponse>(
  handler: (request: Request, context?: unknown) => TResponse | Promise<TResponse>,
  options: {
    client: SignalMonitorNextClient;
    routeName?: string;
    module?: string;
    getContext?: (request: Request, context?: unknown) => SignalContext | Promise<SignalContext>;
    flushOnError?: boolean;
  }
): (request: Request, context?: unknown) => Promise<TResponse>;

export function withSignalMonitorAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => TResult | Promise<TResult>,
  options: {
    client: SignalMonitorNextClient;
    name?: string;
    module?: string;
    getContext?: (...args: TArgs) => SignalContext | Promise<SignalContext>;
    flushOnError?: boolean;
  }
): (...args: TArgs) => Promise<TResult>;

export function installBrowserErrorCapture(
  client: SignalMonitorClient,
  options?: {
    captureErrors?: boolean;
    captureUnhandledRejections?: boolean;
    context?: SignalContext;
    flush?: boolean;
  }
): () => void;
```

Context mapping:

- `request.url` becomes `metadata.request_url` after stripping query values with `URL.pathname`.
- `request.method` becomes `metadata.request_method`.
- `routeName` becomes trace/error `source` when no explicit `source` is supplied, and also `metadata.route_name`.
- `module` becomes `metadata.module`.
- `x-request-id`, `x-correlation-id`, or configured `correlationHeader` becomes `traceId` when no explicit `traceId` is supplied, and `metadata.correlation_id`.
- User and tenant identity still come from explicit `getContext`/`context`, not from cookies.

## Task 1: Add Next.js Wrapper Tests

**Files:**
- Create: `packages/sdk/test/next.test.ts`
- Modify: `packages/sdk/test/exports.test.ts`

- [ ] **Step 1: Write failing wrapper tests**

Create `packages/sdk/test/next.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  buildNextContext,
  createSignalMonitorNextClient,
  installBrowserErrorCapture,
  withSignalMonitorAction,
  withSignalMonitorRoute
} from "../src/next.js";

function jsonResponse(status = 200): Response {
  return new Response(JSON.stringify({ ok: true }), { status });
}

describe("Next.js SDK wrapper", () => {
  it("builds safe request context from request-like input", () => {
    const request = new Request("https://app.example.com/api/orders?secret=hidden", {
      method: "POST",
      headers: { "x-request-id": "req_123" }
    });

    expect(buildNextContext({ request, routeName: "POST /api/orders", module: "orders" })).toEqual({
      traceId: "req_123",
      source: "POST /api/orders",
      metadata: {
        correlation_id: "req_123",
        module: "orders",
        request_method: "POST",
        request_path: "/api/orders",
        route_name: "POST /api/orders"
      }
    });
  });

  it("captures and flushes route handler errors with merged request context", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 202 });
    });
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: fetchImpl,
      defaultContext: { release: "web@1" }
    });
    const handler = withSignalMonitorRoute(
      async () => {
        throw new Error("route exploded");
      },
      {
        client,
        routeName: "GET /api/orders",
        getContext: () => ({ tenantId: "tenant_1", userId: "user_1" })
      }
    );

    await expect(handler(new Request("https://app.example.com/api/orders"))).rejects.toThrow("route exploded");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sigmon.example.com/v1/errors");
    expect(calls[0].body).toMatchObject({
      message: "route exploded",
      release: "web@1",
      tenant_id: "tenant_1",
      user_id: "user_1",
      source: "GET /api/orders",
      context: {
        route_name: "GET /api/orders"
      }
    });
  });

  it("wraps server actions without changing successful return values", async () => {
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: vi.fn()
    });
    const action = withSignalMonitorAction(async (value: number) => value * 2, {
      client,
      name: "createOrder"
    });

    await expect(action(21)).resolves.toBe(42);
  });

  it("installs and removes browser error listeners explicitly", () => {
    const listeners: Record<string, EventListenerOrEventListenerObject> = {};
    const addEventListener = vi.spyOn(globalThis, "addEventListener").mockImplementation((type, listener) => {
      listeners[type] = listener;
    });
    const removeEventListener = vi.spyOn(globalThis, "removeEventListener").mockImplementation(() => undefined);
    const client = createSignalMonitorNextClient({
      endpoint: "https://sigmon.example.com",
      apiKey: "sh_test",
      fetch: vi.fn(async () => new Response("{}", { status: 202 }))
    });

    const stop = installBrowserErrorCapture(client, { captureErrors: true, captureUnhandledRejections: true });

    expect(addEventListener).toHaveBeenCalledWith("error", expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));

    stop();

    expect(removeEventListener).toHaveBeenCalledWith("error", listeners.error);
    expect(removeEventListener).toHaveBeenCalledWith("unhandledrejection", listeners.unhandledrejection);
    addEventListener.mockRestore();
    removeEventListener.mockRestore();
  });
});
```

- [ ] **Step 2: Add failing export test**

Append to `packages/sdk/test/exports.test.ts`:

```ts
it("exposes a Next.js wrapper entrypoint", async () => {
  const next = await import("../src/next.js");

  expect(next.createSignalMonitorNextClient).toBeTypeOf("function");
  expect(next.withSignalMonitorRoute).toBeTypeOf("function");
  expect(next.withSignalMonitorAction).toBeTypeOf("function");
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
rtk proxy pnpm vitest run packages/sdk/test/next.test.ts packages/sdk/test/exports.test.ts
```

Expected: FAIL because `packages/sdk/src/next.ts` does not exist and `./next` is not exported.

## Task 2: Implement `@sigmon/sdk/next`

**Files:**
- Create: `packages/sdk/src/next.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/package.json`

- [ ] **Step 1: Add the new public subpath export**

In `packages/sdk/package.json`, extend `exports`:

```json
"./next": {
  "types": "./dist/next.d.ts",
  "default": "./dist/next.js"
}
```

- [ ] **Step 2: Implement request context helpers**

Create `packages/sdk/src/next.ts` with these helpers first:

```ts
import { createSignalMonitorClient } from "./client.js";
import type {
  ErrorInput,
  SignalContext,
  SignalMetadata,
  SignalMonitorClient,
  SignalMonitorClientOptions
} from "./types.js";

export type NextRequestLike = {
  method?: string;
  url?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
};

export type NextContextInput = SignalContext & {
  request?: NextRequestLike;
  routeName?: string;
  module?: string;
  correlationHeader?: string;
};

export type SignalMonitorNextClient = SignalMonitorClient & {
  captureRequestError: (error: unknown, input?: NextContextInput & ErrorInput) => void;
};

function readHeader(headers: NextRequestLike["headers"], name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function requestPath(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).pathname;
  } catch {
    return url.split("?")[0] || undefined;
  }
}

function assignDefined(target: SignalMetadata, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== "") {
    target[key] = value as SignalMetadata[string];
  }
}

export function buildNextContext(input: NextContextInput = {}): SignalContext {
  const correlationHeader = input.correlationHeader ?? "x-request-id";
  const correlationId =
    input.traceId ??
    readHeader(input.request?.headers, correlationHeader) ??
    readHeader(input.request?.headers, "x-correlation-id");
  const metadata: SignalMetadata = { ...(input.metadata ?? {}) };

  assignDefined(metadata, "correlation_id", correlationId);
  assignDefined(metadata, "module", input.module);
  assignDefined(metadata, "request_method", input.request?.method);
  assignDefined(metadata, "request_path", requestPath(input.request?.url));
  assignDefined(metadata, "route_name", input.routeName);

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    sessionId: input.sessionId,
    traceId: correlationId,
    source: input.source ?? input.routeName,
    release: input.release,
    metadata
  };
}
```

- [ ] **Step 3: Add client factory and wrappers**

Continue `packages/sdk/src/next.ts` with:

```ts
function mergeSignalContext(left?: SignalContext, right?: SignalContext): SignalContext {
  return {
    ...left,
    ...right,
    metadata: {
      ...(left?.metadata ?? {}),
      ...(right?.metadata ?? {})
    }
  };
}

export function createSignalMonitorNextClient(options: SignalMonitorClientOptions): SignalMonitorNextClient {
  const client = createSignalMonitorClient(options);
  return {
    ...client,
    captureRequestError(error: unknown, input?: NextContextInput & ErrorInput): void {
      const context = buildNextContext(input);
      client.captureError(error, {
        ...context,
        severity: input?.severity,
        fingerprint: input?.fingerprint,
        context: {
          ...(input?.context ?? {}),
          ...(context.metadata ?? {})
        }
      });
    }
  };
}

export function withSignalMonitorRoute<TResponse>(
  handler: (request: Request, context?: unknown) => TResponse | Promise<TResponse>,
  options: {
    client: SignalMonitorNextClient;
    routeName?: string;
    module?: string;
    getContext?: (request: Request, context?: unknown) => SignalContext | Promise<SignalContext>;
    flushOnError?: boolean;
  }
): (request: Request, context?: unknown) => Promise<TResponse> {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      const explicitContext = await options.getContext?.(request, context);
      const requestContext = buildNextContext({ request, routeName: options.routeName, module: options.module });
      const merged = mergeSignalContext(requestContext, explicitContext);
      options.client.captureError(error, {
        ...merged,
        context: { ...(merged.metadata ?? {}) }
      });
      if (options.flushOnError !== false) {
        await options.client.flush({ discardOnFailure: false });
      }
      throw error;
    }
  };
}

export function withSignalMonitorAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => TResult | Promise<TResult>,
  options: {
    client: SignalMonitorNextClient;
    name?: string;
    module?: string;
    getContext?: (...args: TArgs) => SignalContext | Promise<SignalContext>;
    flushOnError?: boolean;
  }
): (...args: TArgs) => Promise<TResult> {
  return async (...args) => {
    try {
      return await action(...args);
    } catch (error) {
      const explicitContext = await options.getContext?.(...args);
      const actionContext = buildNextContext({ routeName: options.name, module: options.module });
      const merged = mergeSignalContext(actionContext, explicitContext);
      options.client.captureError(error, {
        ...merged,
        context: { ...(merged.metadata ?? {}) }
      });
      if (options.flushOnError !== false) {
        await options.client.flush({ discardOnFailure: false });
      }
      throw error;
    }
  };
}
```

- [ ] **Step 4: Add browser global capture helper**

Append:

```ts
function rejectionReason(event: PromiseRejectionEvent): unknown {
  return event.reason instanceof Error ? event.reason : new Error(String(event.reason ?? "Unhandled rejection"));
}

export function installBrowserErrorCapture(
  client: SignalMonitorClient,
  options: {
    captureErrors?: boolean;
    captureUnhandledRejections?: boolean;
    context?: SignalContext;
    flush?: boolean;
  } = {}
): () => void {
  const captureErrors = options.captureErrors ?? true;
  const captureUnhandledRejections = options.captureUnhandledRejections ?? true;
  const flush = options.flush ?? false;
  const stops: Array<() => void> = [];

  if (captureErrors) {
    const onError = (event: ErrorEvent) => {
      client.captureError(event.error ?? new Error(event.message), {
        ...(options.context ?? {}),
        context: { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno }
      });
      if (flush) void client.flush();
    };
    globalThis.addEventListener("error", onError);
    stops.push(() => globalThis.removeEventListener("error", onError));
  }

  if (captureUnhandledRejections) {
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      client.captureError(rejectionReason(event), {
        ...(options.context ?? {}),
        context: { type: "unhandledrejection" }
      });
      if (flush) void client.flush();
    };
    globalThis.addEventListener("unhandledrejection", onUnhandledRejection);
    stops.push(() => globalThis.removeEventListener("unhandledrejection", onUnhandledRejection));
  }

  return () => {
    for (const stop of stops.splice(0)) stop();
  };
}
```

- [ ] **Step 5: Run SDK tests**

Run:

```bash
pnpm vitest run packages/sdk/test/next.test.ts packages/sdk/test/exports.test.ts
pnpm --filter @sigmon/sdk build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/package.json packages/sdk/src/next.ts packages/sdk/test/next.test.ts packages/sdk/test/exports.test.ts
git commit -m "feat: add nextjs sdk wrapper"
```

## Task 3: Add Next.js Documentation And Console Snippets

**Files:**
- Modify: `README.md`
- Modify: `apps/console/src/components/SnippetPanel.tsx`
- Modify: `apps/console/src/components/SnippetPanel.test.tsx`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`
- Modify: `.claude/docs/CONSTRAINTS.md`

- [ ] **Step 1: Add failing snippet test**

In `apps/console/src/components/SnippetPanel.test.tsx`, add an expectation that the setup snippets include the Next.js entrypoint:

```ts
expect(screen.getByText(/@sigmon\/sdk\/next/)).toBeInTheDocument();
expect(screen.getByText(/withSignalMonitorRoute/)).toBeInTheDocument();
```

Run:

```bash
pnpm vitest run apps/console/src/components/SnippetPanel.test.tsx
```

Expected: FAIL until the snippet panel includes the Next.js recipe.

- [ ] **Step 2: Add a compact Next.js snippet**

Update `SnippetPanel.tsx` so the SDK snippets include:

```ts
import { createSignalMonitorNextClient, withSignalMonitorRoute } from "@sigmon/sdk/next";

const sigmon = createSignalMonitorNextClient({
  endpoint: "SIGMON_ENDPOINT",
  apiKey: process.env.SIGMON_API_KEY!,
  defaultContext: {
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    metadata: { service: "web" }
  }
});

export const GET = withSignalMonitorRoute(async () => {
  return Response.json({ ok: true });
}, {
  client: sigmon,
  routeName: "GET /api/health"
});
```

- [ ] **Step 3: Add README recipe**

Add a `Next.js App Router` subsection near the SDK section in `README.md` with:

```md
### Next.js App Router

Server route handlers can use `@sigmon/sdk/next`:

```ts
import { createSignalMonitorNextClient, withSignalMonitorRoute } from "@sigmon/sdk/next";

const sigmon = createSignalMonitorNextClient({
  endpoint: process.env.SIGMON_ENDPOINT!,
  apiKey: process.env.SIGMON_API_KEY!,
  defaultContext: {
    release: process.env.NEXT_PUBLIC_APP_VERSION,
    metadata: { service: "web" }
  }
});

export const GET = withSignalMonitorRoute(async () => {
  return Response.json({ ok: true });
}, {
  client: sigmon,
  routeName: "GET /api/health",
  getContext: async () => ({ tenantId: "tenant_123", userId: "user_123" })
});
```

Client-side global capture is explicit:

```ts
import { createSignalMonitorClient } from "@sigmon/sdk/browser";
import { installBrowserErrorCapture } from "@sigmon/sdk/next";

const sigmon = createSignalMonitorClient({
  endpoint: process.env.NEXT_PUBLIC_SIGMON_ENDPOINT!,
  apiKey: process.env.NEXT_PUBLIC_SIGMON_API_KEY!
});

const stop = installBrowserErrorCapture(sigmon, { captureErrors: true, captureUnhandledRejections: true });
```
```

- [ ] **Step 4: Update project docs**

Add concise bullets:

- `.claude/docs/STACK.md`: `packages/sdk` exports `@sigmon/sdk/next` for App Router wrappers.
- `.claude/docs/PROJECT-SUMMARY.md`: Next.js apps can use route/action wrappers and opt-in browser global capture.
- `.claude/docs/CONSTRAINTS.md`: no Next.js compiler plugin or hidden framework internals in this MVP.

- [ ] **Step 5: Run docs/UI tests**

Run:

```bash
pnpm vitest run apps/console/src/components/SnippetPanel.test.tsx packages/sdk/test/next.test.ts packages/sdk/test/exports.test.ts
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md .claude/docs/STACK.md .claude/docs/PROJECT-SUMMARY.md .claude/docs/CONSTRAINTS.md apps/console/src/components/SnippetPanel.tsx apps/console/src/components/SnippetPanel.test.tsx
git commit -m "docs: add nextjs sdk recipe"
```

## Final Verification

- [ ] Run focused tests:

```bash
pnpm vitest run packages/sdk/test/next.test.ts packages/sdk/test/exports.test.ts apps/console/src/components/SnippetPanel.test.tsx
```

- [ ] Run full verification:

```bash
pnpm test
pnpm build
git diff --check
```

- [ ] Confirm package output includes `dist/next.js` and `dist/next.d.ts` after SDK build.

- [ ] Record completion in `.claude/docs/PROJECT-SUMMARY.md` and versioned memory if implementation is completed in this session.

