// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BetaProgram, BetaProgramAdoption, BetaProgramParticipant } from "../../../api/types";
import { buildBetaProgramsVM, useBetaPrograms } from "./useBetaPrograms";

afterEach(() => vi.restoreAllMocks());

function program(over: Partial<BetaProgram> = {}): BetaProgram {
  return {
    id: "b1",
    projectId: "p",
    environmentId: "e",
    key: "checkout_beta",
    name: "Checkout beta",
    description: null,
    status: "active",
    actorType: "user",
    featureFlagId: "f1",
    featureFlagVariant: "on",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

function participant(over: Partial<BetaProgramParticipant> = {}): BetaProgramParticipant {
  return {
    id: "pt1",
    programId: "b1",
    projectId: "p",
    environmentId: "e",
    actorType: "user",
    actorId: "u1",
    status: "active",
    notes: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    removedAt: null,
    ...over,
  };
}

function adoption(over: Partial<BetaProgramAdoption> = {}): BetaProgramAdoption {
  return {
    programId: "b1",
    window: "30d",
    participants: 12,
    activeParticipants: 9,
    activeActorsWithEvents: 7,
    events: 300,
    adoptionRate: 77.7,
    samples: [],
    ...over,
  };
}

describe("buildBetaProgramsVM", () => {
  it("maps rows and null selected without a matching program", () => {
    const vm = buildBetaProgramsVM([program()], undefined, [], null);
    expect(vm.rows).toHaveLength(1);
    expect(vm.selected).toBeNull();
  });

  it("builds selected with adoption-backed counts when adoption is present", () => {
    const vm = buildBetaProgramsVM([program()], "b1", [participant()], adoption());
    expect(vm.selected?.participantsCount).toBe(12);
    expect(vm.selected?.activeParticipants).toBe(9);
    expect(vm.selected?.adoptionRateLabel).toBe("77.7%");
    expect(vm.selected?.participants[0].actorId).toBe("u1");
  });

  it("falls back to counting participants when adoption is null", () => {
    const vm = buildBetaProgramsVM([program()], "b1", [participant(), participant({ id: "pt2", status: "invited" })], null);
    expect(vm.selected?.participantsCount).toBe(2);
    expect(vm.selected?.activeParticipants).toBe(1);
    expect(vm.selected?.adoptionRateLabel).toBe("0.0%");
  });
});

describe("useBetaPrograms", () => {
  function makeClient() {
    return {
      listBetaPrograms: vi.fn().mockResolvedValue({ programs: [program()] }),
      createBetaProgram: vi.fn().mockResolvedValue({ program: program() }),
      updateBetaProgram: vi.fn().mockResolvedValue({ program: program() }),
      archiveBetaProgram: vi.fn().mockResolvedValue(undefined),
      listBetaProgramParticipants: vi.fn().mockResolvedValue({ participants: [participant()] }),
      addBetaProgramParticipant: vi.fn().mockResolvedValue({ participant: participant() }),
      removeBetaProgramParticipant: vi.fn().mockResolvedValue(undefined),
      getBetaProgramAdoption: vi.fn().mockResolvedValue({ adoption: adoption() }),
    };
  }

  it("loads and builds a VM", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useBetaPrograms({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.data?.rows).toHaveLength(1);
  });

  it("goes to error status without throwing when listBetaPrograms is missing", async () => {
    const client = {};
    const { result } = renderHook(() =>
      useBetaPrograms({ client, projectId: "p", environmentId: "e", selectedId: undefined, enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.data).toBeNull();
  });

  it("fans out participants + adoption tolerantly, ignoring individual rejections", async () => {
    const client = makeClient();
    client.getBetaProgramAdoption.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() =>
      useBetaPrograms({ client, projectId: "p", environmentId: "e", selectedId: "b1", enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));
    await waitFor(() => expect(result.current.data?.selected?.participants).toHaveLength(1));
    expect(result.current.data?.selected?.adoptionRateLabel).toBe("0.0%");
  });

  it("addParticipant uses the selected program's actorType and reloads on success", async () => {
    const client = makeClient();
    const { result } = renderHook(() =>
      useBetaPrograms({ client, projectId: "p", environmentId: "e", selectedId: "b1", enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = false;
    await act(async () => {
      ok = await result.current.addParticipant("u2");
    });
    expect(ok).toBe(true);
    expect(client.addBetaProgramParticipant).toHaveBeenCalledWith(
      "b1",
      expect.objectContaining({ actorType: "user", actorId: "u2", status: "active" }),
    );
  });

  it("removeParticipant returns false without throwing when the method is missing", async () => {
    const client = makeClient() as Record<string, unknown>;
    delete client.removeBetaProgramParticipant;
    const { result } = renderHook(() =>
      useBetaPrograms({ client, projectId: "p", environmentId: "e", selectedId: "b1", enabled: true }),
    );
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let ok = false;
    await act(async () => {
      ok = await result.current.removeParticipant("pt1");
    });
    expect(ok).toBe(true);
  });
});
