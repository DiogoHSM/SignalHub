import { useEffect, useState } from "react";
import type { ApiClient } from "../api/client";
import type { User } from "../api/types";
import { useConsoleProjects } from "./useConsoleProjects";
import { useFleet } from "./useFleet";
import { sev } from "../components/ui/v2/status";
import "./mobile-status.css";

// A lean, read-only "is everything ok" glance for narrow viewports. The desktop
// shell (.sh-v2 .app) is a fixed 3-column grid with no mobile breakpoint by
// design — retrofitting it responsively would touch every screen's chrome for
// a need that's actually much narrower: a quick status check, not investigation.
// This is its own small layout instead, reusing the same fleet data HealthRail
// already fetches.

type MobileStatusViewProps = {
  client: ApiClient;
  user: User;
  onSignOut: () => Promise<void>;
};

function timeAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ago`;
}

export function MobileStatusView({ client, user, onSignOut }: MobileStatusViewProps) {
  const { projects } = useConsoleProjects(client);
  const fleet = useFleet({
    fetchFleet: client.fetchFleet,
    fetchProjectEnvironments: client.fetchFleetProjectEnvironments,
    seedProjects: projects
  });
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => void fleet.refreshFleet(), 60_000);
    return () => clearInterval(id);
  }, [fleet.refreshFleet]);

  const overall = sev(fleet.rollup.overall);

  return (
    <div className="sh-v2 ms-root">
      <header className="ms-head">
        <div className="ms-head__logo" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M3 12h4l2.4-6 5.2 12 2.4-6h4" />
          </svg>
        </div>
        <span className="ms-head__title">SignalMonitor</span>
        <span className="ms-head__spacer" />
        <span className="ms-head__user">{user.email}</span>
        <button className="ms-head__signout sh-hit-target" type="button" onClick={() => void onSignOut()}>
          Sign out
        </button>
      </header>

      <div className="ms-body">
        <section className="ms-banner" data-status={fleet.rollup.overall} aria-label="Fleet status">
          <div className="ms-banner__status" style={{ color: overall.color }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: overall.color, flexShrink: 0 }} />
            {overall.label}
          </div>
          <div className="ms-banner__legend">
            <span>
              <i style={{ background: sev("critical").color }} />
              {fleet.rollup.counts.critical} critical
            </span>
            <span>
              <i style={{ background: sev("warning").color }} />
              {fleet.rollup.counts.warning} warning
            </span>
            <span>
              <i style={{ background: sev("ok").color }} />
              {fleet.rollup.counts.ok} ok
            </span>
          </div>
          <div className="ms-banner__meta">
            <span>
              {fleet.rollup.incidents} open incident{fleet.rollup.incidents === 1 ? "" : "s"}
            </span>
            <button className="ms-refresh sh-hit-target" type="button" onClick={() => void fleet.refreshFleet()}>
              updated {timeAgo(fleet.lastUpdated)} · refresh
            </button>
          </div>
        </section>

        {fleet.projects.length === 0 ? (
          <p className="ms-empty">No projects yet.</p>
        ) : (
          <div className="ms-projects">
            {fleet.projects.map((project) => {
              const isOpen = openProjectId === project.id;
              const envState = fleet.environments[project.id];
              return (
                <div key={project.id} className="ms-card status-card" data-status={project.status} data-open={isOpen}>
                  <button
                    className="ms-card__main sh-hit-target"
                    type="button"
                    onClick={() => {
                      const next = isOpen ? null : project.id;
                      setOpenProjectId(next);
                      if (next && !envState) void fleet.loadProjectEnvironments(project.id);
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: sev(project.status).color,
                        flexShrink: 0
                      }}
                    />
                    <span className="ms-card__name">{project.name}</span>
                    <span className={`ms-card__stat ${project.incidents > 0 ? "ms-card__stat--bad" : ""}`}>
                      {project.incidents > 0 ? `${project.incidents} inc` : "ok"}
                    </span>
                    <span className="ms-card__chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                  {isOpen ? (
                    <div className="ms-envs">
                      {!envState || envState.status === "loading" ? (
                        <p className="ms-env__load">Loading environments…</p>
                      ) : envState.status === "error" ? (
                        <p className="ms-env__load">Environment health unavailable</p>
                      ) : envState.data.length === 0 ? (
                        <p className="ms-env__load">No environments</p>
                      ) : (
                        envState.data.map((env) => (
                          <div className="ms-env" key={env.name}>
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: sev(env.status).color,
                                flexShrink: 0
                              }}
                            />
                            <span className="ms-env__name">{env.name}</span>
                            <span className="ms-env__stat">
                              {env.incidents > 0 ? `${env.incidents} inc` : "ok"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
