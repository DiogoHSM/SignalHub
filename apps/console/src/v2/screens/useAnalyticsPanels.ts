import { useCallback, useRef, useState } from "react";
import type { ApiClient } from "../../api/client";
import type {
  EventClickMapResponse,
  EventFunnelQuery,
  EventFunnelResponse,
  EventPathActorType,
  EventPathsResponse,
  EventRetentionQuery,
  EventRetentionResponse,
} from "../../api/types";

// ---------------------------------------------------------------------------
// Shared panel state
// ---------------------------------------------------------------------------

export type PanelState = "idle" | "loading" | "ok" | "invalid" | "error";

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export type FunnelStepVM = {
  index: number;
  name: string;
  actors: number;
  conversionPercent: number;
  dropOffFromPreviousPercent: number;
};

export type FunnelVM = {
  totals: { entrants: number; completed: number; conversionPercent: number };
  steps: FunnelStepVM[];
};

const FUNNEL_WINDOW = "7d" as const;
const FUNNEL_LIMIT = 20;

/** Split on newline or comma, trim, drop blanks, cap at 12 steps — 1:1 port of the v1 EventInvestigationPanel parser. */
export function parseFunnelSteps(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((step) => step.trim())
    .filter(Boolean)
    .slice(0, 12);
}

// PER-439: the funnel endpoint is being rewritten in SQL with optional
// `conversion_window` / `breakdown_property` params. Keep this the single
// place that assembles EventFunnelQuery so that follow-up only has to touch
// here (and the invalid slot in AnalyticsScreen).
export function buildFunnelQuery(
  projectId: string,
  environmentId: string,
  steps: string[]
): EventFunnelQuery {
  return { projectId, environmentId, window: FUNNEL_WINDOW, steps, limit: FUNNEL_LIMIT };
}

