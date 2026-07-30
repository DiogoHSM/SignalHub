// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import { useSystemUsers } from "./useSystem";

const USERS = [
  { id: "usr_1", email: "admin@example.com", isAdmin: true },
  { id: "usr_2", email: "second-admin@example.com", isAdmin: true },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listUsers: vi.fn().mockResolvedValue({ users: USERS }),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    archiveUser: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe("useSystemUsers", () => {
  it("loads installation console users only when enabled", async () => {
    const client = makeClient();
    const { result } = renderHook(() => useSystemUsers({ client, enabled: true }));

    await waitFor(() => expect(result.current.status).toBe("ok"));
    expect(result.current.users).toEqual(USERS);
    expect(client.listUsers).toHaveBeenCalledTimes(1);
  });

  it("does not request installation users for non-admin operators", () => {
    const client = makeClient();
    const { result } = renderHook(() => useSystemUsers({ client, enabled: false }));

    expect(result.current.status).toBe("idle");
    expect(result.current.users).toEqual([]);
    expect(client.listUsers).not.toHaveBeenCalled();
  });

  it("creates, updates, and archives users in local state", async () => {
    const created = { id: "usr_3", email: "new@example.com", isAdmin: true };
    const updated = { ...USERS[1], email: "lead@example.com", isAdmin: true };
    const client = makeClient({
      createUser: vi.fn().mockResolvedValue({ user: created }),
      updateUser: vi.fn().mockResolvedValue({ user: updated }),
      archiveUser: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useSystemUsers({ client, enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    await act(() => result.current.create({ email: "new@example.com", password: "temporary-password", isAdmin: true }));
    expect(result.current.users).toContainEqual(created);

    await act(() => result.current.update("usr_2", { email: "lead@example.com", isAdmin: true }));
    expect(result.current.users).toContainEqual(updated);

    await act(() => result.current.archive("usr_3"));
    expect(result.current.users).not.toContainEqual(created);
  });

  it("exposes load and mutation failures without discarding existing users", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const loadClient = makeClient({ listUsers: vi.fn().mockRejectedValue(new Error("offline")) });
    const load = renderHook(() => useSystemUsers({ client: loadClient, enabled: true }));
    await waitFor(() => expect(load.result.current.status).toBe("error"));
    expect(load.result.current.error).toBe("Could not load console users.");

    const client = makeClient({ createUser: vi.fn().mockRejectedValue(new Error("duplicate")) });
    const mutation = renderHook(() => useSystemUsers({ client, enabled: true }));
    await waitFor(() => expect(mutation.result.current.status).toBe("ok"));
    await expect(
      act(() => mutation.result.current.create({ email: "bad@example.com", password: "temporary-password", isAdmin: true }))
    ).rejects.toThrow("duplicate");
    expect(mutation.result.current.users).toEqual(USERS);
  });

  it("ignores stale list responses after a newer reload completes", async () => {
    const first = deferred<{ users: typeof USERS }>();
    const secondUsers = [{ id: "usr_3", email: "fresh@example.com", isAdmin: true }];
    const client = makeClient({
      listUsers: vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ users: secondUsers }),
    });
    const { result } = renderHook(() => useSystemUsers({ client, enabled: true }));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.users).toEqual(secondUsers));

    first.resolve({ users: USERS });
    await act(async () => { await first.promise; });
    expect(result.current.users).toEqual(secondUsers);
  });

  it("locks mutations synchronously before React state is committed", async () => {
    const pending = deferred<{ user: (typeof USERS)[number] }>();
    const createUser = vi.fn().mockReturnValue(pending.promise);
    const client = makeClient({ createUser });
    const { result } = renderHook(() => useSystemUsers({ client, enabled: true }));
    await waitFor(() => expect(result.current.status).toBe("ok"));

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.create({ email: "first@example.com", password: "temporary-password", isAdmin: true });
      second = result.current.create({ email: "second@example.com", password: "temporary-password", isAdmin: true });
    });

    await expect(second).rejects.toThrow("user_mutation_in_progress");
    expect(createUser).toHaveBeenCalledTimes(1);
    pending.resolve({ user: USERS[0] });
    await act(async () => { await first; });
  });
});
