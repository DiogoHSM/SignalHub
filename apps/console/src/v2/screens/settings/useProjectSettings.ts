import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../../api/client";
import type {
  ApiKey,
  BrowserOrigin,
  CodeIntegration,
  CreateWarehouseDestinationInput,
  DataGovernancePolicy,
  WarehouseDestination,
  WarehouseExportRun,
  UpdateWarehouseDestinationInput,
  UpsertReleaseMetadataInput,
} from "../../../api/types";
import type { ScreenCtx } from "../registry";

type SettingsState = {
  apiKeys: ApiKey[];
  origins: BrowserOrigin[];
  integrations: CodeIntegration[];
  policy: DataGovernancePolicy | null;
  destinations: WarehouseDestination[];
};

type SettingsErrors = {
  apiKeys: string | null;
  browserOrigins: string | null;
  governance: string | null;
  warehouse: string | null;
  warehouseRuns: string | null;
  releases: string | null;
};

type SettingsCapabilities = {
  renameApiKeys: boolean;
  browserOrigins: boolean;
  governance: boolean;
  warehouse: boolean;
  releases: boolean;
};

type Scoped<T> = { scopeKey: string; value: T };
type LoadResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "error"; cause: unknown }
  | { kind: "unavailable" }
  | { kind: "skipped" };

const EMPTY_STATE: SettingsState = { apiKeys: [], origins: [], integrations: [], policy: null, destinations: [] };
const EMPTY_ERRORS: SettingsErrors = {
  apiKeys: null,
  browserOrigins: null,
  governance: null,
  warehouse: null,
  warehouseRuns: null,
  releases: null,
};

function isUnavailable(cause: unknown) {
  return cause instanceof ApiError && cause.status === 501;
}

async function loadOptional<T>(available: boolean, request: () => Promise<T>): Promise<LoadResult<T>> {
  if (!available) return { kind: "skipped" };
  try {
    return { kind: "ok", value: await request() };
  } catch (cause) {
    return isUnavailable(cause) ? { kind: "unavailable" } : { kind: "error", cause };
  }
}

