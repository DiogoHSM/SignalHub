// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlag, FeatureFlagAudit, FeatureFlagEvaluation } from "../../../api/types";
import { buildFeatureFlagsVM, formatFlagRollout, useFeatureFlags } from "./useFeatureFlags";

afterEach(() => vi.restoreAllMocks());

function flag(over: Partial<FeatureFlag> = {}): FeatureFlag {
  return {
    id: "f1",
    projectId: "p",
    environmentId: "e",
    key: "new_checkout",
    name: "New checkout",
    description: null,
    status: "active",
    defaultVariant: "off",
    variants: [
      { key: "off", value: false },
      { key: "on", value: true },
    ],
    rules: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

describe("formatFlagRollout", () => {
  it("returns none when no rule has a rollout", () => {
    expect(formatFlagRollout(flag())).toBe("none");
  });

  it("formats the first rollout rule's percentage and stickiness", () => {
    const f = flag({
      rules: [{ id: "gradual_rollout", variant: "on", match: {}, rollout: { percentage: 25, stickiness: "user" } }],
    });
    expect(formatFlagRollout(f)).toBe("25% user");
  });
});

describe("buildFeatureFlagsVM", () => {
  it("maps rows with variants, rules count, and rollout label", () => {
    const vm = buildFeatureFlagsVM([flag({ rules: [{ id: "r", variant: "on", match: { userId: "u1" } }] })]);
    expect(vm.rows).toHaveLength(1);
    expect(vm.rows[0].variantsLabel).toBe("off, on");
    expect(vm.rows[0].rulesCount).toBe(1);
    expect(vm.rows[0].rolloutLabel).toBe("none");
  });
});

describe("useFeatureFlags", () => {
  function makeClient() {
    return {
      listFeatureFlags: vi.fn().mockResolvedValue({ flags: [flag()] }),
      createFeatureFlag: vi.fn().mockResolvedValue({ flag: flag() }),
      updateFeatureFlag: vi.fn().mockResolvedValue({ flag: flag() }),
      archiveFeatureFlag: vi.fn().mockResolvedValue(undefined),
      evaluateFeatureFlag: vi.fn().mockResolvedValue({
        evaluation: { key: "new_checkout", variant: "on", value: true, matched: true, reason: "rule_match", ruleId: "r1" } as FeatureFlagEvaluation,
      }),
      listFeatureFlagAudit: vi.fn().mockResolvedValue({
        audit: [{ id: "a1", featureFlagId: "f1", projectId: "p", environmentId: "e", action: "created", actorId: "u1", changes: null, createdAt: "2026-06-01T00:00:00.000Z" }] as FeatureFlagAudit[],
      }),
    };
  }

  it("loads and builds a VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useFeatureFlags({ client, projectId: "p", environmentId: "e", enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("does not fetch when disabled", () => {
    const client = makeClient();
    renderHook(() => useFeatureFlags({ client, projectId: "p", environmentId: "e", enabled: false }));
    expect(client.listFeatureFlags).not.toHaveBeenCalled();
  });

  it("goes to error status without throwing when listFeatureFlags is missing", async () => {
    const client = {};
    const { result } = renderHook(() => useFeatureFlags({ client, projectId: "p", environmentId: "e", enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("createFlag marks busy and reloads on success", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useFeatureFlags({ client, projectId: "p", environmentId: "e", enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = false;
    await act(async () => {
      ok = await result.current.createFlag({ key: "k", name: "n", enabledUserId: "", rolloutPercentage: "0" });
    });
    expect(ok).toBe(true);
    expect(client.createFeatureFlag).toHaveBeenCalled();
    expect(client.listFeatureFlags).toHaveBeenCalledTimes(2);
  });

  it("evaluateFlag returns the evaluation and tolerates a missing method", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useFeatureFlags({ client, projectId: "p", environmentId: "e", enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let evaluation: FeatureFlagEvaluation | null = null;
    await act(async () => {
      evaluation = await result.current.evaluateFlag("f1", { subject: { userId: "u1" } });
    });
    expect(evaluation).toEqual(
      expect.objectContaining({ variant: "on", value: true, matched: true, reason: "rule_match", ruleId: "r1" }),
    );

    const { evaluateFeatureFlag: _unused, ...clientWithoutEvaluate } = client;
    const { result: result2 } = renderHook(() =>
      useFeatureFlags({ client: clientWithoutEvaluate, projectId: "p", environmentId: "e", enabled: true }),
    );
    await waitFor(() => expect(result2.current.status).toBe("ok"));
    let missing: FeatureFlagEvaluation | null = { key: "x" } as unknown as FeatureFlagEvaluation;
    await act(async () => {
      missing = await result2.current.evaluateFlag("f1", {});
    });
    expect(missing).toBeNull();
  });

  it("loadAudit returns audit entries and tolerates a missing method", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useFeatureFlags({ client, projectId: "p", environmentId: "e", enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let audit: FeatureFlagAudit[] = [];
    await act(async () => {
      audit = await result.current.loadAudit("f1");
    });
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe("created");

    const { listFeatureFlagAudit: _unused, ...clientWithoutAudit } = client;
    const { result: result2 } = renderHook(() =>
      useFeatureFlags({ client: clientWithoutAudit, projectId: "p", environmentId: "e", enabled: true }),
    );
    await waitFor(() => expect(result2.current.status).toBe("ok"));
    let missingAudit: FeatureFlagAudit[] = [{} as FeatureFlagAudit];
    await act(async () => {
      missingAudit = await result2.current.loadAudit("f1");
    });
    expect(missingAudit).toEqual([]);
  });

  it("archiveFlag returns false without throwing when it rejects", async () => {
    const client = makeClient();
    client.archiveFeatureFlag.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useFeatureFlags({ client, projectId: "p", environmentId: "e", enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = true;
    await act(async () => {
      ok = await result.current.archiveFlag("f1");
    });
    expect(ok).toBe(false);
  });
});
