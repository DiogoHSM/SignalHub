# Loadgen Synthetic Telemetry Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/loadgen`, a CLI that generates and sends realistic synthetic telemetry (events, errors, traces+spans, LLM calls, identify, breadcrumbs) for 2-3 fake services per project across 2-3 projects, with scripted incidents (error-rate spikes, monitor outages), in two modes — instant historical backfill and real-time soak — from one generated timeline.

**Architecture:** Four isolated units: pure scenario-profile data, a pure timeline generator (profile+duration+seed → sorted `Beat[]` + `IncidentWindow[]`), an executor that dispatches beats via `@sigmon/sdk`'s `createSignalMonitorClient` (backfill = fire now with a stamped past timestamp; live = sleep until real time, then fire) while a concurrent loop drives monitor-outage side effects, and a small standalone fake-target HTTP server for simulating an HTTP monitor going down. A CLI ties it together from a local config file.

**Tech Stack:** TypeScript (NodeNext), `@sigmon/sdk` (workspace), `fastify` + `zod` (matching `apps/api` conventions), `vitest`.

**Spec:** `docs/superpowers/specs/2026-08-28-loadgen-synthetic-telemetry-engine-design.md`

## Global Constraints

- New package `packages/loadgen`, `"type": "module"`, matching `packages/mcp`'s structure (`package.json`, `tsconfig.json` extending `../../tsconfig.base.json`, `src/`, root-level vitest picks up `packages/**/*.test.ts` automatically — no per-package vitest config needed).
- No admin login, no auto-provisioning. The tool only ever holds ingestion API keys and (optionally) monitor secrets the operator already created.
- No safety guardrail against production project names — declined during brainstorming.
- Monitor-outage simulation (both HTTP and heartbeat) only ever acts on windows that fall at or after the run's `nowMs` (live portion). A window entirely in the backfilled past is skipped, not attempted.
- Signal scope: events, errors, traces+spans, LLM calls, identify, breadcrumbs. No session replay, feedback, Web Vitals, or click maps (browser-only SDK features, explicitly out of scope).
- Every ingestion call goes through `@sigmon/sdk`'s public `createSignalMonitorClient` — never reach into the SDK's internal `retry.ts`/`sendSignal` (not part of its public export surface).
- Verification gate for every task: the task's own new/changed tests pass. Final task (Task 10) runs the full repo gate: `pnpm test`, `pnpm build`, `pnpm --filter @sigmon/sdk build`, `docker compose config --quiet`.

---

## Task 1: Package scaffold, core types, and the `ecommerce` profile

**Files:**
- Create: `packages/loadgen/package.json`
- Create: `packages/loadgen/tsconfig.json`
- Create: `packages/loadgen/src/types.ts`
- Create: `packages/loadgen/src/profiles/ecommerce.ts`
- Create: `packages/loadgen/src/profiles/validate.ts`
- Test: `packages/loadgen/src/profiles/validate.test.ts`

**Interfaces:**
- Produces: `ServiceDefinition`, `IncidentTemplate`, `TenantIdentity`, `UserIdentity`, `Profile` (all in `types.ts`); `ECOMMERCE_PROFILE: Profile` (in `profiles/ecommerce.ts`); `validateProfile(profile: Profile): string[]` (in `profiles/validate.ts` — returns an array of human-readable problem descriptions, empty array means valid).

- [ ] **Step 1: Create the package scaffold**

`packages/loadgen/package.json`:

```json
{
  "name": "@sigmon/loadgen",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "sigmon-loadgen": "./dist/run.js",
    "sigmon-loadgen-fake-target": "./dist/fake-target-bin.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@sigmon/sdk": "workspace:*",
    "fastify": "^5.8.5",
    "zod": "^4.4.2"
  }
}
```

`packages/loadgen/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "noEmit": false
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write core types**

`packages/loadgen/src/types.ts`:

```typescript
import type { SignalMetadata, SignalStatus } from "@sigmon/sdk";

export type MonitorKind = "http" | "heartbeat";

export type ServiceDefinition = {
  name: string;
  role: string;
  callsServices: string[];
  eventsPerHour: number;
  errorRatePercent: number;
  tracesPerHour: number;
  hasLlmCalls: boolean;
  llmCallsPerHour: number;
};

export type IncidentTemplate = {
  key: string;
  serviceName: string;
  errorRateMultiplier: number;
  llmCallMultiplier: number;
  durationMinutes: number;
  monitorKind?: MonitorKind;
};

export type TenantIdentity = {
  tenantId: string;
  traits: SignalMetadata;
};

export type UserIdentity = {
  userId: string;
  tenantId?: string;
  traits: SignalMetadata;
};

export type Profile = {
  key: string;
  services: ServiceDefinition[];
  incidents: IncidentTemplate[];
  tenants: TenantIdentity[];
  users: UserIdentity[];
};

type BeatBase = {
  timestampMs: number;
  projectIndex: number;
  serviceName: string;
};

export type EventBeat = BeatBase & {
  kind: "event";
  name: string;
  properties: SignalMetadata;
};

export type ErrorBeat = BeatBase & {
  kind: "error";
  message: string;
  severity: "error";
  traceId?: string;
};

export type TraceBeat = BeatBase & {
  kind: "trace";
  traceId: string;
  name: string;
  status: SignalStatus;
  durationMs: number;
};

export type SpanBeat = BeatBase & {
  kind: "span";
  traceId: string;
  name: string;
  status: SignalStatus;
  durationMs: number;
};

export type LlmCallBeat = BeatBase & {
  kind: "llmCall";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  status: SignalStatus;
};

export type IdentifyUserBeat = BeatBase & {
  kind: "identifyUser";
  userId: string;
  tenantId?: string;
  traits: SignalMetadata;
};

export type IdentifyTenantBeat = BeatBase & {
  kind: "identifyTenant";
  tenantId: string;
  traits: SignalMetadata;
};

export type BreadcrumbBeat = BeatBase & {
  kind: "breadcrumb";
  message: string;
};

export type Beat =
  | EventBeat
  | ErrorBeat
  | TraceBeat
  | SpanBeat
  | LlmCallBeat
  | IdentifyUserBeat
  | IdentifyTenantBeat
  | BreadcrumbBeat;

export type IncidentWindow = {
  startMs: number;
  endMs: number;
  projectIndex: number;
  serviceName: string;
  incidentKey: string;
  errorRateMultiplier: number;
  llmCallMultiplier: number;
  monitorKind?: MonitorKind;
};

export type Timeline = {
  beats: Beat[];
  incidentWindows: IncidentWindow[];
};
```

- [ ] **Step 3: Write the `ecommerce` profile**

`packages/loadgen/src/profiles/ecommerce.ts`:

```typescript
import type { Profile } from "../types.js";

export const ECOMMERCE_PROFILE: Profile = {
  key: "ecommerce",
  services: [
    { name: "api-gateway", role: "edge", callsServices: ["checkout", "catalog"], eventsPerHour: 600, errorRatePercent: 1, tracesPerHour: 200, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "checkout", role: "core", callsServices: ["payments", "inventory"], eventsPerHour: 300, errorRatePercent: 2, tracesPerHour: 150, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "payments", role: "core", callsServices: [], eventsPerHour: 150, errorRatePercent: 0.5, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "inventory", role: "core", callsServices: [], eventsPerHour: 100, errorRatePercent: 1, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "catalog", role: "core", callsServices: [], eventsPerHour: 400, errorRatePercent: 0.5, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 }
  ],
  incidents: [
    { key: "checkout_outage", serviceName: "checkout", errorRateMultiplier: 15, llmCallMultiplier: 1, durationMinutes: 20, monitorKind: "http" }
  ],
  tenants: [
    { tenantId: "tenant_acme", traits: { plan: "enterprise", employees: 500 } },
    { tenantId: "tenant_globex", traits: { plan: "pro", employees: 80 } },
    { tenantId: "tenant_initech", traits: { plan: "starter", employees: 12 } }
  ],
  users: [
    { userId: "user_alice", tenantId: "tenant_acme", traits: { role: "admin" } },
    { userId: "user_bob", tenantId: "tenant_acme", traits: { role: "member" } },
    { userId: "user_carol", tenantId: "tenant_globex", traits: { role: "admin" } },
    { userId: "user_dave", tenantId: "tenant_globex", traits: { role: "member" } },
    { userId: "user_erin", tenantId: "tenant_initech", traits: { role: "admin" } }
  ]
};
```

- [ ] **Step 4: Write the failing profile-validation test**

`packages/loadgen/src/profiles/validate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateProfile } from "./validate.js";
import { ECOMMERCE_PROFILE } from "./ecommerce.js";
import type { Profile } from "../types.js";

