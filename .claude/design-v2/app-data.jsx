/* SignalHub v2 — mock data. 5 projects with cross-project health. */

const PROJECTS = [
  {
    id: "prj_acme", name: "Acme Platform", code: "acme",
    status: "critical",
    incidents: 2, alerts: 1,
    errorRate: 0.81, errorRateDelta: +0.34,
    errorTrend: [4, 6, 5, 8, 7, 9, 14, 22, 38, 28, 18, 24],
    events: "4.82M", eventsRaw: 4820000,
    users: "14,201", tenants: 287,
    llmCost: 142.18, llmDelta: +22,
    p95: 842, p95Delta: +120,
    infra: { api: "ok", db: "ok", redis: "warning", queue: "ok" },
    topIncident: { code: "PaymentTimeoutError", path: "/api/checkout", count: 412, users: 38, sev: "critical" },
    envs: [
      { name: "production", status: "critical", incidents: 2, errorRate: 0.81, events: "3.9M", note: "PaymentTimeoutError · spike 14h" },
      { name: "staging",    status: "ok",       incidents: 0, errorRate: 0.12, events: "642K", note: "estável" },
      { name: "development",status: "ok",       incidents: 0, errorRate: 0.04, events: "284K", note: "estável" }
    ]
  },
  {
    id: "prj_northwind", name: "Northwind", code: "nw",
    status: "warning",
    incidents: 1, alerts: 1,
    errorRate: 0.42, errorRateDelta: +0.08,
    errorTrend: [3, 3, 4, 4, 5, 6, 5, 7, 8, 9, 11, 12],
    events: "2.31M", eventsRaw: 2310000,
    users: "8,920", tenants: 142,
    llmCost: 64.12, llmDelta: +6,
    p95: 1240, p95Delta: +380,
    infra: { api: "ok", db: "ok", redis: "ok", queue: "warning" },
    topIncident: { code: "p95 latency degradation", path: "trace generate_report", count: 0, users: 0, sev: "warning" },
    envs: [
      { name: "production", status: "warning", incidents: 1, errorRate: 0.42, events: "1.8M", note: "p95 acima de 15s" },
      { name: "staging",    status: "ok",       incidents: 0, errorRate: 0.18, events: "412K", note: "estável" }
    ]
  },
  {
    id: "prj_globex", name: "Globex", code: "globex",
    status: "ok",
    incidents: 0, alerts: 0,
    errorRate: 0.09, errorRateDelta: -0.02,
    errorTrend: [6, 5, 5, 4, 5, 4, 4, 3, 4, 3, 3, 3],
    events: "1.04M", eventsRaw: 1040000,
    users: "3,180", tenants: 67,
    llmCost: 18.94, llmDelta: -3,
    p95: 318, p95Delta: -22,
    infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
    topIncident: null,
    envs: [
      { name: "production", status: "ok", incidents: 0, errorRate: 0.09, events: "0.9M", note: "estável" },
      { name: "staging",    status: "ok", incidents: 0, errorRate: 0.06, events: "140K", note: "estável" }
    ]
  },
  {
    id: "prj_initech", name: "Initech", code: "initech",
    status: "warning",
    incidents: 0, alerts: 1,
    errorRate: 0.64, errorRateDelta: +0.21,
    errorTrend: [4, 5, 4, 6, 5, 7, 6, 8, 9, 8, 10, 11],
    events: "0.71M", eventsRaw: 710000,
    users: "1,980", tenants: 54,
    llmCost: 9.42, llmDelta: +1,
    p95: 540, p95Delta: +60,
    infra: { api: "ok", db: "warning", redis: "ok", queue: "ok" },
    topIncident: { code: "error rate elevado", path: "TypeError plan undefined", count: 89, users: 41, sev: "warning" },
    envs: [
      { name: "production", status: "warning", incidents: 0, errorRate: 0.64, events: "0.6M", note: "error rate +21pp" },
      { name: "staging",    status: "ok",       incidents: 0, errorRate: 0.11, events: "110K", note: "estável" }
    ]
  },
  {
    id: "prj_mkt", name: "Marketing Site", code: "mkt",
    status: "ok",
    incidents: 0, alerts: 0,
    errorRate: 0.03, errorRateDelta: 0,
    errorTrend: [1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1],
    events: "0.18M", eventsRaw: 180000,
    users: "612", tenants: 1,
    llmCost: 0, llmDelta: 0,
    p95: 124, p95Delta: -4,
    infra: { api: "ok", db: "ok", redis: "ok", queue: "ok" },
    topIncident: null,
    envs: [
      { name: "production", status: "ok", incidents: 0, errorRate: 0.03, events: "180K", note: "baixo volume" }
    ]
  }
];

// roll-up across all projects
const fleetRollup = () => {
  const counts = { ok: 0, warning: 0, critical: 0 };
  PROJECTS.forEach(p => counts[p.status]++);
  const incidents = PROJECTS.reduce((s, p) => s + p.incidents, 0);
  const alerts = PROJECTS.reduce((s, p) => s + p.alerts, 0);
  const llmCost = PROJECTS.reduce((s, p) => s + p.llmCost, 0);
  const overall = counts.critical > 0 ? "critical" : counts.warning > 0 ? "warning" : "ok";
  return { counts, incidents, alerts, llmCost, overall, total: PROJECTS.length };
};

const projectById = id => PROJECTS.find(p => p.id === id) || PROJECTS[0];

const INFRA_LABELS = { api: "API", db: "Postgres", redis: "Redis", queue: "Queue" };
const INFRA_ICONS = { api: "server", db: "db", redis: "redis", queue: "queue" };

Object.assign(window, { PROJECTS, fleetRollup, projectById, INFRA_LABELS, INFRA_ICONS });
