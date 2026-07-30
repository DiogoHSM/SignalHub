import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type { User } from "../../api/types";

type UserStatus = "idle" | "loading" | "ok" | "error";
type CreateUserInput = Parameters<ApiClient["createUser"]>[0];
type UpdateUserInput = Parameters<ApiClient["updateUser"]>[1];

export type UseSystemUsersResult = {
  users: User[];
  status: UserStatus;
  error: string | null;
  pendingUserId: string | null;
  reload: () => void;
  create: (input: CreateUserInput) => Promise<User>;
  update: (id: string, input: UpdateUserInput) => Promise<User>;
  archive: (id: string) => Promise<void>;
};

export function useSystemUsers({ client, enabled }: { client: ApiClient; enabled: boolean }): UseSystemUsersResult {
  const [users, setUsers] = useState<User[]>([]);
  const [status, setStatus] = useState<UserStatus>(enabled ? "loading" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const requestGeneration = useRef(0);
  const mutationLocked = useRef(false);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (!enabled) {
      setUsers([]);
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);
    void client.listUsers().then(
      ({ users: nextUsers }) => {
        if (cancelled || generation !== requestGeneration.current) return;
        setUsers(nextUsers);
        setStatus("ok");
      },
      (loadError) => {
        console.error(loadError);
        if (cancelled || generation !== requestGeneration.current) return;
        setStatus("error");
        setError("Could not load console users.");
      }
    );

    return () => {
      cancelled = true;
    };
  }, [client, enabled, reloadKey]);

  const create = useCallback(async (input: CreateUserInput) => {
    if (mutationLocked.current) throw new Error("user_mutation_in_progress");
    mutationLocked.current = true;
    setPendingUserId("new");
    setError(null);
    try {
      const { user } = await client.createUser(input);
      setUsers((current) => [...current, user].sort((a, b) => a.email.localeCompare(b.email)));
      return user;
    } finally {
      mutationLocked.current = false;
      setPendingUserId(null);
    }
  }, [client]);

  const update = useCallback(async (id: string, input: UpdateUserInput) => {
    if (mutationLocked.current) throw new Error("user_mutation_in_progress");
    mutationLocked.current = true;
    setPendingUserId(id);
    setError(null);
    try {
      const { user } = await client.updateUser(id, input);
      setUsers((current) => current.map((item) => item.id === user.id ? user : item));
      return user;
    } finally {
      mutationLocked.current = false;
      setPendingUserId(null);
    }
  }, [client]);

  const archive = useCallback(async (id: string) => {
    if (mutationLocked.current) throw new Error("user_mutation_in_progress");
    mutationLocked.current = true;
    setPendingUserId(id);
    setError(null);
    try {
      await client.archiveUser(id);
      setUsers((current) => current.filter((item) => item.id !== id));
    } finally {
      mutationLocked.current = false;
      setPendingUserId(null);
    }
  }, [client]);

  return {
    users,
    status,
    error,
    pendingUserId,
    reload: () => setReloadKey((key) => key + 1),
    create,
    update,
    archive,
  };
}
