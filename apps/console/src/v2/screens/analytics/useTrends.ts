import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../api/client";
import type {
  AnalyticsInsight,
  AnalyticsInsightDefinition,
  AnalyticsTrendFilter,
  AnalyticsTrendResult,
  PromotedEventProperty,
} from "../../../api/types";

export type TrendWindow = "24h" | "7d" | "30d";
export type TrendFilter = AnalyticsTrendFilter;

export type TrendForm = {
  name: string;
  description: string;
  eventName: string;
  metric: AnalyticsInsightDefinition["metric"];
  bucket: AnalyticsInsightDefinition["bucket"];
  window: TrendWindow;
  breakdownProperty: string;
  filters: TrendFilter[];
};

type LoadStatus = "loading" | "ok" | "error" | "unavailable";
type PreviewStatus = "idle" | "loading" | "ok" | "error" | "unavailable";

export type UseTrendsResult = {
  insights: AnalyticsInsight[];
  properties: PromotedEventProperty[];
  status: LoadStatus;
  busy: boolean;
  preview: AnalyticsTrendResult | null;
  previewStatus: PreviewStatus;
  reload: () => void;
  runPreview: (form: TrendForm, insightId?: string) => Promise<boolean>;
  save: (form: TrendForm, insightId?: string) => Promise<AnalyticsInsight | null>;
  archive: (insightId: string) => Promise<boolean>;
  promoteProperty: (property: string, displayName?: string) => Promise<PromotedEventProperty | null>;
  archiveProperty: (propertyId: string) => Promise<boolean>;
};

type UseTrendsArgs = {
  client: Pick<
    ApiClient,
    | "listAnalyticsInsights"
    | "createAnalyticsInsight"
    | "updateAnalyticsInsight"
    | "archiveAnalyticsInsight"
    | "listPromotedEventProperties"
    | "promoteEventProperty"
    | "archivePromotedEventProperty"
    | "queryAnalyticsTrend"
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
};

export const EMPTY_TREND_FORM: TrendForm = {
  name: "",
  description: "",
  eventName: "",
  metric: "count",
  bucket: "hour",
  window: "24h",
  breakdownProperty: "",
  filters: [],
};

export function insightToForm(insight: AnalyticsInsight): TrendForm {
  return {
    name: insight.name,
    description: insight.description ?? "",
    eventName: insight.definition.eventName ?? "",
    metric: insight.definition.metric,
    bucket: insight.definition.bucket,
    window: insight.definition.bucket === "hour" ? "24h" : "30d",
    breakdownProperty: insight.definition.breakdownProperty ?? "",
    filters: (insight.definition.filters ?? []).map((filter) => ({ ...filter })),
  };
}

export function validateTrendForm(form: TrendForm): string | null {
  if (!form.name.trim()) return "Insight name is required.";
  if (form.filters.some((filter) => !filter.property.trim())) {
    return "Each property filter needs a property name.";
  }
  if (form.filters.some((filter) => (filter.operator === "eq" || filter.operator === "neq") && !filter.value?.trim())) {
    return "Equals and does-not-equal filters need a value.";
  }
  return null;
}

function definitionFromForm(form: TrendForm): AnalyticsInsightDefinition {
  const eventName = form.eventName.trim();
  const breakdownProperty = form.breakdownProperty.trim();
  const filters: AnalyticsTrendFilter[] = form.filters.map((filter) =>
    filter.operator === "eq" || filter.operator === "neq"
      ? { property: filter.property.trim(), operator: filter.operator, value: filter.value?.trim() ?? "" }
      : { property: filter.property.trim(), operator: filter.operator }
  );
  return {
    metric: form.metric,
    bucket: form.bucket,
    ...(eventName ? { eventName } : {}),
    ...(breakdownProperty ? { breakdownProperty } : {}),
    ...(filters.length > 0 ? { filters } : {}),
  };
}

function trendRange(window: TrendWindow): { from: Date; to: Date } {
  const to = new Date();
  const hours = window === "24h" ? 24 : window === "7d" ? 24 * 7 : 24 * 30;
  return { from: new Date(to.getTime() - hours * 60 * 60 * 1000), to };
}

