import type { Db } from "../client.js";
import { listProjects, listEnvironments, getProject } from "./admin.js";
import { getOperations } from "./operations-query.js";
import { getOverview } from "./telemetry-query.js";
import type { SystemHealthSnapshot, SystemStatus } from "../../../../apps/api/src/routes/system.js";

// ---------------------------------------------------------------------------
// Public types (verbatim from B1 spec §2)
// ---------------------------------------------------------------------------

export type FleetData = {
  window: "24h" | "7d" | "30d";
  generatedAt: string;
  projects: FleetProject[];
  rollup: FleetRollup;
};

export type FleetProject = {
  id: string;
  name: string;
  status: "ok" | "warning" | "critical";
  incidents: number;
  alerts: number;
  errorRatePercent: number | null;
  errorRateDelta: number | null;
  errorTrend: number[];
  events: number;
  activeUsers: number;
  activeTenants: number;
  llmCostUsd: string;
  llmCostDeltaUsd: string | null;
  p95TraceDurationMs: number | null;
  p95DeltaMs: number | null;
  infra: {
    api: "ok" | "warning" | "critical";
    db: "ok" | "warning" | "critical";
    redis: "ok" | "warning" | "critical";
    queue: "ok" | "warning" | "critical";
  };
  topIncident: {
    message: string;
    traceOrRouteName: string | null;
    occurrenceCount: number;
    affectedUsers: number;
    severity: "critical" | "warning";
  } | null;
};

