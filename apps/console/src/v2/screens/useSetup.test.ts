// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildSetupVM, type BuildSetupInput } from "./useSetup";
import type { ApiKey, Environment, OperationsResponse, Project } from "../../api/types";

const NOW = Date.UTC(2026, 5, 24, 12, 0, 0);

function project(over: Partial<Project> = {}): Project {
  return { id: "prj_1", name: "Acme", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null, ...over };
}
function env(over: Partial<Environment> = {}): Environment {
  return { id: "env_1", projectId: "prj_1", name: "production", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", archivedAt: null, ...over };
}
function key(over: Partial<ApiKey> = {}): ApiKey {
  return { id: "key_1", projectId: "prj_1", environmentId: "env_1", name: "k", prefix: "sh_live_ab", createdAt: "2026-01-01T00:00:00.000Z", revokedAt: null, ...over };
}
function ops(lastEventAt: string | null, events = 184): OperationsResponse {
  return {
    window: "24h",
    generatedAt: "2026-06-24T12:00:00.000Z",
    scope: { projectId: "prj_1", environmentId: "env_1" },
    range: { from: "x", to: "y" },
    status: "ok" as OperationsResponse["status"],
    summary: {
      monitors: { total: 0, http: z(), heartbeat: z() },
      alerts: { rules: { total: 0, enabled: 0 }, events: { total: 0, critical: 0, warning: 0, deliveryFailed: 0, deliveryPending: 0 } },
      telemetry: { events, errors: 0, traces: 0, failedTraces: 0, errorRatePercent: null, p95TraceDurationMs: null, lastEventAt, lastErrorAt: null, lastTraceAt: null },
      incidents: { open: 0, investigating: 0, urgent: 0, high: 0, regressed: 0 },
    },
    recent: { monitors: [], alerts: [], incidents: [] },
    topLatency: [],
    anomalies: [],
    setupGaps: [],
  };
}
function z() { return { total: 0, up: 0, degraded: 0, down: 0, paused: 0, unknown: 0 }; }

function input(over: Partial<BuildSetupInput> = {}): BuildSetupInput {
  return {
    projects: [project()],
    activeProjectId: "prj_1",
    activeProjectName: "Acme",
    environments: [env()],
    activeEnvId: "env_1",
    activeEnvName: "production",
    apiKeys: [key()],
    ops: ops("2026-06-24T11:59:56.000Z"),
    endpoint: "https://sigmon.acme.dev",
    nowMs: NOW,
    ...over,
  };
}

describe("buildSetupVM", () => {
  it("marks all five steps done when project, env, key and a signal exist", () => {
    const vm = buildSetupVM(input());
    expect(vm.steps.map((s) => s.done)).toEqual([true, true, true, true, true]);
  });

  it("leaves key + signal steps pending when no key and no signal", () => {
    const vm = buildSetupVM(input({ apiKeys: [], ops: ops(null) }));
    expect(vm.steps.map((s) => s.done)).toEqual([true, true, false, false, false]);
  });

  it("ignores revoked keys for the active environment", () => {
    const vm = buildSetupVM(input({ apiKeys: [key({ revokedAt: "2026-02-01T00:00:00.000Z" })] }));
    expect(vm.steps[2].done).toBe(false);
  });

  it("ignores keys scoped to a different environment", () => {
    const vm = buildSetupVM(input({ apiKeys: [key({ environmentId: "env_other" })] }));
    expect(vm.steps[2].done).toBe(false);
  });

  it("flags the active project", () => {
    const vm = buildSetupVM(input({ projects: [project(), project({ id: "prj_2", name: "Other" })] }));
    expect(vm.projects.find((p) => p.isActive)?.id).toBe("prj_1");
    expect(vm.projects.find((p) => p.id === "prj_2")?.isActive).toBe(false);
  });

  it("derives a receiving status + detail for the active env with a signal", () => {
    const vm = buildSetupVM(input());
    const active = vm.environments.find((e) => e.isActive);
    expect(active?.status).toBe("ok");
    expect(active?.detail).toBe("1 API key · receiving");
  });

  it("derives an idle active env when no signal", () => {
    const vm = buildSetupVM(input({ ops: ops(null), apiKeys: [key(), key({ id: "key_2" })] }));
    const active = vm.environments.find((e) => e.isActive);
    expect(active?.status).toBe("idle");
    expect(active?.detail).toBe("2 API keys · no signal yet");
  });

  it("labels non-active environments as active/idle", () => {
    const vm = buildSetupVM(input({ environments: [env(), env({ id: "env_2", name: "staging" })] }));
    const other = vm.environments.find((e) => e.id === "env_2");
    expect(other?.isActive).toBe(false);
    expect(other?.status).toBe("idle");
    expect(other?.detail).toBe("active");
  });

  it("builds a connected banner with relative time and window", () => {
    const vm = buildSetupVM(input());
    expect(vm.banner.connected).toBe(true);
    expect(vm.banner.title).toBe("SDK connected");
    expect(vm.banner.detail).toBe("Last signal 4s ago · 184 events / 24h");
  });

  it("builds a waiting banner when ops is null", () => {
    const vm = buildSetupVM(input({ ops: null }));
    expect(vm.banner.connected).toBe(false);
    expect(vm.banner.title).toBe("Waiting for first signal");
  });

  it("exposes the scope label and endpoint", () => {
    const vm = buildSetupVM(input());
    expect(vm.keyScopeLabel).toBe("Acme / production");
    expect(vm.endpoint).toBe("https://sigmon.acme.dev");
  });
});
