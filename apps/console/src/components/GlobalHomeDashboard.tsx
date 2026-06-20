import { Activity, AlertTriangle, ArrowRight, Gauge, HeartPulse, ServerCrash } from "lucide-react";
import type { Project } from "../api/types";

type Props = {
  isLoading: boolean;
  onOpenProject: (projectId: string) => void;
  projects: Project[];
};

export function GlobalHomeDashboard({ isLoading, onOpenProject, projects }: Props) {
  const projectCount = projects.length;

  return (
    <section className="global-home" aria-labelledby="global-home-title">
      <div className="global-home__hero">
        <div>
          <p className="eyebrow">Global Home</p>
          <h1 id="global-home-title">Executive risk dashboard</h1>
          <p>All monitored projects, ordered by operational attention needed.</p>
        </div>
        <span className="status-pill status-pill--attention">{projectCount === 0 ? "Setup needed" : "Baseline view"}</span>
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
          <strong>--</strong>
          <small>Global aggregation lands in the next PR</small>
        </article>
        <article className="metric-card">
          <span>
            <HeartPulse aria-hidden="true" size={16} /> Monitors
          </span>
          <strong>--</strong>
          <small>Down/degraded rollup pending</small>
        </article>
        <article className="metric-card">
          <span>
            <Activity aria-hidden="true" size={16} /> Outliers
          </span>
          <strong>--</strong>
          <small>Error rate, p95, ingest, and LLM cost</small>
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
              {projects.map((project) => (
                <button
                  aria-label={`Open ${project.name} operations`}
                  className="global-project-row"
                  key={project.id}
                  onClick={() => onOpenProject(project.id)}
                  type="button"
                >
                  <span>
                    <strong>{project.name}</strong>
                    <small>Open the project workspace to review operational health.</small>
                  </span>
                  <em>Operations</em>
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
