import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../../api/client";
import type {
  FeatureFlag,
  FeatureFlagAudit,
  FeatureFlagEvaluation,
  FeatureFlagStatus,
  FeatureFlagValue,
} from "../../../api/types";

// ---------------------------------------------------------------------------
// Pure function — ported 1:1 from ExperimentsPanel.tsx
// ---------------------------------------------------------------------------

export function formatFlagRollout(flag: FeatureFlag): string {
  const rollout = flag.rules.find((rule) => rule.rollout)?.rollout;
  return rollout ? `${rollout.percentage}% ${rollout.stickiness}` : "none";
}

// ---------------------------------------------------------------------------
// View-model types
// ---------------------------------------------------------------------------

export type FlagRowVM = {
  id: string;
  key: string;
  name: string;
  status: FeatureFlagStatus;
  defaultVariant: string;
  variantsLabel: string;
  rulesCount: number;
  rolloutLabel: string;
};

export type FlagsVM = {
  rows: FlagRowVM[];
};

export type CreateFlagForm = {
  key: string;
  name: string;
  enabledUserId: string;
  rolloutPercentage: string;
};

export type EvaluateFlagSubject = {
  userId?: string;
  tenantId?: string;
  sessionId?: string;
  traits?: Record<string, string | number | boolean | null>;
};

export type EvaluateFlagInput = {
  fallbackVariant?: string;
  subject?: EvaluateFlagSubject;
};

function toRowVM(f: FeatureFlag): FlagRowVM {
  return {
    id: f.id,
    key: f.key,
    name: f.name,
    status: f.status,
    defaultVariant: f.defaultVariant,
    variantsLabel: f.variants.map((v) => v.key).join(", "),
    rulesCount: f.rules.length,
    rolloutLabel: formatFlagRollout(f),
  };
}

export function buildFeatureFlagsVM(rows: FeatureFlag[]): FlagsVM {
  return { rows: rows.map(toRowVM) };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseFeatureFlagsResult = {
  data: FlagsVM | null;
  status: "loading" | "ok" | "error";
  busy: boolean;
  reload: () => void;
  createFlag: (form: CreateFlagForm) => Promise<boolean>;
  updateFlagStatus: (id: string, status: FeatureFlagStatus) => Promise<boolean>;
  archiveFlag: (id: string) => Promise<boolean>;
  evaluateFlag: (id: string, input: EvaluateFlagInput) => Promise<FeatureFlagEvaluation | null>;
  loadAudit: (id: string) => Promise<FeatureFlagAudit[]>;
};

type UseFeatureFlagsArgs = {
  client: Partial<
    Pick<
      ApiClient,
      "listFeatureFlags" | "createFeatureFlag" | "updateFeatureFlag" | "archiveFeatureFlag" | "evaluateFeatureFlag" | "listFeatureFlagAudit"
    >
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
  enabled: boolean;
};

export function useFeatureFlags({ client, projectId, environmentId, enabled }: UseFeatureFlagsArgs): UseFeatureFlagsResult {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [rows, setRows] = useState<FeatureFlag[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const genRef = useRef(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId || !environmentId || !enabled) return;

    if (!client.listFeatureFlags) {
      setStatus("error");
      setRows([]);
      return;
    }

    const gen = ++genRef.current;
    setStatus("loading");

    client
      .listFeatureFlags({ projectId, environmentId })
      .then(({ flags }) => {
        if (gen !== genRef.current) return;
        setRows(flags);
        setStatus("ok");
      })
      .catch((err) => {
        if (gen !== genRef.current) return;
        console.error(err);
        setRows([]);
        setStatus("error");
      });

    return () => {
      ++genRef.current;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, projectId, environmentId, enabled, tick]);

  const data = useMemo<FlagsVM | null>(() => (status === "ok" ? buildFeatureFlagsVM(rows) : null), [status, rows]);

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

  const createFlag = useCallback(
    (form: CreateFlagForm) =>
      run(async () => {
        if (!projectId || !environmentId || !client.createFeatureFlag) return;
        const rules = [];
        if (form.enabledUserId.trim()) {
          rules.push({
            id: "target_user",
            description: "Target user",
            variant: "on",
            match: { userId: form.enabledUserId.trim() },
          });
        }
        const rolloutPercentage = Math.min(100, Math.max(0, Number(form.rolloutPercentage)));
        if (Number.isFinite(rolloutPercentage) && rolloutPercentage > 0) {
          rules.push({
            id: "gradual_rollout",
            description: `${rolloutPercentage}% user rollout`,
            variant: "on",
            match: {},
            rollout: { percentage: rolloutPercentage, stickiness: "user" as const },
          });
        }
        await client.createFeatureFlag({
          projectId,
          environmentId,
          key: form.key,
          name: form.name,
          status: "active",
          defaultVariant: "off",
          variants: [
            { key: "off", value: false as FeatureFlagValue },
            { key: "on", value: true as FeatureFlagValue },
          ],
          rules,
        });
      }),
    [client, environmentId, projectId, run],
  );

  const updateFlagStatus = useCallback(
    (id: string, nextStatus: FeatureFlagStatus) =>
      run(async () => {
        if (!projectId || !environmentId || !client.updateFeatureFlag) return;
        await client.updateFeatureFlag(id, { projectId, environmentId }, { status: nextStatus });
      }),
    [client, environmentId, projectId, run],
  );

  const archiveFlag = useCallback(
    (id: string) =>
      run(async () => {
        if (!projectId || !environmentId || !client.archiveFeatureFlag) return;
        await client.archiveFeatureFlag(id, { projectId, environmentId });
      }),
    [client, environmentId, projectId, run],
  );

  const evaluateFlag = useCallback(
    async (id: string, input: EvaluateFlagInput): Promise<FeatureFlagEvaluation | null> => {
      if (!projectId || !environmentId || !client.evaluateFeatureFlag) return null;
      try {
        const { evaluation } = await client.evaluateFeatureFlag(id, { projectId, environmentId }, input);
        return evaluation;
      } catch (err) {
        console.error(err);
        return null;
      }
    },
    [client, environmentId, projectId],
  );

  const loadAudit = useCallback(
    async (id: string): Promise<FeatureFlagAudit[]> => {
      if (!projectId || !environmentId || !client.listFeatureFlagAudit) return [];
      try {
        const { audit } = await client.listFeatureFlagAudit(id, { projectId, environmentId });
        return audit;
      } catch (err) {
        console.error(err);
        return [];
      }
    },
    [client, environmentId, projectId],
  );

  return { data, status, busy, reload, createFlag, updateFlagStatus, archiveFlag, evaluateFlag, loadAudit };
}