describe("validateProfile", () => {
  it("returns no problems for the ecommerce profile", () => {
    expect(validateProfile(ECOMMERCE_PROFILE)).toEqual([]);
  });

  it("flags a service that calls an undeclared service", () => {
    const broken: Profile = {
      ...ECOMMERCE_PROFILE,
      services: [
        { ...ECOMMERCE_PROFILE.services[0], callsServices: ["nonexistent"] },
        ...ECOMMERCE_PROFILE.services.slice(1)
      ]
    };

    expect(validateProfile(broken)).toEqual([
      'service "api-gateway" calls undeclared service "nonexistent"'
    ]);
  });

  it("flags an incident targeting an undeclared service", () => {
    const broken: Profile = {
      ...ECOMMERCE_PROFILE,
      incidents: [{ key: "bad", serviceName: "nonexistent", errorRateMultiplier: 2, llmCallMultiplier: 1, durationMinutes: 5 }]
    };

    expect(validateProfile(broken)).toEqual([
      'incident "bad" targets undeclared service "nonexistent"'
    ]);
  });

  it("flags a user whose tenantId is not one of the declared tenants", () => {
    const broken: Profile = {
      ...ECOMMERCE_PROFILE,
      users: [{ userId: "user_orphan", tenantId: "tenant_nonexistent", traits: {} }]
    };

    expect(validateProfile(broken)).toEqual([
      'user "user_orphan" references undeclared tenant "tenant_nonexistent"'
    ]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/profiles/validate.test.ts`
Expected: FAIL — `validate.ts` does not exist yet (module not found).

- [ ] **Step 6: Write `validateProfile`**

`packages/loadgen/src/profiles/validate.ts`:

```typescript
import type { Profile } from "../types.js";

export function validateProfile(profile: Profile): string[] {
  const problems: string[] = [];
  const serviceNames = new Set(profile.services.map((service) => service.name));
  const tenantIds = new Set(profile.tenants.map((tenant) => tenant.tenantId));

  for (const service of profile.services) {
    for (const calleeName of service.callsServices) {
      if (!serviceNames.has(calleeName)) {
        problems.push(`service "${service.name}" calls undeclared service "${calleeName}"`);
      }
    }
  }

  for (const incident of profile.incidents) {
    if (!serviceNames.has(incident.serviceName)) {
      problems.push(`incident "${incident.key}" targets undeclared service "${incident.serviceName}"`);
    }
  }

  for (const user of profile.users) {
    if (user.tenantId !== undefined && !tenantIds.has(user.tenantId)) {
      problems.push(`user "${user.userId}" references undeclared tenant "${user.tenantId}"`);
    }
  }

  return problems;
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/profiles/validate.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: Commit**

```bash
git add packages/loadgen/package.json packages/loadgen/tsconfig.json packages/loadgen/src/types.ts packages/loadgen/src/profiles/ecommerce.ts packages/loadgen/src/profiles/validate.ts packages/loadgen/src/profiles/validate.test.ts
git commit -m "feat(loadgen): scaffold package, core types, ecommerce profile"
```

---

## Task 2: `fintech` and `saas-b2b` profiles, profile registry

**Files:**
- Create: `packages/loadgen/src/profiles/fintech.ts`
- Create: `packages/loadgen/src/profiles/saas-b2b.ts`
- Create: `packages/loadgen/src/profiles/index.ts`
- Modify: `packages/loadgen/src/profiles/validate.test.ts`

**Interfaces:**
- Consumes: `validateProfile` (Task 1), `Profile` type (Task 1).
- Produces: `FINTECH_PROFILE: Profile`, `SAAS_B2B_PROFILE: Profile`, `PROFILES: Record<"ecommerce" | "fintech" | "saas-b2b", Profile>` (in `profiles/index.ts`).

- [ ] **Step 1: Write the failing test — every built-in profile validates clean**

Add to `packages/loadgen/src/profiles/validate.test.ts` (append inside the existing `describe` block, after the last `it`):

```typescript
  it("returns no problems for every built-in profile", async () => {
    const { PROFILES } = await import("./index.js");
    for (const profile of Object.values(PROFILES)) {
      expect(validateProfile(profile)).toEqual([]);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/profiles/validate.test.ts`
Expected: FAIL — `./index.js` does not exist yet.

- [ ] **Step 3: Write the `fintech` profile**

`packages/loadgen/src/profiles/fintech.ts`:

```typescript
import type { Profile } from "../types.js";

export const FINTECH_PROFILE: Profile = {
  key: "fintech",
  services: [
    { name: "api-gateway", role: "edge", callsServices: ["ledger", "fraud-check"], eventsPerHour: 500, errorRatePercent: 0.5, tracesPerHour: 200, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "ledger", role: "core", callsServices: [], eventsPerHour: 350, errorRatePercent: 0.2, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "fraud-check", role: "core", callsServices: [], eventsPerHour: 200, errorRatePercent: 1, tracesPerHour: 0, hasLlmCalls: true, llmCallsPerHour: 200 }
  ],
  incidents: [
    { key: "fraud_check_degraded", serviceName: "fraud-check", errorRateMultiplier: 10, llmCallMultiplier: 1, durationMinutes: 15, monitorKind: "heartbeat" }
  ],
  tenants: [
    { tenantId: "tenant_northwind", traits: { plan: "enterprise", region: "us" } },
    { tenantId: "tenant_contoso", traits: { plan: "pro", region: "eu" } }
  ],
  users: [
    { userId: "user_frank", tenantId: "tenant_northwind", traits: { role: "admin" } },
    { userId: "user_grace", tenantId: "tenant_northwind", traits: { role: "member" } },
    { userId: "user_heidi", tenantId: "tenant_contoso", traits: { role: "admin" } }
  ]
};
```

- [ ] **Step 4: Write the `saas-b2b` profile**

`packages/loadgen/src/profiles/saas-b2b.ts`:

```typescript
import type { Profile } from "../types.js";

export const SAAS_B2B_PROFILE: Profile = {
  key: "saas-b2b",
  services: [
    { name: "api-gateway", role: "edge", callsServices: ["billing", "support-bot"], eventsPerHour: 450, errorRatePercent: 0.5, tracesPerHour: 180, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "billing", role: "core", callsServices: [], eventsPerHour: 120, errorRatePercent: 0.3, tracesPerHour: 0, hasLlmCalls: false, llmCallsPerHour: 0 },
    { name: "support-bot", role: "core", callsServices: [], eventsPerHour: 250, errorRatePercent: 0.5, tracesPerHour: 0, hasLlmCalls: true, llmCallsPerHour: 500 }
  ],
  incidents: [
    { key: "llm_cost_spike", serviceName: "support-bot", errorRateMultiplier: 1, llmCallMultiplier: 8, durationMinutes: 30 }
  ],
  tenants: [
    { tenantId: "tenant_umbrella", traits: { plan: "enterprise", seats: 200 } },
    { tenantId: "tenant_soylent", traits: { plan: "pro", seats: 40 } }
  ],
  users: [
    { userId: "user_ivan", tenantId: "tenant_umbrella", traits: { role: "admin" } },
    { userId: "user_judy", tenantId: "tenant_umbrella", traits: { role: "member" } },
    { userId: "user_karl", tenantId: "tenant_soylent", traits: { role: "admin" } }
  ]
};
```

Note: `llm_cost_spike` has no `monitorKind` — it is a pure LLM-cost spike with no monitor tie-in, exercising the case where an incident affects rates but never opens an `IncidentWindow` with a `monitorKind` (so the executor's outage-handling loop, built in Task 7, correctly skips it).

- [ ] **Step 5: Write the profile registry**

`packages/loadgen/src/profiles/index.ts`:

```typescript
import type { Profile } from "../types.js";
import { ECOMMERCE_PROFILE } from "./ecommerce.js";
import { FINTECH_PROFILE } from "./fintech.js";
import { SAAS_B2B_PROFILE } from "./saas-b2b.js";

export const PROFILES: Record<string, Profile> = {
  ecommerce: ECOMMERCE_PROFILE,
  fintech: FINTECH_PROFILE,
  "saas-b2b": SAAS_B2B_PROFILE
};

export { ECOMMERCE_PROFILE, FINTECH_PROFILE, SAAS_B2B_PROFILE };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/profiles/validate.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add packages/loadgen/src/profiles/fintech.ts packages/loadgen/src/profiles/saas-b2b.ts packages/loadgen/src/profiles/index.ts packages/loadgen/src/profiles/validate.test.ts
git commit -m "feat(loadgen): add fintech and saas-b2b profiles, profile registry"
```

---

## Task 3: Seeded RNG, baseline event and error beat generation

**Files:**
- Create: `packages/loadgen/src/rng.ts`
- Create: `packages/loadgen/src/rng.test.ts`
- Create: `packages/loadgen/src/generate/events.ts`
- Create: `packages/loadgen/src/generate/events.test.ts`
- Create: `packages/loadgen/src/generate/errors.ts`
- Create: `packages/loadgen/src/generate/errors.test.ts`

**Interfaces:**
- Consumes: `ServiceDefinition`, `EventBeat`, `ErrorBeat` (Task 1).
- Produces: `createRng(seed: number): () => number`; `generateEventBeats(service, projectIndex, windowStartMs, windowEndMs, rng): EventBeat[]`; `generateErrorBeats(service, projectIndex, windowStartMs, windowEndMs, rng, errorMultiplierAt: (timestampMs: number) => number): ErrorBeat[]`.

- [ ] **Step 1: Write the failing RNG test**

`packages/loadgen/src/rng.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createRng } from "./rng.js";

describe("createRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const sequenceA = [a(), a(), a()];
    const sequenceB = [b(), b(), b()];
    expect(sequenceA).toEqual(sequenceB);
  });

  it("produces values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 50; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("produces a different sequence for a different seed", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/rng.test.ts`
Expected: FAIL — `./rng.js` does not exist.

- [ ] **Step 3: Implement the seeded RNG**

`packages/loadgen/src/rng.ts`:

```typescript
// Deterministic PRNG (mulberry32) — same seed always produces the same sequence, which is what
// makes generateTimeline's output reproducible for a given seed.
export function createRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/rng.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing event-beat generator test**

`packages/loadgen/src/generate/events.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateEventBeats } from "./events.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";

const service: ServiceDefinition = {
  name: "checkout",
  role: "core",
  callsServices: [],
  eventsPerHour: 60,
  errorRatePercent: 2,
  tracesPerHour: 0,
  hasLlmCalls: false,
  llmCallsPerHour: 0
};

describe("generateEventBeats", () => {
  it("generates one beat per configured hourly rate across a one-hour window", () => {
    const beats = generateEventBeats(service, 0, 0, 3_600_000, createRng(1));
    expect(beats).toHaveLength(60);
  });

  it("keeps every beat within the window and sorted ascending", () => {
    const beats = generateEventBeats(service, 0, 0, 3_600_000, createRng(1));
    for (const beat of beats) {
      expect(beat.timestampMs).toBeGreaterThanOrEqual(0);
      expect(beat.timestampMs).toBeLessThan(3_600_000);
    }
    const timestamps = beats.map((beat) => beat.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("stamps projectIndex, serviceName, and event kind correctly", () => {
    const beats = generateEventBeats(service, 2, 0, 60_000, createRng(1));
    expect(beats[0]).toMatchObject({ kind: "event", projectIndex: 2, serviceName: "checkout", name: "checkout.request" });
  });

  it("returns nothing for a service with zero event rate", () => {
    const beats = generateEventBeats({ ...service, eventsPerHour: 0 }, 0, 0, 3_600_000, createRng(1));
    expect(beats).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/generate/events.test.ts`
Expected: FAIL — `./events.js` does not exist.

- [ ] **Step 7: Implement `generateEventBeats`**

`packages/loadgen/src/generate/events.ts`:

```typescript
import type { EventBeat, ServiceDefinition } from "../types.js";

export function generateEventBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number
): EventBeat[] {
  if (service.eventsPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / service.eventsPerHour;
  const beats: EventBeat[] = [];

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    const jitterMs = (rng() - 0.5) * intervalMs * 0.2;
    const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
    beats.push({
      kind: "event",
      timestampMs,
      projectIndex,
      serviceName: service.name,
      name: `${service.name}.request`,
      properties: { role: service.role }
    });
  }

  return beats;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/generate/events.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Write the failing error-beat generator test**

`packages/loadgen/src/generate/errors.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateErrorBeats } from "./errors.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";

const service: ServiceDefinition = {
  name: "checkout",
  role: "core",
  callsServices: [],
  eventsPerHour: 60,
  errorRatePercent: 10,
  tracesPerHour: 0,
  hasLlmCalls: false,
  llmCallsPerHour: 0
};

describe("generateErrorBeats", () => {
  it("generates baseline errors at eventsPerHour * errorRatePercent when the multiplier is always 1", () => {
    const beats = generateErrorBeats(service, 0, 0, 3_600_000, createRng(1), () => 1);
    // 60 events/hr * 10% = 6 errors/hr baseline
    expect(beats).toHaveLength(6);
  });

  it("emits more errors inside a window where the multiplier is elevated", () => {
    const beats = generateErrorBeats(service, 0, 0, 3_600_000, createRng(1), (t) => (t >= 1_000_000 && t < 2_000_000 ? 5 : 1));
    const insideSpike = beats.filter((beat) => beat.timestampMs >= 1_000_000 && beat.timestampMs < 2_000_000);
    const outsideSpike = beats.filter((beat) => beat.timestampMs < 1_000_000);
    expect(insideSpike.length).toBeGreaterThan(outsideSpike.length);
  });

  it("stamps kind, severity, projectIndex, and serviceName correctly", () => {
    const beats = generateErrorBeats(service, 3, 0, 60_000, createRng(1), () => 1);
    for (const beat of beats) {
      expect(beat).toMatchObject({ kind: "error", severity: "error", projectIndex: 3, serviceName: "checkout" });
    }
  });

  it("returns beats sorted ascending by timestamp", () => {
    const beats = generateErrorBeats(service, 0, 0, 3_600_000, createRng(1), (t) => (t >= 1_000_000 && t < 1_200_000 ? 8 : 1));
    const timestamps = beats.map((beat) => beat.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it("returns nothing when errorRatePercent is zero", () => {
    const beats = generateErrorBeats({ ...service, errorRatePercent: 0 }, 0, 0, 3_600_000, createRng(1), () => 1);
    expect(beats).toEqual([]);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/generate/errors.test.ts`
Expected: FAIL — `./errors.js` does not exist.

- [ ] **Step 11: Implement `generateErrorBeats`**

`packages/loadgen/src/generate/errors.ts`:

```typescript
import type { ErrorBeat, ServiceDefinition } from "../types.js";

export function generateErrorBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number,
  errorMultiplierAt: (timestampMs: number) => number
): ErrorBeat[] {
  if (service.eventsPerHour <= 0 || service.errorRatePercent <= 0) {
    return [];
  }

  const baseErrorsPerHour = service.eventsPerHour * (service.errorRatePercent / 100);
  if (baseErrorsPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / baseErrorsPerHour;
  const beats: ErrorBeat[] = [];

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    const count = Math.max(0, Math.round(errorMultiplierAt(t)));
    for (let i = 0; i < count; i += 1) {
      const jitterMs = rng() * intervalMs * 0.5;
      const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
      beats.push({
        kind: "error",
        timestampMs,
        projectIndex,
        serviceName: service.name,
        message: `${service.name} request failed`,
        severity: "error"
      });
    }
  }

  return beats.sort((a, b) => a.timestampMs - b.timestampMs);
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/generate/errors.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 13: Commit**

```bash
git add packages/loadgen/src/rng.ts packages/loadgen/src/rng.test.ts packages/loadgen/src/generate/events.ts packages/loadgen/src/generate/events.test.ts packages/loadgen/src/generate/errors.ts packages/loadgen/src/generate/errors.test.ts
git commit -m "feat(loadgen): seeded RNG, event and error beat generators"
```

---

## Task 4: Trace/span coherent generation

**Files:**
- Create: `packages/loadgen/src/generate/traces.ts`
- Create: `packages/loadgen/src/generate/traces.test.ts`

**Interfaces:**
- Consumes: `ServiceDefinition`, `TraceBeat`, `SpanBeat` (Task 1), `createRng` (Task 3).
- Produces: `generateTraceBeats(service, projectIndex, windowStartMs, windowEndMs, rng): (TraceBeat | SpanBeat)[]`.

- [ ] **Step 1: Write the failing test**

`packages/loadgen/src/generate/traces.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateTraceBeats } from "./traces.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";
import type { SpanBeat, TraceBeat } from "../types.js";

const service: ServiceDefinition = {
  name: "checkout",
  role: "core",
  callsServices: ["payments", "inventory"],
  eventsPerHour: 300,
  errorRatePercent: 2,
  tracesPerHour: 60,
  hasLlmCalls: false,
  llmCallsPerHour: 0
};

describe("generateTraceBeats", () => {
  it("emits one trace beat and one span beat per callee, per tick", () => {
    const beats = generateTraceBeats(service, 0, 0, 3_600_000, createRng(1));
    const traces = beats.filter((beat): beat is TraceBeat => beat.kind === "trace");
    const spans = beats.filter((beat): beat is SpanBeat => beat.kind === "span");

    expect(traces).toHaveLength(60);
    expect(spans).toHaveLength(60 * service.callsServices.length);
  });

  it("gives every span the same traceId as its parent trace, and only from declared callees", () => {
    const beats = generateTraceBeats(service, 0, 0, 60_000, createRng(1));
    const trace = beats.find((beat): beat is TraceBeat => beat.kind === "trace");
    const spans = beats.filter((beat): beat is SpanBeat => beat.kind === "span" && beat.traceId === trace?.traceId);

    expect(trace).toBeDefined();
    expect(spans).toHaveLength(2);
    expect(spans.map((span) => span.serviceName).sort()).toEqual(["inventory", "payments"]);
    for (const span of spans) {
      expect(span.traceId).toBe(trace!.traceId);
    }
  });

  it("gives a leaf service (no callees) traces with no spans", () => {
    const leaf: ServiceDefinition = { ...service, name: "payments", callsServices: [], tracesPerHour: 30 };
    const beats = generateTraceBeats(leaf, 0, 0, 3_600_000, createRng(1));
    expect(beats.every((beat) => beat.kind === "trace")).toBe(true);
    expect(beats).toHaveLength(30);
  });

  it("returns nothing when tracesPerHour is zero", () => {
    const beats = generateTraceBeats({ ...service, tracesPerHour: 0 }, 0, 0, 3_600_000, createRng(1));
    expect(beats).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/generate/traces.test.ts`
Expected: FAIL — `./traces.js` does not exist.

- [ ] **Step 3: Implement `generateTraceBeats`**

`packages/loadgen/src/generate/traces.ts`:

```typescript
import type { ServiceDefinition, SpanBeat, TraceBeat } from "../types.js";

export function generateTraceBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number
): (TraceBeat | SpanBeat)[] {
  if (service.tracesPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / service.tracesPerHour;
  const beats: (TraceBeat | SpanBeat)[] = [];
  let counter = 0;

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    counter += 1;
    const jitterMs = (rng() - 0.5) * intervalMs * 0.2;
    const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
    const traceId = `trc_${service.name}_${projectIndex}_${counter}`;
    const rootDurationMs = 40 + Math.round(rng() * 200);

    beats.push({
      kind: "trace",
      timestampMs,
      projectIndex,
      serviceName: service.name,
      traceId,
      name: `${service.name}.handle`,
      status: "success",
      durationMs: rootDurationMs
    });

    for (const calleeName of service.callsServices) {
      const spanDurationMs = 10 + Math.round(rng() * 80);
      beats.push({
        kind: "span",
        timestampMs: Math.min(windowEndMs - 1, timestampMs + 1),
        projectIndex,
        serviceName: calleeName,
        traceId,
        name: `${calleeName}.call`,
        status: "success",
        durationMs: spanDurationMs
      });
    }
  }

  return beats;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/generate/traces.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/loadgen/src/generate/traces.ts packages/loadgen/src/generate/traces.test.ts
git commit -m "feat(loadgen): trace/span coherent beat generator"
```

---

## Task 5: LLM call, identify, and breadcrumb beat generation

**Files:**
- Create: `packages/loadgen/src/generate/llm.ts`
- Create: `packages/loadgen/src/generate/llm.test.ts`
- Create: `packages/loadgen/src/generate/identity.ts`
- Create: `packages/loadgen/src/generate/identity.test.ts`
- Create: `packages/loadgen/src/generate/breadcrumbs.ts`
- Create: `packages/loadgen/src/generate/breadcrumbs.test.ts`

**Interfaces:**
- Consumes: `ServiceDefinition`, `Profile`, `LlmCallBeat`, `IdentifyUserBeat`, `IdentifyTenantBeat`, `BreadcrumbBeat`, `ErrorBeat` (Task 1), `createRng` (Task 3).
- Produces: `generateLlmCallBeats(service, projectIndex, windowStartMs, windowEndMs, rng, llmCallMultiplierAt): LlmCallBeat[]`; `generateIdentityBeats(profile, projectIndex, windowStartMs): (IdentifyUserBeat | IdentifyTenantBeat)[]`; `generateBreadcrumbBeats(errorBeats: ErrorBeat[]): BreadcrumbBeat[]`.

- [ ] **Step 1: Write the failing LLM-call test**

`packages/loadgen/src/generate/llm.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateLlmCallBeats } from "./llm.js";
import { createRng } from "../rng.js";
import type { ServiceDefinition } from "../types.js";

const service: ServiceDefinition = {
  name: "support-bot",
  role: "core",
  callsServices: [],
  eventsPerHour: 250,
  errorRatePercent: 0.5,
  tracesPerHour: 0,
  hasLlmCalls: true,
  llmCallsPerHour: 60
};

describe("generateLlmCallBeats", () => {
  it("generates one call per configured hourly rate when the multiplier is 1", () => {
    const beats = generateLlmCallBeats(service, 0, 0, 3_600_000, createRng(1), () => 1);
    expect(beats).toHaveLength(60);
  });

  it("emits more calls inside a cost-spike window", () => {
    const beats = generateLlmCallBeats(service, 0, 0, 3_600_000, createRng(1), (t) => (t >= 1_000_000 && t < 1_600_000 ? 8 : 1));
    const inside = beats.filter((beat) => beat.timestampMs >= 1_000_000 && beat.timestampMs < 1_600_000);
    const outside = beats.filter((beat) => beat.timestampMs < 1_000_000);
    expect(inside.length).toBeGreaterThan(outside.length);
  });

  it("stamps provider, model, and positive cost/token/latency fields", () => {
    const beats = generateLlmCallBeats(service, 1, 0, 60_000, createRng(1), () => 1);
    for (const beat of beats) {
      expect(beat.kind).toBe("llmCall");
      expect(beat.provider).toBe("openai");
      expect(beat.inputTokens).toBeGreaterThan(0);
      expect(beat.outputTokens).toBeGreaterThan(0);
      expect(beat.costUsd).toBeGreaterThan(0);
      expect(beat.latencyMs).toBeGreaterThan(0);
      expect(beat.status).toBe("success");
    }
  });

  it("returns nothing when the service has no LLM calls", () => {
    const beats = generateLlmCallBeats({ ...service, hasLlmCalls: false }, 0, 0, 3_600_000, createRng(1), () => 1);
    expect(beats).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/generate/llm.test.ts`
Expected: FAIL — `./llm.js` does not exist.

- [ ] **Step 3: Implement `generateLlmCallBeats`**

`packages/loadgen/src/generate/llm.ts`:

```typescript
import type { LlmCallBeat, ServiceDefinition } from "../types.js";

export function generateLlmCallBeats(
  service: ServiceDefinition,
  projectIndex: number,
  windowStartMs: number,
  windowEndMs: number,
  rng: () => number,
  llmCallMultiplierAt: (timestampMs: number) => number
): LlmCallBeat[] {
  if (!service.hasLlmCalls || service.llmCallsPerHour <= 0) {
    return [];
  }

  const intervalMs = 3_600_000 / service.llmCallsPerHour;
  const beats: LlmCallBeat[] = [];

  for (let t = windowStartMs; t < windowEndMs; t += intervalMs) {
    const count = Math.max(1, Math.round(Math.max(0, llmCallMultiplierAt(t))));
    for (let i = 0; i < count; i += 1) {
      const jitterMs = rng() * intervalMs * 0.5;
      const timestampMs = Math.min(windowEndMs - 1, Math.max(windowStartMs, Math.round(t + jitterMs)));
      const inputTokens = 200 + Math.round(rng() * 800);
      const outputTokens = 100 + Math.round(rng() * 400);

      beats.push({
        kind: "llmCall",
        timestampMs,
        projectIndex,
        serviceName: service.name,
        provider: "openai",
        model: "gpt-5",
        inputTokens,
        outputTokens,
        costUsd: Number((inputTokens * 0.000003 + outputTokens * 0.000015).toFixed(6)),
        latencyMs: 300 + Math.round(rng() * 1200),
        status: "success"
      });
    }
  }

  return beats.sort((a, b) => a.timestampMs - b.timestampMs);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/generate/llm.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing identity test**

`packages/loadgen/src/generate/identity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateIdentityBeats } from "./identity.js";
import { ECOMMERCE_PROFILE } from "../profiles/ecommerce.js";

describe("generateIdentityBeats", () => {
  it("emits one identify beat per tenant and one per user, all at windowStartMs", () => {
    const beats = generateIdentityBeats(ECOMMERCE_PROFILE, 0, 500_000);
    const tenantBeats = beats.filter((beat) => beat.kind === "identifyTenant");
    const userBeats = beats.filter((beat) => beat.kind === "identifyUser");

    expect(tenantBeats).toHaveLength(ECOMMERCE_PROFILE.tenants.length);
    expect(userBeats).toHaveLength(ECOMMERCE_PROFILE.users.length);
    for (const beat of beats) {
      expect(beat.timestampMs).toBe(500_000);
      expect(beat.projectIndex).toBe(0);
    }
  });

  it("carries the tenant/user id and traits through unchanged", () => {
    const beats = generateIdentityBeats(ECOMMERCE_PROFILE, 0, 0);
    const firstTenant = ECOMMERCE_PROFILE.tenants[0];
    const tenantBeat = beats.find((beat) => beat.kind === "identifyTenant" && beat.tenantId === firstTenant.tenantId);
    expect(tenantBeat).toMatchObject({ tenantId: firstTenant.tenantId, traits: firstTenant.traits });

    const firstUser = ECOMMERCE_PROFILE.users[0];
    const userBeat = beats.find((beat) => beat.kind === "identifyUser" && beat.userId === firstUser.userId);
    expect(userBeat).toMatchObject({ userId: firstUser.userId, tenantId: firstUser.tenantId, traits: firstUser.traits });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/generate/identity.test.ts`
Expected: FAIL — `./identity.js` does not exist.

- [ ] **Step 7: Implement `generateIdentityBeats`**

`packages/loadgen/src/generate/identity.ts`:

```typescript
import type { IdentifyTenantBeat, IdentifyUserBeat, Profile } from "../types.js";

export function generateIdentityBeats(
  profile: Profile,
  projectIndex: number,
  windowStartMs: number
): (IdentifyUserBeat | IdentifyTenantBeat)[] {
  const anchorServiceName = profile.services[0].name;
  const beats: (IdentifyUserBeat | IdentifyTenantBeat)[] = [];

  for (const tenant of profile.tenants) {
    beats.push({
      kind: "identifyTenant",
      timestampMs: windowStartMs,
      projectIndex,
      serviceName: anchorServiceName,
      tenantId: tenant.tenantId,
      traits: tenant.traits
    });
  }

  for (const user of profile.users) {
    beats.push({
      kind: "identifyUser",
      timestampMs: windowStartMs,
      projectIndex,
      serviceName: anchorServiceName,
      userId: user.userId,
      tenantId: user.tenantId,
      traits: user.traits
    });
  }

  return beats;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/generate/identity.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 9: Write the failing breadcrumb test**

`packages/loadgen/src/generate/breadcrumbs.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateBreadcrumbBeats } from "./breadcrumbs.js";
import type { ErrorBeat } from "../types.js";

const errorBeats: ErrorBeat[] = [
  { kind: "error", timestampMs: 10_000, projectIndex: 0, serviceName: "checkout", message: "checkout request failed", severity: "error" },
  { kind: "error", timestampMs: 20_000, projectIndex: 1, serviceName: "payments", message: "payments request failed", severity: "error" }
];

describe("generateBreadcrumbBeats", () => {
  it("emits one breadcrumb per error beat, 2 seconds earlier, in the same project/service", () => {
    const beats = generateBreadcrumbBeats(errorBeats);
    expect(beats).toHaveLength(2);
    expect(beats[0]).toMatchObject({ kind: "breadcrumb", timestampMs: 8_000, projectIndex: 0, serviceName: "checkout" });
    expect(beats[1]).toMatchObject({ kind: "breadcrumb", timestampMs: 18_000, projectIndex: 1, serviceName: "payments" });
  });

  it("returns nothing when there are no error beats", () => {
    expect(generateBreadcrumbBeats([])).toEqual([]);
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/generate/breadcrumbs.test.ts`
Expected: FAIL — `./breadcrumbs.js` does not exist.

- [ ] **Step 11: Implement `generateBreadcrumbBeats`**

`packages/loadgen/src/generate/breadcrumbs.ts`:

```typescript
import type { BreadcrumbBeat, ErrorBeat } from "../types.js";

export function generateBreadcrumbBeats(errorBeats: ErrorBeat[]): BreadcrumbBeat[] {
  return errorBeats.map((error) => ({
    kind: "breadcrumb",
    timestampMs: error.timestampMs - 2_000,
    projectIndex: error.projectIndex,
    serviceName: error.serviceName,
    message: `navigating to ${error.serviceName}`
  }));
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/generate/breadcrumbs.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 13: Commit**

```bash
git add packages/loadgen/src/generate/llm.ts packages/loadgen/src/generate/llm.test.ts packages/loadgen/src/generate/identity.ts packages/loadgen/src/generate/identity.test.ts packages/loadgen/src/generate/breadcrumbs.ts packages/loadgen/src/generate/breadcrumbs.test.ts
git commit -m "feat(loadgen): LLM call, identify, and breadcrumb beat generators"
```

---

## Task 6: Incident window placement and the top-level `generateTimeline`

**Files:**
- Create: `packages/loadgen/src/generate/incidents.ts`
- Create: `packages/loadgen/src/generate/incidents.test.ts`
- Create: `packages/loadgen/src/timeline.ts`
- Create: `packages/loadgen/src/timeline.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4, 5: `Profile`, `IncidentWindow`, `Timeline`, `createRng`, `generateEventBeats`, `generateErrorBeats`, `generateTraceBeats`, `generateLlmCallBeats`, `generateIdentityBeats`, `generateBreadcrumbBeats`.
- Produces: `placeIncidentWindows(profile, projectCount, windowStartMs, windowEndMs): IncidentWindow[]`; `generateTimeline(options: GenerateTimelineOptions): Timeline` where `GenerateTimelineOptions = { profile: Profile; projectCount: number; backfillMs: number; liveMs: number; nowMs: number; seed: number }`.

- [ ] **Step 1: Write the failing incident-window test**

`packages/loadgen/src/generate/incidents.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { placeIncidentWindows } from "./incidents.js";
import { ECOMMERCE_PROFILE } from "../profiles/ecommerce.js";
import { SAAS_B2B_PROFILE } from "../profiles/saas-b2b.js";

describe("placeIncidentWindows", () => {
  it("places one window per incident template per project, at the midpoint of the span", () => {
    const windows = placeIncidentWindows(ECOMMERCE_PROFILE, 2, 0, 3_600_000);
    expect(windows).toHaveLength(ECOMMERCE_PROFILE.incidents.length * 2);

    const projectZeroWindow = windows.find((window) => window.projectIndex === 0);
    expect(projectZeroWindow).toMatchObject({
      incidentKey: "checkout_outage",
      serviceName: "checkout",
      startMs: 1_800_000,
      endMs: 1_800_000 + 20 * 60_000,
      monitorKind: "http",
      errorRateMultiplier: 15,
      llmCallMultiplier: 1
    });
  });

  it("carries llmCallMultiplier for an incident with no monitorKind", () => {
    const windows = placeIncidentWindows(SAAS_B2B_PROFILE, 1, 0, 3_600_000);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ incidentKey: "llm_cost_spike", llmCallMultiplier: 8, monitorKind: undefined });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/generate/incidents.test.ts`
Expected: FAIL — `./incidents.js` does not exist.

- [ ] **Step 3: Implement `placeIncidentWindows`**

`packages/loadgen/src/generate/incidents.ts`:

```typescript
import type { IncidentWindow, Profile } from "../types.js";

export function placeIncidentWindows(
  profile: Profile,
  projectCount: number,
  windowStartMs: number,
  windowEndMs: number
): IncidentWindow[] {
  const midpointMs = windowStartMs + Math.floor((windowEndMs - windowStartMs) / 2);
  const windows: IncidentWindow[] = [];

  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    for (const incident of profile.incidents) {
      const startMs = midpointMs;
      const endMs = startMs + incident.durationMinutes * 60_000;
      windows.push({
        startMs,
        endMs,
        projectIndex,
        serviceName: incident.serviceName,
        incidentKey: incident.key,
        errorRateMultiplier: incident.errorRateMultiplier,
        llmCallMultiplier: incident.llmCallMultiplier,
        monitorKind: incident.monitorKind
      });
    }
  }

  return windows;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/generate/incidents.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing `generateTimeline` test**

`packages/loadgen/src/timeline.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { generateTimeline } from "./timeline.js";
import { ECOMMERCE_PROFILE } from "./profiles/ecommerce.js";

describe("generateTimeline", () => {
  it("produces beats sorted ascending, all within [nowMs - backfillMs, nowMs + liveMs)", () => {
    const nowMs = 10_000_000;
    const timeline = generateTimeline({ profile: ECOMMERCE_PROFILE, projectCount: 1, backfillMs: 3_600_000, liveMs: 1_800_000, nowMs, seed: 1 });

    expect(timeline.beats.length).toBeGreaterThan(0);
    const timestamps = timeline.beats.map((beat) => beat.timestampMs);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
    for (const beat of timeline.beats) {
      expect(beat.timestampMs).toBeGreaterThanOrEqual(nowMs - 3_600_000);
      expect(beat.timestampMs).toBeLessThan(nowMs + 1_800_000);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const options = { profile: ECOMMERCE_PROFILE, projectCount: 2, backfillMs: 600_000, liveMs: 0, nowMs: 5_000_000, seed: 99 };
    const first = generateTimeline(options);
    const second = generateTimeline(options);
    expect(first).toEqual(second);
  });

  it("produces beats for every projectIndex from 0 to projectCount - 1", () => {
    const timeline = generateTimeline({ profile: ECOMMERCE_PROFILE, projectCount: 3, backfillMs: 600_000, liveMs: 0, nowMs: 1_000_000, seed: 1 });
    const projectIndexes = new Set(timeline.beats.map((beat) => beat.projectIndex));
    expect(projectIndexes).toEqual(new Set([0, 1, 2]));
  });

  it("includes incident windows in the output", () => {
    const timeline = generateTimeline({ profile: ECOMMERCE_PROFILE, projectCount: 1, backfillMs: 3_600_000, liveMs: 0, nowMs: 3_600_000, seed: 1 });
    expect(timeline.incidentWindows).toHaveLength(1);
    expect(timeline.incidentWindows[0].incidentKey).toBe("checkout_outage");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/timeline.test.ts`
Expected: FAIL — `./timeline.js` does not exist.

- [ ] **Step 7: Implement `generateTimeline`**

`packages/loadgen/src/timeline.ts`:

```typescript
import { createRng } from "./rng.js";
import { generateBreadcrumbBeats } from "./generate/breadcrumbs.js";
import { generateErrorBeats } from "./generate/errors.js";
import { generateEventBeats } from "./generate/events.js";
import { generateIdentityBeats } from "./generate/identity.js";
import { placeIncidentWindows } from "./generate/incidents.js";
import { generateLlmCallBeats } from "./generate/llm.js";
import { generateTraceBeats } from "./generate/traces.js";
import type { Beat, Profile, Timeline } from "./types.js";

export type GenerateTimelineOptions = {
  profile: Profile;
  projectCount: number;
  backfillMs: number;
  liveMs: number;
  nowMs: number;
  seed: number;
};

export function generateTimeline(options: GenerateTimelineOptions): Timeline {
  const { profile, projectCount, backfillMs, liveMs, nowMs, seed } = options;
  const windowStartMs = nowMs - backfillMs;
  const windowEndMs = nowMs + liveMs;
  const rng = createRng(seed);
  const incidentWindows = placeIncidentWindows(profile, projectCount, windowStartMs, windowEndMs);

  const beats: Beat[] = [];

  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const projectWindows = incidentWindows.filter((window) => window.projectIndex === projectIndex);

    for (const service of profile.services) {
      const serviceWindows = projectWindows.filter((window) => window.serviceName === service.name);
      const errorMultiplierAt = (t: number): number => {
        const active = serviceWindows.find((window) => t >= window.startMs && t < window.endMs);
        return active ? active.errorRateMultiplier : 1;
      };
      const llmCallMultiplierAt = (t: number): number => {
        const active = serviceWindows.find((window) => t >= window.startMs && t < window.endMs);
        return active ? active.llmCallMultiplier : 1;
      };

      const errorBeats = generateErrorBeats(service, projectIndex, windowStartMs, windowEndMs, rng, errorMultiplierAt);

      beats.push(...generateEventBeats(service, projectIndex, windowStartMs, windowEndMs, rng));
      beats.push(...errorBeats);
      beats.push(...generateTraceBeats(service, projectIndex, windowStartMs, windowEndMs, rng));
      beats.push(...generateLlmCallBeats(service, projectIndex, windowStartMs, windowEndMs, rng, llmCallMultiplierAt));
      beats.push(...generateBreadcrumbBeats(errorBeats));
    }

    beats.push(...generateIdentityBeats(profile, projectIndex, windowStartMs));
  }

  beats.sort((a, b) => a.timestampMs - b.timestampMs);

  return { beats, incidentWindows };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/timeline.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add packages/loadgen/src/generate/incidents.ts packages/loadgen/src/generate/incidents.test.ts packages/loadgen/src/timeline.ts packages/loadgen/src/timeline.test.ts
git commit -m "feat(loadgen): incident window placement and top-level generateTimeline"
```

---

## Task 7: Executor — beat dispatch, backfill/live split, monitor-outage loop

**Files:**
- Create: `packages/loadgen/src/executor.ts`
- Create: `packages/loadgen/src/executor.test.ts`

**Interfaces:**
- Consumes: `Beat`, `IncidentWindow`, `Timeline` (Task 1), `SignalMonitorClient` (from `@sigmon/sdk`, public export).
- Produces: `dispatchBeat(client: SignalMonitorClient, beat: Beat): void`; `runExecutor(options: ExecutorOptions): Promise<ExecutorResult>` where:
  ```typescript
  export type ExecutorOptions = {
    timeline: Timeline;
    projectClients: SignalMonitorClient[];
    nowMs: number;
    backfillBatchSize?: number;
    sleepImpl?: (ms: number) => Promise<void>;
    nowImpl?: () => number;
    onProgress?: (sent: number, total: number) => void;
    onOutageStart?: (window: IncidentWindow) => Promise<void> | void;
    onOutageEnd?: (window: IncidentWindow) => Promise<void> | void;
  };
  export type ExecutorResult = { sent: number; failed: number; skippedOutageWindows: number };
  ```

- [ ] **Step 1: Write the failing executor test**

`packages/loadgen/src/executor.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { dispatchBeat, runExecutor } from "./executor.js";
import type { Beat, IncidentWindow, Timeline } from "./types.js";
import type { SignalMonitorClient } from "@sigmon/sdk";

function createFakeClient(): SignalMonitorClient & {
  calls: { method: string; args: unknown[] }[];
} {
  const calls: { method: string; args: unknown[] }[] = [];
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
  };

  return {
    calls,
    track: record("track"),
    assignExperiment: vi.fn(),
    evaluateFlag: vi.fn(),
    captureError: record("captureError"),
    breadcrumb: record("breadcrumb"),
    llm: record("llm"),
    trace: record("trace"),
    startTrace: vi.fn(),
    span: record("span"),
    webVital: vi.fn(),
    click: vi.fn(),
    replay: vi.fn(),
    profile: vi.fn(),
    submitSurvey: vi.fn(),
    feedback: vi.fn(),
    identify: vi.fn(),
    identifyUser: record("identifyUser"),
    identifyTenant: record("identifyTenant"),
    flush: vi.fn(async () => ({ sent: 1, failed: 0, retained: 0, dropped: 0 })),
    shutdown: vi.fn(async () => ({ sent: 0, failed: 0, retained: 0, dropped: 0 }))
  };
}

describe("dispatchBeat", () => {
  it("calls the matching client method for each beat kind", () => {
    const client = createFakeClient();
    const beats: Beat[] = [
      { kind: "event", timestampMs: 0, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} },
      { kind: "error", timestampMs: 0, projectIndex: 0, serviceName: "checkout", message: "boom", severity: "error" },
      { kind: "trace", timestampMs: 0, projectIndex: 0, serviceName: "checkout", traceId: "trc_1", name: "checkout.handle", status: "success", durationMs: 50 },
      { kind: "span", timestampMs: 0, projectIndex: 0, serviceName: "payments", traceId: "trc_1", name: "payments.call", status: "success", durationMs: 20 },
      { kind: "llmCall", timestampMs: 0, projectIndex: 0, serviceName: "support-bot", provider: "openai", model: "gpt-5", inputTokens: 100, outputTokens: 50, costUsd: 0.01, latencyMs: 300, status: "success" },
      { kind: "identifyUser", timestampMs: 0, projectIndex: 0, serviceName: "checkout", userId: "user_alice", tenantId: "tenant_acme", traits: {} },
      { kind: "identifyTenant", timestampMs: 0, projectIndex: 0, serviceName: "checkout", tenantId: "tenant_acme", traits: {} },
      { kind: "breadcrumb", timestampMs: 0, projectIndex: 0, serviceName: "checkout", message: "navigating to checkout" }
    ];

    for (const beat of beats) {
      dispatchBeat(client, beat);
    }

    expect(client.calls.map((call) => call.method)).toEqual([
      "track", "captureError", "trace", "span", "llm", "identifyUser", "identifyTenant", "breadcrumb"
    ]);
  });
});

describe("runExecutor", () => {
  it("fires past-timestamped beats immediately (backfill) without sleeping", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const timeline: Timeline = {
      beats: [
        { kind: "event", timestampMs: nowMs - 500_000, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} },
        { kind: "event", timestampMs: nowMs - 100_000, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} }
      ],
      incidentWindows: []
    };
    const sleepImpl = vi.fn(async () => {});

    const result = await runExecutor({ timeline, projectClients: [client], nowMs, sleepImpl });

    expect(sleepImpl).not.toHaveBeenCalled();
    expect(client.calls.filter((call) => call.method === "track")).toHaveLength(2);
    expect(result.sent).toBeGreaterThan(0);
  });

  it("sleeps until each future beat's scheduled time before firing it (live)", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const timeline: Timeline = {
      beats: [{ kind: "event", timestampMs: nowMs + 5_000, projectIndex: 0, serviceName: "checkout", name: "checkout.request", properties: {} }],
      incidentWindows: []
    };
    const sleepImpl = vi.fn(async () => {});
    const nowImpl = vi.fn(() => nowMs);

    await runExecutor({ timeline, projectClients: [client], nowMs, sleepImpl, nowImpl });

    expect(sleepImpl).toHaveBeenCalledWith(5_000);
    expect(client.calls.some((call) => call.method === "track")).toBe(true);
  });

  it("calls onOutageStart then onOutageEnd for a live-portion incident window, and skips a fully-backfilled one", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const liveWindow: IncidentWindow = {
      startMs: nowMs + 1_000,
      endMs: nowMs + 2_000,
      projectIndex: 0,
      serviceName: "checkout",
      incidentKey: "checkout_outage",
      errorRateMultiplier: 15,
      llmCallMultiplier: 1,
      monitorKind: "http"
    };
    const backfilledWindow: IncidentWindow = {
      startMs: nowMs - 10_000,
      endMs: nowMs - 5_000,
      projectIndex: 0,
      serviceName: "checkout",
      incidentKey: "old_outage",
      errorRateMultiplier: 15,
      llmCallMultiplier: 1,
      monitorKind: "http"
    };
    const timeline: Timeline = { beats: [], incidentWindows: [liveWindow, backfilledWindow] };
    const sleepImpl = vi.fn(async () => {});
    const nowImpl = vi.fn(() => nowMs);
    const onOutageStart = vi.fn();
    const onOutageEnd = vi.fn();

    const result = await runExecutor({ timeline, projectClients: [client], nowMs, sleepImpl, nowImpl, onOutageStart, onOutageEnd });

    expect(onOutageStart).toHaveBeenCalledWith(liveWindow);
    expect(onOutageEnd).toHaveBeenCalledWith(liveWindow);
    expect(onOutageStart).not.toHaveBeenCalledWith(backfilledWindow);
    expect(result.skippedOutageWindows).toBe(1);
  });

  it("flushes backfill beats in batches bounded by backfillBatchSize", async () => {
    const client = createFakeClient();
    const nowMs = 1_000_000;
    const beats: Beat[] = Array.from({ length: 5 }, (_, i) => ({
      kind: "event" as const,
      timestampMs: nowMs - 100_000 + i,
      projectIndex: 0,
      serviceName: "checkout",
      name: "checkout.request",
      properties: {}
    }));
    const timeline: Timeline = { beats, incidentWindows: [] };

    await runExecutor({ timeline, projectClients: [client], nowMs, backfillBatchSize: 2, sleepImpl: vi.fn(async () => {}) });

    // 5 beats, batch size 2: mid-loop flush after beat 2 and after beat 4, plus 1 final flush = 3 calls
    expect(client.flush).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/executor.test.ts`
Expected: FAIL — `./executor.js` does not exist.

- [ ] **Step 3: Implement the executor**

`packages/loadgen/src/executor.ts`:

```typescript
import type { SignalMonitorClient } from "@sigmon/sdk";
import type { Beat, IncidentWindow, Timeline } from "./types.js";

export function dispatchBeat(client: SignalMonitorClient, beat: Beat): void {
  const timestamp = new Date(beat.timestampMs);

  switch (beat.kind) {
    case "event":
      client.track(beat.name, beat.properties, { timestamp });
      return;
    case "error":
      client.captureError(new Error(beat.message), { severity: beat.severity, traceId: beat.traceId, timestamp });
      return;
    case "trace":
      client.trace({ name: beat.name, status: beat.status, durationMs: beat.durationMs, timestamp }, { traceId: beat.traceId });
      return;
    case "span":
      client.span({ traceId: beat.traceId, name: beat.name, status: beat.status, durationMs: beat.durationMs, timestamp });
      return;
    case "llmCall":
      client.llm({
        provider: beat.provider,
        model: beat.model,
        inputTokens: beat.inputTokens,
        outputTokens: beat.outputTokens,
        costUsd: beat.costUsd,
        latencyMs: beat.latencyMs,
        status: beat.status,
        timestamp
      });
      return;
    case "identifyUser":
      client.identifyUser(beat.userId, beat.traits, { tenantId: beat.tenantId, timestamp });
      return;
    case "identifyTenant":
      client.identifyTenant(beat.tenantId, beat.traits, { timestamp });
      return;
    case "breadcrumb":
      client.breadcrumb({ type: "custom", message: beat.message, timestamp });
      return;
  }
}

export type ExecutorOptions = {
  timeline: Timeline;
  projectClients: SignalMonitorClient[];
  nowMs: number;
  backfillBatchSize?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  nowImpl?: () => number;
  onProgress?: (sent: number, total: number) => void;
  onOutageStart?: (window: IncidentWindow) => Promise<void> | void;
  onOutageEnd?: (window: IncidentWindow) => Promise<void> | void;
};

export type ExecutorResult = {
  sent: number;
  failed: number;
  skippedOutageWindows: number;
};

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function runBeatLoop(options: ExecutorOptions, sleepImpl: (ms: number) => Promise<void>, nowImpl: () => number) {
  const backfillBatchSize = options.backfillBatchSize ?? 200;
  let sent = 0;
  let failed = 0;
  let sinceFlush = 0;
  const total = options.timeline.beats.length;

  const flushAll = async () => {
    const results = await Promise.all(options.projectClients.map((client) => client.flush()));
    for (const result of results) {
      sent += result.sent;
      failed += result.failed;
    }
  };

  for (const beat of options.timeline.beats) {
    const client = options.projectClients[beat.projectIndex];

    if (beat.timestampMs < options.nowMs) {
      dispatchBeat(client, beat);
      sinceFlush += 1;
      if (sinceFlush >= backfillBatchSize) {
        await flushAll();
        sinceFlush = 0;
      }
    } else {
      const waitMs = beat.timestampMs - nowImpl();
      if (waitMs > 0) {
        await sleepImpl(waitMs);
      }
      dispatchBeat(client, beat);
      await flushAll();
    }

    options.onProgress?.(sent, total);
  }

  await flushAll();

  return { sent, failed };
}

async function runOutageLoop(options: ExecutorOptions, sleepImpl: (ms: number) => Promise<void>, nowImpl: () => number) {
  let skipped = 0;

  for (const window of options.timeline.incidentWindows) {
    if (!window.monitorKind) {
      continue;
    }

    if (window.endMs <= options.nowMs) {
      skipped += 1;
      continue;
    }

    const startWaitMs = window.startMs - nowImpl();
    if (startWaitMs > 0) {
      await sleepImpl(startWaitMs);
    }
    await options.onOutageStart?.(window);

    const endWaitMs = window.endMs - nowImpl();
    if (endWaitMs > 0) {
      await sleepImpl(endWaitMs);
    }
    await options.onOutageEnd?.(window);
  }

  return { skipped };
}

export async function runExecutor(options: ExecutorOptions): Promise<ExecutorResult> {
  const sleepImpl = options.sleepImpl ?? defaultSleep;
  const nowImpl = options.nowImpl ?? Date.now;

  const [beatsResult, outageResult] = await Promise.all([
    runBeatLoop(options, sleepImpl, nowImpl),
    runOutageLoop(options, sleepImpl, nowImpl)
  ]);

  return { sent: beatsResult.sent, failed: beatsResult.failed, skippedOutageWindows: outageResult.skipped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/executor.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/loadgen/src/executor.ts packages/loadgen/src/executor.test.ts
git commit -m "feat(loadgen): executor with backfill/live dispatch and outage-window loop"
```

---

## Task 8: Heartbeat driver and fake-target HTTP server

**Files:**
- Create: `packages/loadgen/src/heartbeat-driver.ts`
- Create: `packages/loadgen/src/heartbeat-driver.test.ts`
- Create: `packages/loadgen/src/fake-target-server.ts`
- Create: `packages/loadgen/src/fake-target-server.test.ts`
- Create: `packages/loadgen/src/fake-target-bin.ts`

**Interfaces:**
- Produces: `startHeartbeatDriver(options: HeartbeatDriverOptions): { stop: () => void }`; `createFakeTargetServer(options: { controlToken: string }): FastifyInstance`.

- [ ] **Step 1: Write the failing heartbeat-driver test**

`packages/loadgen/src/heartbeat-driver.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { startHeartbeatDriver } from "./heartbeat-driver.js";

describe("startHeartbeatDriver", () => {
  it("calls the heartbeat check-in endpoint with a bearer secret when not in an outage window", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    let tick: () => void = () => {};
    const setIntervalImpl = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });

    startHeartbeatDriver({
      endpoint: "https://sigmon.example.com",
      monitorId: "mon_123",
      monitorSecret: "secret_abc",
      intervalMs: 60_000,
      isInOutageWindow: () => false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
      clearIntervalImpl: vi.fn()
    });

    tick();
    await Promise.resolve();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://sigmon.example.com/v1/heartbeats/mon_123",
      expect.objectContaining({ method: "POST", headers: { authorization: "Bearer secret_abc" } })
    );
  });

  it("skips the check-in call while inside an outage window", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    let tick: () => void = () => {};
    const setIntervalImpl = vi.fn((fn: () => void) => {
      tick = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    });

    startHeartbeatDriver({
      endpoint: "https://sigmon.example.com",
      monitorId: "mon_123",
      monitorSecret: "secret_abc",
      intervalMs: 60_000,
      isInOutageWindow: () => true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
      clearIntervalImpl: vi.fn()
    });

    tick();
    await Promise.resolve();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stop() clears the interval", () => {
    const clearIntervalImpl = vi.fn();
    const setIntervalImpl = vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>);

    const driver = startHeartbeatDriver({
      endpoint: "https://sigmon.example.com",
      monitorId: "mon_123",
      monitorSecret: "secret_abc",
      intervalMs: 60_000,
      isInOutageWindow: () => false,
      fetchImpl: vi.fn(async () => new Response(null)) as unknown as typeof fetch,
      setIntervalImpl: setIntervalImpl as unknown as typeof setInterval,
      clearIntervalImpl: clearIntervalImpl as unknown as typeof clearInterval
    });

    driver.stop();

    expect(clearIntervalImpl).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/heartbeat-driver.test.ts`
Expected: FAIL — `./heartbeat-driver.js` does not exist.

- [ ] **Step 3: Implement the heartbeat driver**

`packages/loadgen/src/heartbeat-driver.ts`:

```typescript
export type HeartbeatDriverOptions = {
  endpoint: string;
  monitorId: string;
  monitorSecret: string;
  intervalMs: number;
  isInOutageWindow: (nowMs: number) => boolean;
  fetchImpl?: typeof fetch;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
};

export function startHeartbeatDriver(options: HeartbeatDriverOptions): { stop: () => void } {
  const fetchImpl = options.fetchImpl ?? fetch;
  const setIntervalImpl = options.setIntervalImpl ?? setInterval;
  const clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;

  const tick = async (): Promise<void> => {
    if (options.isInOutageWindow(Date.now())) {
      return;
    }

    try {
      await fetchImpl(`${options.endpoint.replace(/\/+$/, "")}/v1/heartbeats/${options.monitorId}`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.monitorSecret}` }
      });
    } catch {
      // A missed heartbeat call during a transient network error is acceptable — the next tick retries,
      // and a genuinely missed window is indistinguishable from a real outage from Sigmon's point of view.
    }
  };

  const handle = setIntervalImpl(() => {
    void tick();
  }, options.intervalMs);

  return {
    stop: () => clearIntervalImpl(handle)
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/heartbeat-driver.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing fake-target-server test**

`packages/loadgen/src/fake-target-server.test.ts`:

```typescript
import { describe, expect, it, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createFakeTargetServer } from "./fake-target-server.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("createFakeTargetServer", () => {
  it("defaults a key to up (200)", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    const response = await app.inject({ method: "GET", url: "/t/checkout" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects a control request without the correct bearer token", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    const response = await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer wrong" },
      payload: { state: "down" }
    });
    expect(response.statusCode).toBe(401);
  });

  it("rejects an invalid state value", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    const response = await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "sideways" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("flips a key to down (503) and back to up (200) via the control route", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });

    const down = await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "down" }
    });
    expect(down.statusCode).toBe(200);

    const polledDown = await app.inject({ method: "GET", url: "/t/checkout" });
    expect(polledDown.statusCode).toBe(503);
    expect(polledDown.json()).toEqual({ ok: false });

    await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "up" }
    });

    const polledUp = await app.inject({ method: "GET", url: "/t/checkout" });
    expect(polledUp.statusCode).toBe(200);
  });

  it("keeps state independent per key", async () => {
    app = createFakeTargetServer({ controlToken: "secret" });
    await app.inject({
      method: "POST",
      url: "/control/checkout",
      headers: { authorization: "Bearer secret" },
      payload: { state: "down" }
    });

    const otherKey = await app.inject({ method: "GET", url: "/t/payments" });
    expect(otherKey.statusCode).toBe(200);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/fake-target-server.test.ts`
Expected: FAIL — `./fake-target-server.js` does not exist.

- [ ] **Step 7: Implement the fake-target server**

`packages/loadgen/src/fake-target-server.ts`:

```typescript
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

export type FakeTargetServerOptions = {
  controlToken: string;
};

const controlParamsSchema = z.object({ key: z.string().trim().min(1) });
const controlBodySchema = z.object({ state: z.enum(["up", "down"]) });

function parseBearerToken(header: string | undefined): string | undefined {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1]?.trim();
}

export function createFakeTargetServer(options: FakeTargetServerOptions): FastifyInstance {
  const app = Fastify();
  const state = new Map<string, "up" | "down">();

  app.get("/t/:key", async (request, reply) => {
    const params = controlParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: "invalid_key" });
    }

    const current = state.get(params.data.key) ?? "up";
    return reply.status(current === "up" ? 200 : 503).send({ ok: current === "up" });
  });

  app.post("/control/:key", async (request, reply) => {
    const token = parseBearerToken(request.headers.authorization);
    if (token !== options.controlToken) {
      return reply.status(401).send({ error: "invalid_control_token" });
    }

    const params = controlParamsSchema.safeParse(request.params);
    const body = controlBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({ error: "invalid_request" });
    }

    state.set(params.data.key, body.data.state);
    return reply.status(200).send({ key: params.data.key, state: body.data.state });
  });

  return app;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/fake-target-server.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 9: Write the fake-target bin entrypoint (no test — thin process wiring)**

`packages/loadgen/src/fake-target-bin.ts`:

```typescript
#!/usr/bin/env node
import { createFakeTargetServer } from "./fake-target-server.js";

const controlToken = process.env.LOADGEN_CONTROL_TOKEN;
if (!controlToken) {
  console.error("LOADGEN_CONTROL_TOKEN environment variable is required");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8090);
const app = createFakeTargetServer({ controlToken });

app
  .listen({ host: "0.0.0.0", port })
  .then(() => {
    console.log(`sigmon-loadgen fake target listening on :${port}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
```

- [ ] **Step 10: Commit**

```bash
git add packages/loadgen/src/heartbeat-driver.ts packages/loadgen/src/heartbeat-driver.test.ts packages/loadgen/src/fake-target-server.ts packages/loadgen/src/fake-target-server.test.ts packages/loadgen/src/fake-target-bin.ts
git commit -m "feat(loadgen): heartbeat driver and fake-target HTTP server for monitor outage simulation"
```

---

## Task 9: Config loading, duration/arg parsing, and the `sigmon-loadgen` CLI

**Files:**
- Create: `packages/loadgen/src/config.ts`
- Create: `packages/loadgen/src/config.test.ts`
- Create: `packages/loadgen/src/args.ts`
- Create: `packages/loadgen/src/args.test.ts`
- Create: `packages/loadgen/src/run.ts`

**Interfaces:**
- Consumes: `PROFILES` (Task 2), `generateTimeline` (Task 6), `runExecutor` (Task 7), `startHeartbeatDriver` (Task 8), `createSignalMonitorClient` (from `@sigmon/sdk`, public export).
- Produces: `parseConfig(raw: unknown): LoadgenConfig`; `parseDurationMs(value: string): number`; `parseRunArgs(argv: string[]): RunArgs`.

- [ ] **Step 1: Write the failing config test**

`packages/loadgen/src/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

describe("parseConfig", () => {
  it("parses a minimal valid config", () => {
    const config = parseConfig({
      endpoint: "https://my.sigmon.app",
      projects: [{ name: "demo-ecommerce", apiKey: "shsk_abc" }]
    });

    expect(config).toEqual({
      endpoint: "https://my.sigmon.app",
      projects: [{ name: "demo-ecommerce", apiKey: "shsk_abc" }],
      monitors: { heartbeat: [], http: [] }
    });
  });

  it("parses monitors when provided", () => {
    const config = parseConfig({
      endpoint: "https://my.sigmon.app",
      projects: [{ name: "demo-fintech", apiKey: "shsk_abc" }],
      monitors: {
        heartbeat: [{ projectIndex: 0, serviceName: "fraud-check", monitorId: "mon_1", secret: "sec_1" }],
        http: [{ projectIndex: 0, serviceName: "checkout", controlUrl: "https://target.example.com", controlToken: "tok_1" }]
      }
    });

    expect(config.monitors.heartbeat).toHaveLength(1);
    expect(config.monitors.http).toHaveLength(1);
  });

  it("throws a descriptive error when projects is empty", () => {
    expect(() => parseConfig({ endpoint: "https://my.sigmon.app", projects: [] })).toThrow(/projects/);
  });

  it("throws a descriptive error when endpoint is missing", () => {
    expect(() => parseConfig({ projects: [{ name: "x", apiKey: "y" }] })).toThrow(/endpoint/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/config.test.ts`
Expected: FAIL — `./config.js` does not exist.

- [ ] **Step 3: Implement `parseConfig`**

`packages/loadgen/src/config.ts`:

```typescript
import { z } from "zod";

const projectConfigSchema = z.object({
  name: z.string().trim().min(1),
  apiKey: z.string().trim().min(1)
});

const heartbeatMonitorConfigSchema = z.object({
  projectIndex: z.number().int().nonnegative(),
  serviceName: z.string().trim().min(1),
  monitorId: z.string().trim().min(1),
  secret: z.string().trim().min(1)
});

const httpMonitorConfigSchema = z.object({
  projectIndex: z.number().int().nonnegative(),
  serviceName: z.string().trim().min(1),
  controlUrl: z.string().trim().url(),
  controlToken: z.string().trim().min(1)
});

const loadgenConfigSchema = z.object({
  endpoint: z.string().trim().min(1, "endpoint is required"),
  projects: z.array(projectConfigSchema).min(1, "projects must contain at least one entry"),
  monitors: z
    .object({
      heartbeat: z.array(heartbeatMonitorConfigSchema).default([]),
      http: z.array(httpMonitorConfigSchema).default([])
    })
    .default({ heartbeat: [], http: [] })
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type HeartbeatMonitorConfig = z.infer<typeof heartbeatMonitorConfigSchema>;
export type HttpMonitorConfig = z.infer<typeof httpMonitorConfigSchema>;
export type LoadgenConfig = z.infer<typeof loadgenConfigSchema>;

export function parseConfig(raw: unknown): LoadgenConfig {
  const result = loadgenConfigSchema.safeParse(raw);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    throw new Error(`invalid loadgen config: ${message}`);
  }

  return result.data;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing args test**

`packages/loadgen/src/args.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseDurationMs, parseRunArgs } from "./args.js";

describe("parseDurationMs", () => {
  it.each([
    ["30m", 30 * 60_000],
    ["2h", 2 * 3_600_000],
    ["7d", 7 * 86_400_000]
  ])("parses %s", (input, expectedMs) => {
    expect(parseDurationMs(input)).toBe(expectedMs);
  });

  it("throws on an invalid duration string", () => {
    expect(() => parseDurationMs("banana")).toThrow(/invalid duration/);
  });
});

describe("parseRunArgs", () => {
  it("parses --config, --profile, --projects, --live", () => {
    const args = parseRunArgs(["run", "--config", ".loadgen.json", "--profile", "ecommerce", "--projects", "3", "--live", "2h"]);
    expect(args).toEqual({ config: ".loadgen.json", profile: "ecommerce", projects: 3, backfillMs: 0, liveMs: 2 * 3_600_000 });
  });

  it("parses --backfill and --live combined", () => {
    const args = parseRunArgs(["run", "--config", ".loadgen.json", "--profile", "saas-b2b", "--projects", "2", "--backfill", "3d", "--live", "1h"]);
    expect(args).toEqual({ config: ".loadgen.json", profile: "saas-b2b", projects: 2, backfillMs: 3 * 86_400_000, liveMs: 3_600_000 });
  });

  it("defaults --config to .loadgen.json when omitted", () => {
    const args = parseRunArgs(["run", "--profile", "fintech", "--projects", "1", "--backfill", "1d"]);
    expect(args.config).toBe(".loadgen.json");
  });

  it("throws when neither --backfill nor --live is given", () => {
    expect(() => parseRunArgs(["run", "--profile", "ecommerce", "--projects", "1"])).toThrow(/backfill|live/);
  });

  it("throws when --profile is missing", () => {
    expect(() => parseRunArgs(["run", "--projects", "1", "--live", "1h"])).toThrow(/profile/);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm exec vitest run packages/loadgen/src/args.test.ts`
Expected: FAIL — `./args.js` does not exist.

- [ ] **Step 7: Implement duration and arg parsing**

`packages/loadgen/src/args.ts`:

```typescript
export function parseDurationMs(value: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`invalid duration "${value}" — expected a number followed by m, h, or d (e.g. "30m", "2h", "7d")`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const unitMs = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * unitMs;
}

export type RunArgs = {
  config: string;
  profile: string;
  projects: number;
  backfillMs: number;
  liveMs: number;
};

export function parseRunArgs(argv: string[]): RunArgs {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      flags.set(token.slice(2), argv[i + 1]);
      i += 1;
    }
  }

  const profile = flags.get("profile");
  if (!profile) {
    throw new Error("--profile is required");
  }

  const projectsRaw = flags.get("projects");
  const projects = projectsRaw ? Number(projectsRaw) : 1;
  if (!Number.isInteger(projects) || projects < 1) {
    throw new Error("--projects must be a positive integer");
  }

  const backfillRaw = flags.get("backfill");
  const liveRaw = flags.get("live");
  if (!backfillRaw && !liveRaw) {
    throw new Error("at least one of --backfill or --live is required");
  }

  return {
    config: flags.get("config") ?? ".loadgen.json",
    profile,
    projects,
    backfillMs: backfillRaw ? parseDurationMs(backfillRaw) : 0,
    liveMs: liveRaw ? parseDurationMs(liveRaw) : 0
  };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm exec vitest run packages/loadgen/src/args.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 9: Write the `run.ts` bin entrypoint (no test — thin process wiring over already-tested units)**

`packages/loadgen/src/run.ts`:

```typescript
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createSignalMonitorClient } from "@sigmon/sdk";
import { parseRunArgs } from "./args.js";
import { parseConfig } from "./config.js";
import { runExecutor } from "./executor.js";
import { startHeartbeatDriver } from "./heartbeat-driver.js";
import { PROFILES } from "./profiles/index.js";
import { generateTimeline } from "./timeline.js";
import type { IncidentWindow } from "./types.js";

async function main(): Promise<void> {
  const args = parseRunArgs(process.argv.slice(2));
  const profile = PROFILES[args.profile];
  if (!profile) {
    throw new Error(`unknown profile "${args.profile}" — available: ${Object.keys(PROFILES).join(", ")}`);
  }

  const config = parseConfig(JSON.parse(readFileSync(args.config, "utf8")));
  if (config.projects.length < args.projects) {
    throw new Error(`config has ${config.projects.length} project(s) but --projects ${args.projects} was requested`);
  }

  const nowMs = Date.now();
  const timeline = generateTimeline({
    profile,
    projectCount: args.projects,
    backfillMs: args.backfillMs,
    liveMs: args.liveMs,
    nowMs,
    seed: nowMs
  });

  const projectClients = config.projects.slice(0, args.projects).map((project) =>
    createSignalMonitorClient({ endpoint: config.endpoint, apiKey: project.apiKey, flushIntervalMs: 2_000 })
  );

  const activeHeartbeatDrivers: { stop: () => void }[] = [];
  const outageState = new Map<string, boolean>();

  const windowKey = (window: IncidentWindow) => `${window.projectIndex}:${window.serviceName}:${window.incidentKey}`;

  for (const heartbeatMonitor of config.monitors.heartbeat) {
    const relevantWindows = timeline.incidentWindows.filter(
      (window) => window.monitorKind === "heartbeat" && window.projectIndex === heartbeatMonitor.projectIndex && window.serviceName === heartbeatMonitor.serviceName
    );
    const driver = startHeartbeatDriver({
      endpoint: config.endpoint,
      monitorId: heartbeatMonitor.monitorId,
      monitorSecret: heartbeatMonitor.secret,
      intervalMs: 60_000,
      isInOutageWindow: (nowMsAtTick) => relevantWindows.some((window) => nowMsAtTick >= window.startMs && nowMsAtTick < window.endMs)
    });
    activeHeartbeatDrivers.push(driver);
  }

  const onOutageStart = async (window: IncidentWindow): Promise<void> => {
    outageState.set(windowKey(window), true);
    console.log(`[loadgen] incident "${window.incidentKey}" started on ${window.serviceName} (project ${window.projectIndex})`);

    if (window.monitorKind === "http") {
      const httpMonitor = config.monitors.http.find(
        (monitor) => monitor.projectIndex === window.projectIndex && monitor.serviceName === window.serviceName
      );
      if (httpMonitor) {
        await fetch(`${httpMonitor.controlUrl.replace(/\/+$/, "")}/control/${window.serviceName}`, {
          method: "POST",
          headers: { authorization: `Bearer ${httpMonitor.controlToken}`, "content-type": "application/json" },
          body: JSON.stringify({ state: "down" })
        }).catch((error: unknown) => console.warn(`[loadgen] could not flip fake target down: ${String(error)}`));
      }
    }
  };

  const onOutageEnd = async (window: IncidentWindow): Promise<void> => {
    outageState.set(windowKey(window), false);
    console.log(`[loadgen] incident "${window.incidentKey}" ended on ${window.serviceName} (project ${window.projectIndex})`);

    if (window.monitorKind === "http") {
      const httpMonitor = config.monitors.http.find(
        (monitor) => monitor.projectIndex === window.projectIndex && monitor.serviceName === window.serviceName
      );
      if (httpMonitor) {
        await fetch(`${httpMonitor.controlUrl.replace(/\/+$/, "")}/control/${window.serviceName}`, {
          method: "POST",
          headers: { authorization: `Bearer ${httpMonitor.controlToken}`, "content-type": "application/json" },
          body: JSON.stringify({ state: "up" })
        }).catch((error: unknown) => console.warn(`[loadgen] could not flip fake target up: ${String(error)}`));
      }
    }
  };

  const result = await runExecutor({
    timeline,
    projectClients,
    nowMs,
    onOutageStart,
    onOutageEnd,
    onProgress: (sent, total) => {
      if (sent % 50 === 0 || sent === total) {
        console.log(`[loadgen] ${sent}/${total} signals sent`);
      }
    }
  });

  for (const driver of activeHeartbeatDrivers) {
    driver.stop();
  }

  console.log(`[loadgen] done — sent ${result.sent}, failed ${result.failed}, skipped ${result.skippedOutageWindows} backfilled outage window(s)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 10: Commit**

```bash
git add packages/loadgen/src/config.ts packages/loadgen/src/config.test.ts packages/loadgen/src/args.ts packages/loadgen/src/args.test.ts packages/loadgen/src/run.ts
git commit -m "feat(loadgen): config loading, arg parsing, and the sigmon-loadgen CLI entrypoint"
```

---

## Task 10: Package README and full verification gate

**Files:**
- Create: `packages/loadgen/README.md`
- Modify: `.claude/docs/STACK.md`
- Modify: `.claude/docs/PROJECT-SUMMARY.md`

**Interfaces:**
- Consumes: nothing new — documents the package built in Tasks 1-9.

- [ ] **Step 1: Write the package README**

`packages/loadgen/README.md`:

```markdown
# @sigmon/loadgen

Synthetic telemetry generator for SignalMonitor. Generates realistic events, errors, traces+spans,
LLM calls, identify calls, and breadcrumbs for 2-3 fake services per project, with scripted
incidents (error-rate spikes, monitor outages), for demoing a fresh install, stress-testing the
ingestion pipeline, and prototyping console visualizations against real multi-service data.

Design spec: `docs/superpowers/specs/2026-08-28-loadgen-synthetic-telemetry-engine-design.md`.

## Setup

You provision the projects/environments/API keys yourself (console or Admin API) — this tool never
logs in as admin. Create a `.loadgen.json`:

```json
{
  "endpoint": "https://my.sigmon.app",
  "projects": [
    { "name": "demo-ecommerce", "apiKey": "shsk_..." }
  ],
  "monitors": {
    "heartbeat": [
      { "projectIndex": 0, "serviceName": "fraud-check", "monitorId": "mon_...", "secret": "..." }
    ],
    "http": [
      { "projectIndex": 0, "serviceName": "checkout", "controlUrl": "https://your-fake-target-host", "controlToken": "..." }
    ]
  }
}
```

`monitors` is optional — omit it and incident templates that target a monitor simply skip that
side effect while still producing their error-rate/LLM-cost effect.

## Usage

```sh
# Backfill 7 days of history instantly, no live run
sigmon-loadgen run --profile fintech --projects 2 --backfill 7d

# Run live for 2 hours (soak / stress test)
sigmon-loadgen run --profile ecommerce --projects 3 --live 2h

# Backfill 3 days of history, then keep running live for 1 hour
sigmon-loadgen run --profile saas-b2b --backfill 3d --live 1h
```

Built-in profiles: `ecommerce`, `fintech`, `saas-b2b`.

## Fake HTTP-monitor target

Only needed if a profile's incident has `monitorKind: "http"` and you want that outage to actually
flip a real Sigmon HTTP monitor. Run it wherever the Sigmon worker can reach it — locally for
local/Compose testing, or as a small deployed service (see `.claude/docs/DEPLOYMENT.md`) for
outage simulation against a remote/production Sigmon instance:

```sh
LOADGEN_CONTROL_TOKEN=<token> PORT=8090 sigmon-loadgen-fake-target
```

Point the Sigmon HTTP monitor's URL at `http://<host>:8090/t/<serviceName>`. The executor flips it
between healthy (200) and down (503) via `POST /control/<serviceName>` at the start/end of the
outage window.

## Limitations

Monitor-outage simulation (both HTTP and heartbeat) only takes effect for windows that fall in the
run's live portion — Sigmon has no ingestion path for a historical monitor-check record, so a
`--backfill`-only run cannot simulate a monitor outage in the past. See the design spec for why.
```

- [ ] **Step 2: Add the package to STACK.md**

Read `.claude/docs/STACK.md` first, then add a line under the appropriate section (near other `packages/*` entries) noting `packages/loadgen` — `@sigmon/loadgen`, a synthetic telemetry generator CLI for demo data and ingestion stress-testing, not part of the deployed product.

- [ ] **Step 3: Add a capability line to PROJECT-SUMMARY.md**

Read `.claude/docs/PROJECT-SUMMARY.md` first, then add one line noting the availability of `@sigmon/loadgen` for generating demo/stress-test telemetry, matching the style of the existing MCP capability line.

- [ ] **Step 4: Run the full repo verification gate**

Run, in order, and confirm each passes before proceeding:

```sh
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config --quiet
```

If any command fails, fix the root cause in the relevant task's files before continuing — do not
weaken a test or skip a check to force a pass.

- [ ] **Step 5: Commit**

```bash
git add packages/loadgen/README.md .claude/docs/STACK.md .claude/docs/PROJECT-SUMMARY.md
git commit -m "docs(loadgen): package README, STACK.md and PROJECT-SUMMARY.md entries"
```
