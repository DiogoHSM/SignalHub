// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client";
import { useIncidentCount } from "./useIncidentCount";

describe("scoped incident count", () => {
  it("counts open and investigating incidents in the selected environment", async () => {
    const getOperations = vi.fn().mockResolvedValue({ data: { summary: { incidents: { open: 2, investigating: 1 } } } });
    const client = { getOperations } as unknown as ApiClient;
    const { result } = renderHook(() => useIncidentCount(client, "p1", "e1", 0));
    await waitFor(() => expect(result.current).toBe(3));
    expect(getOperations).toHaveBeenCalledWith({ projectId: "p1", environmentId: "e1", window: "24h" });
  });
  it("does not display stale scope counts when the new scope fails", async () => {
    const getOperations = vi.fn().mockResolvedValueOnce({ data: { summary: { incidents: { open: 3, investigating: 0 } } } }).mockRejectedValue(new Error("offline"));
    const client = { getOperations } as unknown as ApiClient;
    const { result, rerender } = renderHook(({ environmentId }) => useIncidentCount(client, "p1", environmentId, 0), { initialProps: { environmentId: "e1" } });
    await waitFor(() => expect(result.current).toBe(3));
    await act(async () => rerender({ environmentId: "e2" }));
    expect(result.current).toBeNull();
  });
});
