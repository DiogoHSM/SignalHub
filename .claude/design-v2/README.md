# Console v2 — design source reference

High-fidelity design handoff for the **SignalMonitor Console v2 — dark redesign** epic
(Linear project [`SignalMonitor Console v2 — dark redesign`](https://linear.app/data4ward/project/signalmonitor-console-v2-dark-redesign-d974e381fc64), PER-342…358).

## Authoritative source

Claude Design project: **`019de713-879f-726c-9f57-2fc4220947a3`** (name "SignalHUB"), file
`SignalHub Console v2.html`. Pull fresh with the `DesignSync` tool (`method: get_file`).

The design is a React 18 (Babel-standalone) prototype. We are porting it into the production
console (`apps/console`, React 19 + Vite) at maximum fidelity — **fonts, sizes, spacing, and
especially the hand-rolled SVG charts are deliberate and must be matched**, not approximated.

## File manifest (in the design project)

| File | Contents |
|---|---|
| `tokens.css` | Design tokens: oklch dark palette, green accent, severity colors, fonts (Geist + JetBrains Mono), radii, shadows, base component classes. **Saved locally.** |
| `app-shared.jsx` | Shared primitives: `Icon` (full SVG set), `STATUS`/`sev`, `StatusDot`, `Sparkline`, `Bars`, `MicroSpark`. **Saved locally.** |
| `app-screens-common.jsx` | Screen primitives: `PageHead`, `Segmented`, `SummaryStat`, `Divider`, `StatusPill`, `PriorityPill`, `BigKpi`, `Legend`, `Kv`, `SecretField`, `ConfirmButton`, `EmptyHint`. **Saved locally.** |
| `app-data.jsx` | Mock data shape (`PROJECTS`, `fleetRollup`, `projectById`, infra labels) — reference for the B1 fleet-rollup endpoint contract. |
| `app-shell.jsx` | App shell: `NavRail`, `ProjectSwitcher`, `Breadcrumb`, `TopBar`, `ToastStack` (F2). |
| `app-health-rail.jsx` | `HealthRail` cross-project radar: `FleetBar`, `InfraDots`, `ProjectCard` (F2). |
| `app-screens-a.jsx` | `OverviewScreen` (S1), `ErrorsScreen` (S2), `IncidentScreen` (S3), `KpiGroup`, `RelItem`. |
| `app-screens-b.jsx` | `IncidentsScreen` (S4), `LlmScreen`+`StackedArea` (S5), `TracesScreen` (S6), `TenantScreen` (S7). |
| `app-screens-c.jsx` | `AlertsScreen`+`FiresTimeline`+`Suggestion` (S8), `SystemScreen` (S9), `SetupScreen` (S10). |
| `SignalHub Console v2.html` | Entry: shell CSS, nav→component map, `App` root, routing/drill/persistence wiring. |

## Convention

When speccing a sub-project, pull its source file(s) fresh from DesignSync and save them here
(same filenames) so the implementer can `Read` them directly. `tokens.css`, `app-shared.jsx`,
and `app-screens-common.jsx` are already saved (needed by F1).
