import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type ApiClient } from "../../api/client";
import type { ReadToken } from "../../api/types";
import type { ScreenCtx } from "./registry";

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type ReadTokenRowVM = {
  id: string;
  name: string;
  prefix: string;
  createdLabel: string;
  lastUsedLabel: string;
  revoked: boolean;
  statusLabel: string;
};

export type ReadTokensVM = {
  tokens: ReadTokenRowVM[];
  tokenCount: number;
};

export type BuildReadTokensInput = {
  tokens: ReadToken[];
};

export type UseReadTokensResult = {
  data: ReadTokensVM | null;
  status: "loading" | "ok" | "error" | "unavailable";
  latestSecret: string | null;
  busy: boolean;
  reload: () => void;
  clearSecret: () => void;
  createToken: (name: string) => Promise<boolean>;
  renameToken: (id: string, name: string) => Promise<boolean>;
  revokeToken: (id: string) => Promise<boolean>;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function relativeTimeFrom(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = nowMs - t;
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ---------------------------------------------------------------------------
// Pure VM builder
// ---------------------------------------------------------------------------

export function buildReadTokensVM(input: BuildReadTokensInput, nowMs: number): ReadTokensVM {
  const tokenRows: ReadTokenRowVM[] = input.tokens.map((t) => ({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    createdLabel: relativeTimeFrom(t.createdAt, nowMs),
    lastUsedLabel: relativeTimeFrom(t.lastUsedAt, nowMs),
    revoked: t.revokedAt != null,
    statusLabel: t.revokedAt != null ? "revoked" : "active",
  }));

  return {
    tokens: tokenRows,
    tokenCount: tokenRows.length,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

type UseReadTokensArgs = {
  client: ApiClient;
  ctx: ScreenCtx;
  projectId: string | undefined;
  environmentId: string | undefined;
};

export function useReadTokens({ client, ctx, projectId, environmentId }: UseReadTokensArgs): UseReadTokensResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error" | "unavailable">("loading");
  const [data, setData] = useState<ReadTokensVM | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);
  const scopeKey = `${projectId ?? ""}:${environmentId ?? ""}`;
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const clearSecret = useCallback(() => ctx.onSecretCreated(null, "readToken"), [ctx]);

  useEffect(() => {
    if (!projectId || !environmentId) return;
    const listReadTokens = client.listReadTokens;
    if (!listReadTokens) {
      setStatus("unavailable");
      setData(null);
      return;
    }

    const gen = ++genRef.current;
    const nowMs = Date.now();
    setStatus("loading");

    listReadTokens({ projectId, environmentId })
      .then((r) => r.tokens)
      .then((tokens) => {
        if (gen !== genRef.current) return;
        setData(buildReadTokensVM({ tokens }, nowMs));
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setData(null);
        // A server that hasn't wired the read-token repository answers 501
        // read_tokens_repository_unavailable at request time, same as a
        // client build that never had the method — both mean the operator
        // is looking at a deployment without this feature, not a transient
        // failure, so both land on the same "unavailable" status.
        setStatus(err instanceof ApiError && err.status === 501 ? "unavailable" : "error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, tick]);

  // Returns true on success, false on failure. The caller surfaces the
  // user-facing message via pushToast when this resolves false.
  const run = useCallback(
    async (fn: () => Promise<void>): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        reload();
        return true;
      } catch (err) {
        console.error(err);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const createToken = useCallback(
    (name: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createReadToken) return;
        const operationScope = scopeKey;
        const { token } = await client.createReadToken({ projectId, environmentId, name });
        if (scopeRef.current !== operationScope) return;
        ctx.onSecretCreated(token.secret, "readToken");
      }),
    [client, ctx, environmentId, projectId, run, scopeKey],
  );

  const renameToken = useCallback(
    (id: string, name: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.renameReadToken) return;
        await client.renameReadToken(id, { projectId, environmentId }, { name });
      }),
    [client, environmentId, projectId, run],
  );

  const revokeToken = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.revokeReadToken) return;
        await client.revokeReadToken(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  return {
    data,
    status,
    latestSecret: ctx.createdSecret?.kind === "readToken" ? ctx.createdSecret.value : null,
    busy,
    reload,
    clearSecret,
    createToken,
    renameToken,
    revokeToken,
  };
}