export function useTrends({ client, projectId, environmentId }: UseTrendsArgs): UseTrendsResult {
  const scopeKey = projectId && environmentId ? `${projectId}:${environmentId}` : "";
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  const [loadedScope, setLoadedScope] = useState("");
  const [insights, setInsights] = useState<AnalyticsInsight[]>([]);
  const [properties, setProperties] = useState<PromotedEventProperty[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AnalyticsTrendResult | null>(null);
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("idle");
  const [tick, setTick] = useState(0);
  const loadGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const busyRef = useRef(false);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const generation = ++loadGeneration.current;
    ++previewGeneration.current;
    ++mutationGeneration.current;
    busyRef.current = false;
    setBusy(false);
    setPreview(null);
    setPreviewStatus("idle");

    if (!projectId || !environmentId) {
      setLoadedScope(scopeKey);
      setInsights([]);
      setProperties([]);
      setStatus("ok");
      return;
    }
    if (!client.listAnalyticsInsights || !client.listPromotedEventProperties) {
      setLoadedScope(scopeKey);
      setInsights([]);
      setProperties([]);
      setStatus("unavailable");
      return;
    }

    setStatus("loading");
    void Promise.all([
      client.listAnalyticsInsights({ projectId, environmentId }),
      client.listPromotedEventProperties({ projectId, environmentId }),
    ]).then(
      ([insightResult, propertyResult]) => {
        if (generation !== loadGeneration.current || scopeRef.current !== scopeKey) return;
        setLoadedScope(scopeKey);
        setInsights(insightResult.insights.filter((row) => !row.archivedAt));
        setProperties(propertyResult.properties.filter((row) => !row.archivedAt));
        setStatus("ok");
      },
      () => {
        if (generation !== loadGeneration.current || scopeRef.current !== scopeKey) return;
        setLoadedScope(scopeKey);
        setInsights([]);
        setProperties([]);
        setStatus("error");
      }
    );

    return () => {
      ++loadGeneration.current;
    };
  }, [client, environmentId, projectId, scopeKey, tick]);

  const runPreview = useCallback(async (form: TrendForm, insightId?: string): Promise<boolean> => {
    if (!projectId || !environmentId) return false;
    if (!client.queryAnalyticsTrend) {
      setPreview(null);
      setPreviewStatus("unavailable");
      return false;
    }
    const generation = ++previewGeneration.current;
    const requestScope = scopeKey;
    const definition = definitionFromForm(form);
    setPreview(null);
    setPreviewStatus("loading");
    try {
      const { from, to } = trendRange(form.window);
      const response = await client.queryAnalyticsTrend({
        projectId,
        environmentId,
        from,
        to,
        ...(insightId ? { insightId } : {}),
        ...definition,
      });
      if (generation !== previewGeneration.current || scopeRef.current !== requestScope) return false;
      setPreview(response.data);
      setPreviewStatus("ok");
      return true;
    } catch {
      if (generation !== previewGeneration.current || scopeRef.current !== requestScope) return false;
      setPreview(null);
      setPreviewStatus("error");
      return false;
    }
  }, [client, environmentId, projectId, scopeKey]);

  const runMutation = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    const generation = ++mutationGeneration.current;
    const requestScope = scopeKey;
    try {
      const result = await operation();
      if (generation !== mutationGeneration.current || scopeRef.current !== requestScope) return null;
      reload();
      return result;
    } catch (error) {
      console.error(error);
      if (generation === mutationGeneration.current && scopeRef.current === requestScope) reload();
      return null;
    } finally {
      if (generation === mutationGeneration.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [reload, scopeKey]);

  const save = useCallback(async (form: TrendForm, insightId?: string): Promise<AnalyticsInsight | null> => {
    if (!projectId || !environmentId || validateTrendForm(form)) return null;
    const definition = definitionFromForm(form);
    if (insightId) {
      if (!client.updateAnalyticsInsight) return null;
      const response = await runMutation(() => client.updateAnalyticsInsight!(
        insightId,
        { projectId, environmentId },
        { name: form.name.trim(), description: form.description.trim() || null, definition }
      ));
      return response?.insight ?? null;
    }
    if (!client.createAnalyticsInsight) return null;
    const response = await runMutation(() => client.createAnalyticsInsight!({
      projectId,
      environmentId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      definition,
    }));
    return response?.insight ?? null;
  }, [client, environmentId, projectId, runMutation]);

  const archive = useCallback(async (insightId: string): Promise<boolean> => {
    if (!projectId || !environmentId || !client.archiveAnalyticsInsight) return false;
    const result = await runMutation(() => client.archiveAnalyticsInsight!(insightId, { projectId, environmentId }));
    return result !== null;
  }, [client, environmentId, projectId, runMutation]);

  const promoteProperty = useCallback(async (
    property: string,
    displayName?: string
  ): Promise<PromotedEventProperty | null> => {
    const normalizedProperty = property.trim();
    if (!projectId || !environmentId || !normalizedProperty || !client.promoteEventProperty) return null;
    const response = await runMutation(() => client.promoteEventProperty!({
      projectId,
      environmentId,
      property: normalizedProperty,
      ...(displayName?.trim() ? { displayName: displayName.trim() } : {}),
    }));
    return response?.property ?? null;
  }, [client, environmentId, projectId, runMutation]);

  const archiveProperty = useCallback(async (propertyId: string): Promise<boolean> => {
    if (!projectId || !environmentId || !client.archivePromotedEventProperty) return false;
    const result = await runMutation(() => client.archivePromotedEventProperty!(propertyId, { projectId, environmentId }));
    return result !== null;
  }, [client, environmentId, projectId, runMutation]);

  const current = loadedScope === scopeKey;
  return {
    insights: current ? insights : [],
    properties: current ? properties : [],
    status: current ? status : "loading",
    busy,
    preview: current ? preview : null,
    previewStatus: current ? previewStatus : "idle",
    reload,
    runPreview,
    save,
    archive,
    promoteProperty,
    archiveProperty,
  };
}
