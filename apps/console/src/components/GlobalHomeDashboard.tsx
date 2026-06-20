import { Activity, AlertTriangle, ArrowRight, Gauge, HeartPulse, ServerCrash } from "lucide-react";
import type { Project } from "../api/types";

export type GlobalProjectStatus = "healthy" | "attention" | "degraded" | "critical";

export type GlobalProjectSignal = {
  criticalAlerts?: number;
  downMonitors?: number;
  errorRatePercent?: number | null;
  openIncidents?: number;
  p95LatencyMs?: number | null;
  setupGaps?: number;
  status?: GlobalProjectStatus;
};

type Props = {
  isLoading: boolean;
  onOpenProject: (projectId: string) => void;
  projectSignals?: Record<string, GlobalProjectSignal | undefined>;
  projects: Project[];
};

type RankedProject = {
  project: Project;
  riskLabel: string;
  riskTone: "success" | "attention" | "degraded" | "failed";
  score: number;
  signal: GlobalProjectSignal | undefined;
  summary: string;
};

export function GlobalHomeDashboard({ isLoading, onOpenProject, projectSignals = {}, projects }: Props) {
  const projectCount = projects.length;
  const rankedProjects = projects
    .map((project) => rankProject(project, projectSignals[project.id]))
    .sort((left, right) => right.score - left.score || left.project.name.localeCompare(right.project.name));
  const summary = rankedProjects.reduce(
    (accumulator, item) => ({
      criticalProjects: accumulator.criticalProjects + (item.riskLabel === "Critical" ? 1 : 0),
      downMonitors: accumulator.downMonitors + (item.signal?.downMonitors ?? 0),
      openIncidents: accumulator.openIncidents + (item.signal?.openIncidents ?? 0),
      outliers: accumulator.outliers + countOutliers(item.signal)
    }),
    { criticalProjects: 0, downMonitors: 0, openIncidents: 0, outliers: 0 }
  );
  const globalStatus = getGlobalStatus(projectCount, rankedProjects);

  return (
    <section className="global-home" aria-labelledby="global-home-title">
      <div className="global-home__hero">
        <div>
          <p className="eyebrow">Global Home</p>
          <h1 id="global-home-title">Executive risk dashboard</h1>
          <p>All monitored projects, ordered by operational attention needed.</p>
        </div>
        <span className={`status-pill status-pill--${globalStatus.tone}`}>{globalStatus.label}</span>
      </div>

      <div className="global-home__kpis" aria-label="Global operational summary">
        <article className="metric-card">
          <span>
            <Gauge aria-hidden="true" size={16} /> Projects
          </span>
          <strong>{projectCount}</strong>
          <small>{projectCount === 1 ? "monitored project" : "monitored projects"}</small>
        </article>
        <article className="metric-card">
          <span>
            <AlertTriangle aria-hidden="true" size={16} /> Open incidents
          </span>
          <strong>{summary.openIncidents}</strong>
          <small>{summary.criticalProjects} critical projects</small>
        </article>
        <article className="metric-card">
          <span>
            <HeartPulse aria-hidden="true" size={16} /> Monitors
          </span>
          <strong>{summary.downMonitors}</strong>
          <small>down monitors</small>
        </article>
        <article className="metric-card">
          <span>
            <Activity aria-hidden="true" size={16} /> Outliers
          </span>
          <strong>{summary.outliers}</strong>
          <small>error-rate and p95 signals</small>
        </article>
      </div>

      <div className="global-home__grid">
        <section className="panel global-home__attention" aria-labelledby="attention-queue-title">
          <div className="panel-header">
            <div>
              <h2 id="attention-queue-title">Attention queue</h2>
              <p className="muted-text">Start from the project that needs operational review.</p>
            </div>
            <span className="count-pill">{isLoading ? "Loading" : projectCount}</span>
          </div>

          {isLoading ? (
            <p className="muted-text">Loading monitored projects...</p>
          ) : projectCount === 0 ? (
            <div className="empty-state-inline">
              <ServerCrash aria-hidden="true" size={22} />
              <strong>No monitored projects yet.</strong>
              <p>Create a project in Configure or Onboarding to start collecting telemetry.</p>
            </div>
          ) : (
            <div className="global-project-list">
              {rankedProjects.map(({ project, riskLabel, riskTone, summary }) => (
                <button
                  aria-label={`Open ${project.name} operations`}
                  className={`global-project-row global-project-row--${riskTone}`}
                  key={project.id}
                  onClick={() => onOpenProject(project.id)}
                  type="button"
                >
                  <span>
                    <strong>{project.name}</strong>
                    <small>{summary}</small>
                  </span>
                  <em>{riskLabel}</em>
                  <ArrowRight aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="panel global-home__notes" aria-labelledby="global-home-next-title">
          <div className="panel-header">
            <h2 id="global-home-next-title">Next signal rollups</h2>
          </div>
          <ul className="signal-list">
            <li>
              <span className="signal-dot signal-dot--danger" /> Error-rate and incident spikes
            </li>
            <li>
              <span className="signal-dot signal-dot--warning" /> p95 route and monitor degradation
            </li>
            <li>
              <span className="signal-dot signal-dot--info" /> Positive traffic and usage outliers
            </li>
            <li>
              <span className="signal-dot signal-dot--success" /> Configuration health coverage
            </li>
          </ul>
        </aside>
      </div>
    </section>
  );
}

function rankProject(project: Project, signal: GlobalProjectSignal | undefined): RankedProject {
  if (!signal) {
    return {
      project,
      riskLabel: "Needs setup",
      riskTone: "attention",
      score: 10,
      signal,
      summary: "No operational rollup yet"
    };
  }

  const statusScore = signal.status === "critical" ? 100 : signal.status === "degraded" ? 65 : signal.status === "attention" ? 35 : 0;
  const openIncidents = signal.openIncidents ?? 0;
  const downMonitors = signal.downMonitors ?? 0;
  const criticalAlerts = signal.criticalAlerts ?? 0;
  const p95LatencyMs = signal.p95LatencyMs ?? 0;
  const errorRatePercent = signal.errorRatePercent ?? 0;
  const setupGaps = signal.setupGaps ?? 0;
  const score =
    statusScore +
    openIncidents * 18 +
    downMonitors * 25 +
    criticalAlerts * 20 +
    setupGaps * 8 +
    (p95LatencyMs >= 1000 ? 12 : 0) +
    (errorRatePercent >= 5 ? 12 : 0);
  const riskLabel = score >= 100 ? "Critical" : score >= 65 ? "Degraded" : score >= 25 ? "Needs attention" : "Healthy";
  const riskTone = riskLabel === "Critical" ? "failed" : riskLabel === "Degraded" ? "degraded" : riskLabel === "Needs attention" ? "attention" : "success";

  return {
    project,
    riskLabel,
    riskTone,
    score,
    signal,
    summary: summarizeSignal({ criticalAlerts, downMonitors, errorRatePercent, openIncidents, p95LatencyMs, setupGaps })
  };
}

function summarizeSignal(signal: Required<Omit<GlobalProjectSignal, "status">>): string {
  const parts: string[] = [];
  const errorRatePercent = signal.errorRatePercent ?? 0;
  const p95LatencyMs = signal.p95LatencyMs ?? 0;
  if (signal.openIncidents > 0) parts.push(`${signal.openIncidents} ${signal.openIncidents === 1 ? "incident" : "incidents"}`);
  if (signal.downMonitors > 0) parts.push(`${signal.downMonitors} ${signal.downMonitors === 1 ? "monitor" : "monitors"} down`);
  if (signal.criticalAlerts > 0) parts.push(`${signal.criticalAlerts} critical ${signal.criticalAlerts === 1 ? "alert" : "alerts"}`);
  if (p95LatencyMs >= 1000) parts.push(`p95 ${formatDuration(p95LatencyMs)}`);
  if (errorRatePercent >= 5) parts.push(`${errorRatePercent.toFixed(1)}% errors`);
  if (signal.setupGaps > 0) parts.push(`${signal.setupGaps} setup ${signal.setupGaps === 1 ? "gap" : "gaps"}`);
  return parts.length > 0 ? parts.join(" · ") : "No active risk signals";
}

function countOutliers(signal: GlobalProjectSignal | undefined): number {
  if (!signal) return 0;
  return (signal.errorRatePercent != null && signal.errorRatePercent >= 5 ? 1 : 0) + (signal.p95LatencyMs != null && signal.p95LatencyMs >= 1000 ? 1 : 0);
}

function getGlobalStatus(projectCount: number, rankedProjects: RankedProject[]): { label: string; tone: "success" | "attention" | "degraded" | "failed" } {
  if (projectCount === 0) return { label: "Setup needed", tone: "attention" };
  if (rankedProjects.some((project) => project.riskLabel === "Critical")) return { label: "Critical", tone: "failed" };
  if (rankedProjects.some((project) => project.riskLabel === "Degraded")) return { label: "Degraded", tone: "degraded" };
  if (rankedProjects.some((project) => project.riskLabel === "Needs attention" || project.riskLabel === "Needs setup")) {
    return { label: "Needs attention", tone: "attention" };
  }
  return { label: "Healthy", tone: "success" };
}

function formatDuration(milliseconds: number): string {
  if (milliseconds >= 1000) return `${(milliseconds / 1000).toFixed(2).replace(/0$/, "").replace(/\.$/, "")}s`;
  return `${Math.round(milliseconds)}ms`;
}