export function buildFunnelVM(response: EventFunnelResponse): FunnelVM {
  return {
    totals: response.totals,
    steps: response.steps.map((step) => ({
      index: step.index,
      name: step.name,
      actors: step.actors,
      conversionPercent: step.conversionPercent,
      dropOffFromPreviousPercent: step.dropOffFromPreviousPercent,
    })),
  };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export type RetentionIntervalVM = { index: number; label: string; retainedActors: number; retentionPercent: number };
export type RetentionCohortVM = { cohortStart: string; cohortLabel: string; entrants: number; intervals: RetentionIntervalVM[] };
export type RetentionVM = {
  totals: { cohorts: number; entrants: number };
  cohorts: RetentionCohortVM[];
};

const RETENTION_WINDOW = "30d" as const;
const RETENTION_PERIOD = "weekly" as const;
const RETENTION_INTERVALS = 6;

// PER-440: retention gains a `range_days` param. Keep this the single place
// that assembles EventRetentionQuery for that follow-up to touch.
export function buildRetentionQuery(
  projectId: string,
  environmentId: string,
  entryEvent: string,
  returnEvent: string
): EventRetentionQuery {
  return {
    projectId,
    environmentId,
    window: RETENTION_WINDOW,
    entryEvent,
    returnEvent,
    period: RETENTION_PERIOD,
    intervals: RETENTION_INTERVALS,
  };
}

export function buildRetentionVM(response: EventRetentionResponse): RetentionVM {
  return {
    totals: response.totals,
    cohorts: response.cohorts.map((cohort) => ({
      cohortStart: cohort.cohortStart,
      cohortLabel: cohort.cohortLabel,
      entrants: cohort.entrants,
      intervals: cohort.intervals.map((interval) => ({
        index: interval.index,
        label: interval.label,
        retainedActors: interval.retainedActors,
        retentionPercent: interval.retentionPercent,
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export type PathSampleEventVM = { id: string; name: string };
export type PathRowVM = {
  path: string[];
  actors: number;
  occurrences: number;
  lastSeenAt: string;
  sampleEvents: PathSampleEventVM[];
};
export type PathsVM = {
  totals: { actors: number; paths: number; events: number };
  paths: PathRowVM[];
};

export type PathsRunArgs = {
  startEvent: string;
  endEvent: string;
  actorType: EventPathActorType;
  pathLength: number;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
  from?: string;
  to?: string;
  /** Paths is one of the few analytics endpoints that DOES accept segmentId (client.ts:869). */
  segmentId?: string;
};

const PATHS_WINDOW = "7d" as const;
const PATHS_LIMIT = 20;

export function buildPathsVM(response: EventPathsResponse): PathsVM {
  return {
    totals: response.totals,
    paths: response.paths.map((row) => ({
      path: row.path,
      actors: row.actors,
      occurrences: row.occurrences,
      lastSeenAt: row.lastSeenAt,
      sampleEvents: row.sampleEvents.map((event) => ({ id: event.id, name: event.name })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Click map
// ---------------------------------------------------------------------------

export type ClickMapPointVM = { xBucket: number; yBucket: number; clicks: number };
export type ClickMapVM = {
  gridSize: number;
  totals: { clicks: number; routes: number; selectors: number };
  points: ClickMapPointVM[];
  routes: Array<{ route: string; clicks: number }>;
  selectors: Array<{ selector: string; clicks: number }>;
};

export type ClickMapRunArgs = {
  route: string;
  selector?: string;
  tenantId?: string;
  userId?: string;
  sessionId?: string;
};

const CLICK_MAP_WINDOW = "7d" as const;
const CLICK_MAP_GRID_SIZE = 20;
const CLICK_MAP_LIMIT = 80;

export function buildClickMapVM(response: EventClickMapResponse): ClickMapVM {
  return {
    gridSize: response.filters.gridSize,
    totals: response.totals,
    points: response.points.map((point) => ({ xBucket: point.xBucket, yBucket: point.yBucket, clicks: point.clicks })),
    routes: response.routes,
    selectors: response.selectors.map((item) => ({ selector: item.selector, clicks: item.clicks })),
  };
}

// ---------------------------------------------------------------------------
// Hook — 4 independent idle-first state machines. Nothing fires on mount;
// each panel only fetches when its `run(...)` is called from the screen.
// ---------------------------------------------------------------------------

type UseAnalyticsPanelsArgs = {
  client: {
    getEventFunnel?: ApiClient["getEventFunnel"];
    getEventRetention?: ApiClient["getEventRetention"];
    getEventPaths?: ApiClient["getEventPaths"];
    getEventClickMap?: ApiClient["getEventClickMap"];
  };
  projectId: string | undefined;
  environmentId: string | undefined;
};

export type UseAnalyticsPanelsResult = {
  funnel: { state: PanelState; data: FunnelVM | null; run: (stepsInput: string) => void };
  retention: { state: PanelState; data: RetentionVM | null; run: (entryEvent: string, returnEvent: string) => void };
  paths: { state: PanelState; data: PathsVM | null; run: (args: PathsRunArgs) => void };
  clickMap: { state: PanelState; data: ClickMapVM | null; run: (args: ClickMapRunArgs) => void };
};

export function useAnalyticsPanels({ client, projectId, environmentId }: UseAnalyticsPanelsArgs): UseAnalyticsPanelsResult {
  const [funnelState, setFunnelState] = useState<PanelState>("idle");
  const [funnelData, setFunnelData] = useState<FunnelVM | null>(null);
  const funnelGenRef = useRef(0);

  const [retentionState, setRetentionState] = useState<PanelState>("idle");
  const [retentionData, setRetentionData] = useState<RetentionVM | null>(null);
  const retentionGenRef = useRef(0);

  const [pathsState, setPathsState] = useState<PanelState>("idle");
  const [pathsData, setPathsData] = useState<PathsVM | null>(null);
  const pathsGenRef = useRef(0);

  const [clickMapState, setClickMapState] = useState<PanelState>("idle");
  const [clickMapData, setClickMapData] = useState<ClickMapVM | null>(null);
  const clickMapGenRef = useRef(0);

  const runFunnel = useCallback(
    (stepsInput: string) => {
      const steps = parseFunnelSteps(stepsInput);
      if (steps.length < 2) {
        setFunnelData(null);
        setFunnelState("invalid");
        return;
      }
      if (!projectId || !environmentId || !client.getEventFunnel) {
        setFunnelData(null);
        setFunnelState("error");
        return;
      }
      const gen = ++funnelGenRef.current;
      setFunnelState("loading");
      void client.getEventFunnel(buildFunnelQuery(projectId, environmentId, steps)).then(
        ({ data }) => {
          if (gen !== funnelGenRef.current) return;
          setFunnelData(buildFunnelVM(data));
          setFunnelState("ok");
        },
        () => {
          if (gen !== funnelGenRef.current) return;
          setFunnelData(null);
          setFunnelState("error");
        }
      );
    },
    [client, projectId, environmentId]
  );

  const runRetention = useCallback(
    (entryEventInput: string, returnEventInput: string) => {
      const entryEvent = entryEventInput.trim();
      const returnEvent = returnEventInput.trim();
      if (!entryEvent || !returnEvent) {
        setRetentionData(null);
        setRetentionState("invalid");
        return;
      }
      if (!projectId || !environmentId || !client.getEventRetention) {
        setRetentionData(null);
        setRetentionState("error");
        return;
      }
      const gen = ++retentionGenRef.current;
      setRetentionState("loading");
      void client.getEventRetention(buildRetentionQuery(projectId, environmentId, entryEvent, returnEvent)).then(
        ({ data }) => {
          if (gen !== retentionGenRef.current) return;
          setRetentionData(buildRetentionVM(data));
          setRetentionState("ok");
        },
        () => {
          if (gen !== retentionGenRef.current) return;
          setRetentionData(null);
          setRetentionState("error");
        }
      );
    },
    [client, projectId, environmentId]
  );

  const runPaths = useCallback(
    (args: PathsRunArgs) => {
      const startEvent = args.startEvent.trim();
      const endEvent = args.endEvent.trim();
      if (!startEvent && !endEvent) {
        setPathsData(null);
        setPathsState("invalid");
        return;
      }
      if (!projectId || !environmentId || !client.getEventPaths) {
        setPathsData(null);
        setPathsState("error");
        return;
      }
      const gen = ++pathsGenRef.current;
      setPathsState("loading");
      void client
        .getEventPaths({
          projectId,
          environmentId,
          window: PATHS_WINDOW,
          ...(startEvent ? { startEvent } : {}),
          ...(endEvent ? { endEvent } : {}),
          ...(args.tenantId ? { tenantId: args.tenantId } : {}),
          ...(args.userId ? { userId: args.userId } : {}),
          ...(args.sessionId ? { sessionId: args.sessionId } : {}),
          ...(args.traceId ? { traceId: args.traceId } : {}),
          ...(args.from ? { from: args.from } : {}),
          ...(args.to ? { to: args.to } : {}),
          ...(args.segmentId ? { segmentId: args.segmentId } : {}),
          actorType: args.actorType,
          pathLength: args.pathLength,
          limit: PATHS_LIMIT,
        })
        .then(
          ({ data }) => {
            if (gen !== pathsGenRef.current) return;
            setPathsData(buildPathsVM(data));
            setPathsState("ok");
          },
          () => {
            if (gen !== pathsGenRef.current) return;
            setPathsData(null);
            setPathsState("error");
          }
        );
    },
    [client, projectId, environmentId]
  );

  const runClickMap = useCallback(
    (args: ClickMapRunArgs) => {
      const route = args.route.trim();
      if (!route) {
        setClickMapData(null);
        setClickMapState("invalid");
        return;
      }
      if (!projectId || !environmentId || !client.getEventClickMap) {
        setClickMapData(null);
        setClickMapState("error");
        return;
      }
      const gen = ++clickMapGenRef.current;
      setClickMapState("loading");
      void client
        .getEventClickMap({
          projectId,
          environmentId,
          window: CLICK_MAP_WINDOW,
          route,
          ...(args.selector ? { selector: args.selector } : {}),
          ...(args.tenantId ? { tenantId: args.tenantId } : {}),
          ...(args.userId ? { userId: args.userId } : {}),
          ...(args.sessionId ? { sessionId: args.sessionId } : {}),
          gridSize: CLICK_MAP_GRID_SIZE,
          limit: CLICK_MAP_LIMIT,
        })
        .then(
          ({ data }) => {
            if (gen !== clickMapGenRef.current) return;
            setClickMapData(buildClickMapVM(data));
            setClickMapState("ok");
          },
          () => {
            if (gen !== clickMapGenRef.current) return;
            setClickMapData(null);
            setClickMapState("error");
          }
        );
    },
    [client, projectId, environmentId]
  );

  return {
    funnel: { state: funnelState, data: funnelData, run: runFunnel },
    retention: { state: retentionState, data: retentionData, run: runRetention },
    paths: { state: pathsState, data: pathsData, run: runPaths },
    clickMap: { state: clickMapState, data: clickMapData, run: runClickMap },
  };
}