export type FleetRollup = {
  counts: { ok: number; warning: number; critical: number };
  incidents: number;
  alerts: number;
  llmCostUsd: string;
  overall: "ok" | "warning" | "critical";
  total: number;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type FleetRollupOpts = {
  window: "24h" | "7d" | "30d";
  /** Inject for deterministic tests; defaults to new Date(). */
  now?: Date;
  /** Injectable system-health fetcher (sourced from API layer). */
  getHealth: () => Promise<SystemHealthSnapshot>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapOpsStatus(status: string): "ok" | "warning" | "critical" {
  if (status === "unhealthy") return "critical";
  if (status === "degraded") return "warning";
  return "ok"; // "healthy" | "not_configured"
}

function mapInfraStatus(status: SystemStatus): "ok" | "warning" | "critical" {
  if (status === "unhealthy") return "critical";
  if (status === "degraded") return "warning";
  return "ok";
}

function windowMs(window: "24h" | "7d" | "30d"): number {
  if (window === "24h") return 24 * 60 * 60 * 1000;
  if (window === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function buildErrorTrend(errors: Array<{ errors: number }>): number[] {
  const raw = errors.map((b) => b.errors);
  if (raw.length >= 12) return raw.slice(-12);
  // Pad left with zeros to reach 12
  const padding = Array<number>(12 - raw.length).fill(0);
  return [...padding, ...raw];
}

function hasPriorData(overview: { kpis: { events: number; traces: number; llmCostUsd: string } }): boolean {
  return overview.kpis.events > 0 || overview.kpis.traces > 0 || parseFloat(overview.kpis.llmCostUsd) > 0;
}

function rateFrom(overview: { kpis: { errors: number; traces: number } }): number | null {
  return overview.kpis.traces > 0 ? (overview.kpis.errors / overview.kpis.traces) * 100 : null;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getFleetRollup(db: Db, opts: FleetRollupOpts): Promise<FleetData> {
  const now = opts.now ?? new Date();
  const win = opts.window;

  // 1. Fetch all non-archived projects
  const projects = await listProjects(db);

  // 2. Fetch system-health snapshot once (shared infra object)
  const health = await opts.getHealth();
  const infra = {
    api: mapInfraStatus(health.services.api.status),
    db: mapInfraStatus(health.services.postgres.status),
    redis: mapInfraStatus(health.services.redis.status),
    queue: mapInfraStatus(health.services.worker.status)
  } as const;

  // 3. Resolve environments in parallel
  const projectEnvPairs: Array<{ projectId: string; projectName: string; environmentId: string }> = [];

  await Promise.all(
    projects.map(async (project) => {
      const envs = await listEnvironments(db, project.id);
      if (envs.length === 0) return; // No env — excluded

      // Case-insensitive "production" match, else lexically-first
      const prodEnv =
        envs.find((e) => e.name.toLowerCase() === "production") ??
        envs.slice().sort((a, b) => a.name.localeCompare(b.name))[0];

      projectEnvPairs.push({
        projectId: project.id,
        projectName: project.name,
        environmentId: prodEnv.id
      });
    })
  );

  // 4. Fan out per project: operations + current overview + prior overview concurrently
  const priorNow = new Date(now.getTime() - windowMs(win));

  const fleetProjects: FleetProject[] = await Promise.all(
    projectEnvPairs.map(async ({ projectId, projectName, environmentId }) => {
      const [ops, currentOverview, priorOverview] = await Promise.all([
        getOperations(db, { projectId, environmentId, window: win, now }),
        getOverview(db, { projectId, environmentId, window: win, now }),
        getOverview(db, { projectId, environmentId, window: win, now: priorNow })
      ]);

      // --- status ---
      const status = mapOpsStatus(ops.status);

      // --- incident + alert counts ---
      const incidents = ops.summary.incidents.open + ops.summary.incidents.investigating;
      const alerts = ops.summary.alerts.events.total;

      // --- error rate (both current and prior derived from the same source for symmetric delta) ---
      const errorRatePercent = rateFrom(currentOverview);
      const priorErrorRate = rateFrom(priorOverview);

      // --- deltas ---
      const priorHasData = hasPriorData(priorOverview);

      const errorRateDelta =
        errorRatePercent !== null && priorErrorRate !== null
          ? errorRatePercent - priorErrorRate
          : null;

      const llmCostDeltaUsd = priorHasData
        ? (parseFloat(currentOverview.kpis.llmCostUsd) - parseFloat(priorOverview.kpis.llmCostUsd)).toFixed(2)
        : null;

      const p95DeltaMs =
        priorHasData &&
        currentOverview.kpis.p95TraceDurationMs !== null &&
        priorOverview.kpis.p95TraceDurationMs !== null
          ? currentOverview.kpis.p95TraceDurationMs - priorOverview.kpis.p95TraceDurationMs
          : null;

      // --- error trend (12-point) ---
      const errorTrend = buildErrorTrend(currentOverview.trends.errors);

      // --- topIncident ---
      const incident = ops.recent.incidents[0] ?? null;
      let topIncident: FleetProject["topIncident"] = null;

      if (incident !== null) {
        let occurrenceCount = 0;
        let affectedUsers = 0;

        if (incident.latestErrorId !== null) {
          const egRow = await db
            .selectFrom("error_groups")
            .select(["occurrence_count", "affected_users_count"])
            .where("latest_error_id", "=", incident.latestErrorId)
            .executeTakeFirst();

          if (egRow) {
            occurrenceCount = Number(egRow.occurrence_count) || 0;
            affectedUsers = Number(egRow.affected_users_count) || 0;
          }
        }

        topIncident = {
          message: incident.message,
          traceOrRouteName: null,
          occurrenceCount,
          affectedUsers,
          severity: incident.severity === "critical" ? "critical" : "warning"
        };
      }

      return {
        id: projectId,
        name: projectName,
        status,
        incidents,
        alerts,
        errorRatePercent,
        errorRateDelta,
        errorTrend,
        events: currentOverview.kpis.events,
        activeUsers: currentOverview.kpis.activeUsers,
        activeTenants: currentOverview.kpis.activeTenants,
        llmCostUsd: currentOverview.kpis.llmCostUsd,
        llmCostDeltaUsd,
        p95TraceDurationMs: currentOverview.kpis.p95TraceDurationMs,
        p95DeltaMs,
        infra,
        topIncident
      } satisfies FleetProject;
    })
  );

  // 5. Sort by severity (critical → warning → ok) then name
  const severityOrder: Record<"ok" | "warning" | "critical", number> = { critical: 0, warning: 1, ok: 2 };
  const sorted = fleetProjects.slice().sort((a, b) => {
    const sA = severityOrder[a.status];
    const sB = severityOrder[b.status];
    if (sA !== sB) return sA - sB;
    return a.name.localeCompare(b.name);
  });

  // 6. Compute fleet rollup
  const rollup: FleetRollup = {
    counts: {
      ok: sorted.filter((p) => p.status === "ok").length,
      warning: sorted.filter((p) => p.status === "warning").length,
      critical: sorted.filter((p) => p.status === "critical").length
    },
    incidents: sorted.reduce((s, p) => s + p.incidents, 0),
    alerts: sorted.reduce((s, p) => s + p.alerts, 0),
    llmCostUsd: sorted.reduce((s, p) => s + parseFloat(p.llmCostUsd), 0).toFixed(2),
    overall: sorted.some((p) => p.status === "critical")
      ? "critical"
      : sorted.some((p) => p.status === "warning")
        ? "warning"
        : "ok",
    total: sorted.length
  };

  return {
    window: win,
    generatedAt: now.toISOString(),
    projects: sorted,
    rollup
  };
}

// ---------------------------------------------------------------------------
// Per-environment fleet breakdown (lazy-loaded on card expand)
// ---------------------------------------------------------------------------

export type FleetProjectEnv = {
  name: string;
  status: "ok" | "warning" | "critical";
  incidents: number;
  errorRatePercent: number | null;
  events: number;
  note: string | null;
};

export type FleetProjectEnvsResult = {
  projectId: string;
  envs: FleetProjectEnv[];
};

/**
 * Returns per-env health data for a single project.
 * Returns `undefined` if the project is unknown or archived — the route maps
 * this to a 404 response, consistent with the `getProject` → undefined pattern
 * used throughout the admin repository.
 */
export async function getProjectFleetEnvironments(
  db: Db,
  opts: { projectId: string; window: "24h" | "7d" | "30d"; now?: Date }
): Promise<FleetProjectEnvsResult | undefined> {
  const { projectId, window: win, now } = opts;

  // Resolve project — undefined means unknown or archived
  const project = await getProject(db, projectId);
  if (project === undefined) {
    return undefined;
  }

  // List non-archived environments for this project
  const allEnvs = await listEnvironments(db, projectId);

  // Production first, then the rest (stable relative order preserved)
  const prodEnvs = allEnvs.filter((e) => e.name.toLowerCase() === "production");
  const otherEnvs = allEnvs.filter((e) => e.name.toLowerCase() !== "production");
  const ordered = [...prodEnvs, ...otherEnvs].slice(0, 5);

  // Run getOperations for each env sequentially-within-parallel (all at once)
  const envResults = await Promise.all(
    ordered.map(async (env): Promise<FleetProjectEnv> => {
      const ops = await getOperations(db, { projectId, environmentId: env.id, window: win, now });

      const status = mapOpsStatus(ops.status);
      const incidents = ops.summary.incidents.open + ops.summary.incidents.investigating;
      const events = ops.summary.telemetry.events;
      const errorRatePercent = ops.summary.telemetry.errorRatePercent;
      const note = events === 0 && status === "ok" ? "no data" : null;

      return { name: env.name, status, incidents, errorRatePercent, events, note };
    })
  );

  return { projectId, envs: envResults };
}