export function useProjectSettings(ctx: ScreenCtx) {
  const { client, project, environment } = ctx;
  const projectId = project?.id;
  const environmentId = environment?.id;
  const scopeKey = projectId && environmentId ? `${projectId}:${environmentId}` : "";
  const methodCapabilities = useMemo<SettingsCapabilities>(() => ({
    renameApiKeys: Boolean(client.updateApiKey),
    browserOrigins: Boolean(client.listBrowserOrigins && client.createBrowserOrigin && client.archiveBrowserOrigin),
    governance: Boolean(client.getDataGovernancePolicy && client.updateDataGovernancePolicy),
    warehouse: Boolean(
      client.listWarehouseDestinations &&
        client.createWarehouseDestination &&
        client.updateWarehouseDestination &&
        client.archiveWarehouseDestination &&
        client.listWarehouseExportRuns &&
        client.runWarehouseExport,
    ),
    releases: Boolean(client.upsertReleaseMetadata),
  }), [
    client.archiveBrowserOrigin,
    client.archiveWarehouseDestination,
    client.createBrowserOrigin,
    client.createWarehouseDestination,
    client.getDataGovernancePolicy,
    client.listBrowserOrigins,
    client.listWarehouseDestinations,
    client.listWarehouseExportRuns,
    client.runWarehouseExport,
    client.updateApiKey,
    client.updateDataGovernancePolicy,
    client.updateWarehouseDestination,
    client.upsertReleaseMetadata,
  ]);

  const [dataState, setDataState] = useState<Scoped<SettingsState>>({ scopeKey: "", value: EMPTY_STATE });
  const [errorsState, setErrorsState] = useState<Scoped<SettingsErrors>>({ scopeKey: "", value: EMPTY_ERRORS });
  const [capabilitiesState, setCapabilitiesState] = useState<Scoped<SettingsCapabilities>>({
    scopeKey: "",
    value: methodCapabilities,
  });
  const [loadingState, setLoadingState] = useState<Scoped<boolean>>({ scopeKey: "", value: true });
  const [busyState, setBusyState] = useState<Scoped<boolean>>({ scopeKey: "", value: false });
  const [selectedState, setSelectedState] = useState<Scoped<string | null>>({ scopeKey: "", value: null });
  const [runsState, setRunsState] = useState<{ scopeKey: string; destinationId: string | null; value: WarehouseExportRun[] }>({
    scopeKey: "",
    destinationId: null,
    value: [],
  });

  const scopeRef = useRef(scopeKey);
  const generation = useRef(0);
  const runsGeneration = useRef(0);
  const mutationLock = useRef<symbol | null>(null);
  const selectedRef = useRef({ scopeKey, destinationId: null as string | null });

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey;
    generation.current += 1;
    runsGeneration.current += 1;
    mutationLock.current = null;
    selectedRef.current = { scopeKey, destinationId: null };
  }

  const updateErrors = useCallback(
    (update: (current: SettingsErrors) => SettingsErrors) => {
      setErrorsState((current) => ({
        scopeKey,
        value: update(current.scopeKey === scopeKey ? current.value : EMPTY_ERRORS),
      }));
    },
    [scopeKey],
  );

  const updateData = useCallback(
    (update: (current: SettingsState) => SettingsState) => {
      setDataState((current) => ({
        scopeKey,
        value: update(current.scopeKey === scopeKey ? current.value : EMPTY_STATE),
      }));
    },
    [scopeKey],
  );

  const updateCapability = useCallback(
    (key: keyof SettingsCapabilities, value: boolean) => {
      setCapabilitiesState((current) => ({
        scopeKey,
        value: { ...(current.scopeKey === scopeKey ? current.value : methodCapabilities), [key]: value },
      }));
    },
    [methodCapabilities, scopeKey],
  );

  const load = useCallback(async () => {
    const currentGeneration = ++generation.current;
    if (!projectId || !environmentId) {
      setDataState({ scopeKey, value: EMPTY_STATE });
      setLoadingState({ scopeKey, value: false });
      return;
    }

    setLoadingState({ scopeKey, value: true });
    setErrorsState({ scopeKey, value: EMPTY_ERRORS });
    setCapabilitiesState({ scopeKey, value: methodCapabilities });

    const [keys, origins, integrations, governance, warehouses] = await Promise.all([
      loadOptional(true, () => client.listApiKeys(projectId)),
      loadOptional(methodCapabilities.browserOrigins, () => client.listBrowserOrigins!(projectId)),
      loadOptional(Boolean(client.listCodeIntegrations), () => client.listCodeIntegrations!(projectId)),
      loadOptional(methodCapabilities.governance, () => client.getDataGovernancePolicy!({ projectId, environmentId })),
      loadOptional(methodCapabilities.warehouse, () => client.listWarehouseDestinations!({ projectId, environmentId })),
    ]);

    if (currentGeneration !== generation.current || scopeRef.current !== scopeKey) return;
    const nextErrors = { ...EMPTY_ERRORS };
    if (keys.kind === "error") nextErrors.apiKeys = "Could not load API keys.";
    if (origins.kind === "error") nextErrors.browserOrigins = "Could not load browser origins.";
    if (integrations.kind === "error") nextErrors.releases = "Could not load code integrations.";
    if (governance.kind === "error") nextErrors.governance = "Could not load data governance.";
    if (warehouses.kind === "error") nextErrors.warehouse = "Could not load warehouse destinations.";

    for (const result of [keys, origins, integrations, governance, warehouses]) {
      if (result.kind === "error") console.error(result.cause);
    }

    const destinations = warehouses.kind === "ok" ? warehouses.value.destinations : [];
    setDataState({
      scopeKey,
      value: {
        apiKeys: keys.kind === "ok" ? keys.value.apiKeys : [],
        origins: origins.kind === "ok" ? origins.value.origins.filter((origin) => origin.archivedAt == null) : [],
        integrations: integrations.kind === "ok"
          ? integrations.value.integrations.filter((integration) => integration.revokedAt == null)
          : [],
        policy: governance.kind === "ok" ? governance.value.policy : null,
        destinations,
      },
    });
    setErrorsState((current) => ({
      scopeKey,
      value: {
        ...nextErrors,
        warehouseRuns: current.scopeKey === scopeKey ? current.value.warehouseRuns : null,
      },
    }));
    setCapabilitiesState({
      scopeKey,
      value: {
        ...methodCapabilities,
        browserOrigins: methodCapabilities.browserOrigins && origins.kind !== "unavailable",
        governance: methodCapabilities.governance && governance.kind !== "unavailable",
        warehouse: methodCapabilities.warehouse && warehouses.kind !== "unavailable",
      },
    });

    const previousSelection = selectedRef.current.scopeKey === scopeKey ? selectedRef.current.destinationId : null;
    const destinationId = destinations.some((item) => item.id === previousSelection)
      ? previousSelection
      : destinations[0]?.id ?? null;
    selectedRef.current = { scopeKey, destinationId };
    setSelectedState({ scopeKey, value: destinationId });
    setRunsState({ scopeKey, destinationId, value: [] });
    setLoadingState({ scopeKey, value: false });
  }, [client, environmentId, methodCapabilities, projectId, scopeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const setSelectedDestinationId = useCallback(
    (destinationId: string | null) => {
      runsGeneration.current += 1;
      selectedRef.current = { scopeKey, destinationId };
      setSelectedState({ scopeKey, value: destinationId });
      setRunsState({ scopeKey, destinationId, value: [] });
      updateErrors((current) => ({ ...current, warehouseRuns: null }));
    },
    [scopeKey, updateErrors],
  );

  const loadRuns = useCallback(
    async (destinationId: string | null) => {
      const currentGeneration = ++runsGeneration.current;
      if (!destinationId || !projectId || !environmentId || !client.listWarehouseExportRuns) {
        setRunsState({ scopeKey, destinationId, value: [] });
        return false;
      }
      updateErrors((current) => ({ ...current, warehouseRuns: null }));
      try {
        const response = await client.listWarehouseExportRuns(destinationId, { projectId, environmentId, limit: 8 });
        if (
          currentGeneration !== runsGeneration.current ||
          scopeRef.current !== scopeKey ||
          selectedRef.current.scopeKey !== scopeKey ||
          selectedRef.current.destinationId !== destinationId
        ) return false;
        setRunsState({ scopeKey, destinationId, value: response.runs });
        return true;
      } catch (cause) {
        if (
          currentGeneration !== runsGeneration.current ||
          scopeRef.current !== scopeKey ||
          selectedRef.current.destinationId !== destinationId
        ) return false;
        setRunsState({ scopeKey, destinationId, value: [] });
        if (isUnavailable(cause)) {
          updateCapability("warehouse", false);
        } else {
          console.error(cause);
          updateErrors((current) => ({ ...current, warehouseRuns: "Could not load warehouse export history." }));
        }
        return false;
      }
    },
    [client, environmentId, projectId, scopeKey, updateCapability, updateErrors],
  );

  const selectedDestinationId = selectedState.scopeKey === scopeKey ? selectedState.value : null;
  useEffect(() => {
    void loadRuns(selectedDestinationId);
  }, [loadRuns, selectedDestinationId]);

  const perform = useCallback(
    async <T,>(
      operation: () => Promise<T>,
      onSuccess: (value: T) => void,
      message: string,
      panel: keyof SettingsErrors,
      capability?: keyof SettingsCapabilities,
    ) => {
      if (mutationLock.current) return false;
      const token = Symbol("settings-mutation");
      const currentGeneration = generation.current;
      mutationLock.current = token;
      setBusyState({ scopeKey, value: true });
      updateErrors((current) => ({ ...current, [panel]: null }));
      try {
        const value = await operation();
        if (currentGeneration !== generation.current || scopeRef.current !== scopeKey) return false;
        onSuccess(value);
        return true;
      } catch (cause) {
        if (currentGeneration !== generation.current || scopeRef.current !== scopeKey) return false;
        if (isUnavailable(cause) && capability) updateCapability(capability, false);
        else {
          console.error(cause);
          updateErrors((current) => ({ ...current, [panel]: message }));
        }
        return false;
      } finally {
        if (mutationLock.current === token) {
          mutationLock.current = null;
          if (scopeRef.current === scopeKey) setBusyState({ scopeKey, value: false });
        }
      }
    },
    [scopeKey, updateCapability, updateErrors],
  );

  const renameApiKey = useCallback(async (id: string, name: string) => {
    if (!client.updateApiKey) return false;
    return perform(
      () => client.updateApiKey!(id, { name }),
      (response) => {
        updateData((current) => ({ ...current, apiKeys: current.apiKeys.map((key) => key.id === id ? response.apiKey : key) }));
        ctx.pushToast("API key renamed");
      },
      "Could not rename API key.", "apiKeys", "renameApiKeys",
    );
  }, [client, ctx, perform, updateData]);

  const revokeApiKey = useCallback(async (key: ApiKey) => {
    if (mutationLock.current || !window.confirm(`Revoke API key ${key.name}? Existing clients using it will stop ingesting.`)) return false;
    return perform(
      () => client.revokeApiKey(key.id),
      () => {
        updateData((current) => ({ ...current, apiKeys: current.apiKeys.filter((item) => item.id !== key.id) }));
        ctx.pushToast("API key revoked");
      },
      "Could not revoke API key.", "apiKeys",
    );
  }, [client, ctx, perform, updateData]);

  const createOrigin = useCallback(async (origin: string) => {
    if (!projectId || !client.createBrowserOrigin) return false;
    return perform(
      () => client.createBrowserOrigin!(projectId, { origin }),
      (response) => {
        updateData((current) => ({ ...current, origins: [...current.origins.filter((item) => item.id !== response.origin.id), response.origin] }));
        ctx.pushToast("Browser origin allowed");
      },
      "Could not add browser origin.", "browserOrigins", "browserOrigins",
    );
  }, [client, ctx, perform, projectId, updateData]);

  const archiveOrigin = useCallback(async (origin: BrowserOrigin) => {
    if (mutationLock.current || !window.confirm(`Archive browser origin ${origin.origin}? Browser ingestion from it will be blocked.`)) return false;
    if (!client.archiveBrowserOrigin) return false;
    return perform(
      () => client.archiveBrowserOrigin!(origin.id),
      () => {
        updateData((current) => ({ ...current, origins: current.origins.filter((item) => item.id !== origin.id) }));
        ctx.pushToast("Browser origin archived");
      },
      "Could not archive browser origin.", "browserOrigins", "browserOrigins",
    );
  }, [client, ctx, perform, updateData]);

  const saveGovernance = useCallback(async (input: Pick<DataGovernancePolicy, "retentionPolicy" | "propertyRules">) => {
    if (!projectId || !environmentId || !client.updateDataGovernancePolicy) return false;
    return perform(
      () => client.updateDataGovernancePolicy!({ projectId, environmentId, ...input }),
      (response) => {
        updateData((current) => ({ ...current, policy: response.policy }));
        ctx.pushToast("Data governance policy saved");
      },
      "Could not save data governance policy.", "governance", "governance",
    );
  }, [client, ctx, environmentId, perform, projectId, updateData]);

  const saveReleaseMetadata = useCallback(async (
    input: Omit<UpsertReleaseMetadataInput, "environmentId">
  ) => {
    if (!projectId || !environmentId || !client.upsertReleaseMetadata) return false;
    return perform(
      () => client.upsertReleaseMetadata!(projectId, { environmentId, ...input }),
      () => ctx.pushToast("Release metadata saved"),
      "Could not save release metadata.", "releases", "releases",
    );
  }, [client, ctx, environmentId, perform, projectId]);

  const createDestination = useCallback(async (input: Omit<CreateWarehouseDestinationInput, "projectId" | "environmentId">) => {
    if (!projectId || !environmentId || !client.createWarehouseDestination) return false;
    return perform(
      () => client.createWarehouseDestination!({ projectId, environmentId, ...input }),
      (response) => {
        updateData((current) => ({ ...current, destinations: [...current.destinations, response.destination] }));
        setSelectedDestinationId(response.destination.id);
        ctx.pushToast("Warehouse destination created");
      },
      "Could not create warehouse destination.", "warehouse", "warehouse",
    );
  }, [client, ctx, environmentId, perform, projectId, setSelectedDestinationId, updateData]);

  const updateDestination = useCallback(async (id: string, input: Omit<UpdateWarehouseDestinationInput, "projectId" | "environmentId">) => {
    if (!projectId || !environmentId || !client.updateWarehouseDestination) return false;
    return perform(
      () => client.updateWarehouseDestination!(id, { projectId, environmentId, ...input }),
      (response) => {
        updateData((current) => ({ ...current, destinations: current.destinations.map((item) => item.id === id ? response.destination : item) }));
        ctx.pushToast("Warehouse destination updated");
      },
      "Could not update warehouse destination.", "warehouse", "warehouse",
    );
  }, [client, ctx, environmentId, perform, projectId, updateData]);

  const archiveDestination = useCallback(async (destination: WarehouseDestination) => {
    if (mutationLock.current || !window.confirm(`Archive warehouse destination ${destination.name}? Scheduled exports will stop.`)) return false;
    if (!projectId || !environmentId || !client.archiveWarehouseDestination) return false;
    return perform(
      () => client.archiveWarehouseDestination!(destination.id, { projectId, environmentId }),
      () => {
        updateData((current) => ({ ...current, destinations: current.destinations.filter((item) => item.id !== destination.id) }));
        if (selectedRef.current.destinationId === destination.id) setSelectedDestinationId(null);
        ctx.pushToast("Warehouse destination archived");
      },
      "Could not archive warehouse destination.", "warehouse", "warehouse",
    );
  }, [client, ctx, environmentId, perform, projectId, setSelectedDestinationId, updateData]);

  const runDestination = useCallback(async (destination: WarehouseDestination) => {
    if (!projectId || !environmentId || !client.runWarehouseExport) return false;
    return perform(
      () => client.runWarehouseExport!(destination.id, { projectId, environmentId }),
      (response) => {
        void loadRuns(destination.id);
        ctx.pushToast(response.result.skipped
          ? "Warehouse export skipped because another run is active"
          : `Warehouse export completed: ${response.result.exported} exported, ${response.result.failed} failed`);
      },
      "Could not run warehouse export.", "warehouse", "warehouse",
    );
  }, [client, ctx, environmentId, loadRuns, perform, projectId]);

  const data = dataState.scopeKey === scopeKey ? dataState.value : EMPTY_STATE;
  const errors = errorsState.scopeKey === scopeKey ? errorsState.value : EMPTY_ERRORS;
  const capabilities = capabilitiesState.scopeKey === scopeKey ? capabilitiesState.value : methodCapabilities;
  const runs = runsState.scopeKey === scopeKey && runsState.destinationId === selectedDestinationId ? runsState.value : [];

  return {
    ...data,
    runs,
    scopeKey,
    loading: loadingState.scopeKey === scopeKey ? loadingState.value : true,
    busy: busyState.scopeKey === scopeKey ? busyState.value : false,
    error: errors.apiKeys,
    errors,
    selectedDestinationId,
    setSelectedDestinationId,
    renameApiKey,
    revokeApiKey,
    createOrigin,
    archiveOrigin,
    saveGovernance,
    saveReleaseMetadata,
    createDestination,
    updateDestination,
    archiveDestination,
    runDestination,
    capabilities,
  };
}
