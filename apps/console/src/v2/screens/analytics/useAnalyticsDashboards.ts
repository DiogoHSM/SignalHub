import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../../api/client";
import type {
  AnalyticsDashboard,
  AnalyticsDashboardCategory,
  AnalyticsDashboardWidget,
  AnalyticsInsight,
  DashboardReportResponse,
} from "../../../api/types";

export type DashboardWindow = "24h" | "7d" | "30d";
export type DashboardWidgetDraft = AnalyticsDashboardWidget & { id: string };

export type DashboardForm = {
  name: string;
  description: string;
  category: AnalyticsDashboardCategory;
  window: DashboardWindow;
  widgets: DashboardWidgetDraft[];
};

type LoadStatus = "loading" | "ok" | "error" | "unavailable";
type PreviewStatus = "idle" | "loading" | "ok" | "error" | "unavailable";

type Args = {
  client: Pick<
    ApiClient,
    | "listAnalyticsDashboards"
    | "createAnalyticsDashboard"
    | "updateAnalyticsDashboard"
    | "archiveAnalyticsDashboard"
    | "getDashboardReport"
    | "listAnalyticsInsights"
  >;
  projectId: string | undefined;
  environmentId: string | undefined;
};

export type UseAnalyticsDashboardsResult = {
  dashboards: AnalyticsDashboard[];
  insights: AnalyticsInsight[];
  status: LoadStatus;
  busy: boolean;
  preview: DashboardReportResponse | null;
  previewStatus: PreviewStatus;
  reload: () => void;
  previewDashboard: (dashboardId: string, window: DashboardWindow) => Promise<boolean>;
  save: (form: DashboardForm, dashboardId?: string) => Promise<AnalyticsDashboard | null>;
  duplicate: (dashboard: AnalyticsDashboard) => Promise<AnalyticsDashboard | null>;
  archive: (dashboardId: string) => Promise<boolean>;
};

export const EMPTY_DASHBOARD_FORM: DashboardForm = {
  name: "",
  description: "",
  category: "operational",
  window: "24h",
  widgets: [],
};

let localWidgetSequence = 0;
export function newInsightWidget(insight: AnalyticsInsight): DashboardWidgetDraft {
  localWidgetSequence += 1;
  return {
    id: `draft_widget_${localWidgetSequence}`,
    type: "insight",
    title: insight.name,
    width: "half",
    options: { insightId: insight.id },
  };
}

export function dashboardToForm(dashboard: AnalyticsDashboard): DashboardForm {
  return {
    name: dashboard.name,
    description: dashboard.description ?? "",
    category: dashboard.category,
    window: dashboard.filters.window ?? "24h",
    widgets: dashboard.widgets.map((widget) => ({ ...widget, options: { ...widget.options } })),
  };
}

export function validateDashboardForm(form: DashboardForm): string | null {
  if (!form.name.trim()) return "Dashboard name is required.";
  if (form.widgets.length === 0) return "Add at least one saved insight.";
  if (form.widgets.some((widget) => !widget.title.trim())) return "Every widget needs a title.";
  return null;
}

function payload(form: DashboardForm) {
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category,
    filters: { window: form.window },
    widgets: form.widgets.map(({ type, title, width, options }) => ({ type, title: title.trim(), width, options })),
  };
}

export function useAnalyticsDashboards({ client, projectId, environmentId }: Args): UseAnalyticsDashboardsResult {
  const scopeKey = projectId && environmentId ? `${projectId}:${environmentId}` : "";
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const [loadedScope, setLoadedScope] = useState("");
  const [dashboards, setDashboards] = useState<AnalyticsDashboard[]>([]);
  const [insights, setInsights] = useState<AnalyticsInsight[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DashboardReportResponse | null>(null);
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
      setDashboards([]);
      setInsights([]);
      setStatus("ok");
      return;
    }
    if (!client.listAnalyticsDashboards || !client.listAnalyticsInsights) {
      setLoadedScope(scopeKey);
      setDashboards([]);
      setInsights([]);
      setStatus("unavailable");
      return;
    }
    setStatus("loading");
    void Promise.all([
      client.listAnalyticsDashboards({ projectId, environmentId }),
      client.listAnalyticsInsights({ projectId, environmentId }),
    ]).then(
      ([dashboardResult, insightResult]) => {
        if (generation !== loadGeneration.current || scopeRef.current !== scopeKey) return;
        setLoadedScope(scopeKey);
        setDashboards(dashboardResult.dashboards.filter((row) => !row.archivedAt));
        setInsights(insightResult.insights.filter((row) => !row.archivedAt));
        setStatus("ok");
      },
      () => {
        if (generation !== loadGeneration.current || scopeRef.current !== scopeKey) return;
        setLoadedScope(scopeKey);
        setDashboards([]);
        setInsights([]);
        setStatus("error");
      }
    );
    return () => { ++loadGeneration.current; };
  }, [client, environmentId, projectId, scopeKey, tick]);

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
    } catch {
      return null;
    } finally {
      if (generation === mutationGeneration.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [reload, scopeKey]);

  const previewDashboard = useCallback(async (dashboardId: string, window: DashboardWindow) => {
    if (!projectId || !environmentId) return false;
    if (!client.getDashboardReport) {
      setPreviewStatus("unavailable");
      return false;
    }
    const generation = ++previewGeneration.current;
    const requestScope = scopeKey;
    setPreview(null);
    setPreviewStatus("loading");
    try {
      const response = await client.getDashboardReport(dashboardId, { projectId, environmentId, window });
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

  const save = useCallback(async (form: DashboardForm, dashboardId?: string) => {
    if (!projectId || !environmentId || validateDashboardForm(form)) return null;
    if (dashboardId) {
      if (!client.updateAnalyticsDashboard) return null;
      const result = await runMutation(() => client.updateAnalyticsDashboard!(dashboardId, { projectId, environmentId }, payload(form)));
      return result?.dashboard ?? null;
    }
    if (!client.createAnalyticsDashboard) return null;
    const result = await runMutation(() => client.createAnalyticsDashboard!({ projectId, environmentId, ...payload(form) }));
    return result?.dashboard ?? null;
  }, [client, environmentId, projectId, runMutation]);

  const duplicate = useCallback(async (dashboard: AnalyticsDashboard) => {
    const form = dashboardToForm(dashboard);
    return save({ ...form, name: `${form.name} copy` });
  }, [save]);

  const archive = useCallback(async (dashboardId: string) => {
    if (!projectId || !environmentId || !client.archiveAnalyticsDashboard) return false;
    const result = await runMutation(() => client.archiveAnalyticsDashboard!(dashboardId, { projectId, environmentId }));
    return result !== null;
  }, [client, environmentId, projectId, runMutation]);

  const current = loadedScope === scopeKey;
  return {
    dashboards: current ? dashboards : [],
    insights: current ? insights : [],
    status: current ? status : "loading",
    busy,
    preview: current ? preview : null,
    previewStatus: current ? previewStatus : "idle",
    reload,
    previewDashboard,
    save,
    duplicate,
    archive,
  };
}
