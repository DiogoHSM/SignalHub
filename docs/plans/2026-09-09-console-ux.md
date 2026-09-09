# Console UX implementation

## Goal and approved direction
Implement the complete September 9 visual review, retain dense operational tables and the existing dark identity, then deploy the verified commit to the hosted Coolify instance.

## Flows and acceptance
- The left navigation has visible grouped labels and persisted open, compact and automatic modes. Automatic reveals on hover/focus without reflow. Keyboard users can identify active destination; narrow screens retain a usable drawer/status experience.
- One project/environment selector owns project scope. Global instance health and administration show instance context and no misleading project selector/radar. Fleet radar remains clearly global and optional.
- Incidents badge counts active incidents for selected project/environment, never critical projects. Loading/error cannot imply zero.
- Settings is ongoing project configuration, organized by task; SDK onboarding has its own installation destination. Global project lifecycle and console access live in administration. Existing management capabilities, secret scoping and deep links remain usable.
- Navigation groups: Overview; Operate (Incidents, Monitors, Alert rules); Investigate (Errors, Events, Traces, AI calls); Understand (Analytics, Users, Accounts/tenants, Experiments); Configure (Project settings, Installation & SDK); Instance (Sigmon health, Administration).
- Category accents affect navigation/context only; semantic severity and action colors stay stable. Settings uses a gear. Search copy reflects section navigation; keyboard shortcut reflects platform.
- Overview distinguishes missing, insufficient, stale and usable telemetry. No healthy baseline or probability claims without evidence. Data freshness/coverage precedes operational verdicts.
- Findings lead with situation, scope/impact and next action; advanced model/payload details use disclosure. Preserve dense tables and filters. Correct historical incident headings, empty comparisons, setup empty states, and local retry actions where needed.

## Contracts and constraints
Prefer existing APIs and routes, additive navigation destinations only. No database migration intended. Derive status from actual scoped counts/freshness and expose unknown when unavailable. Preserve one-time credential ownership, form protections, unsaved user work, existing external URLs, and read/write authorization. No fabricated insights or statistical claims.

## Verification and rollout
Regression tests for scope, navigation persistence/focus, configuration routing, telemetry state and badge semantics. Console lint/build and relevant API/SDK tests; full console suite. Browser inspect desktop and narrow viewport, correct discovered defects, confirm bounded second pass. Commit reviewed files only, merge via normal repository workflow after CI, deploy Coolify applications as needed, inspect deployment status and production /health commit, verify live UX. Inspect Docker resources if Docker-backed work occurs; remove only proven unused owned resources, never volumes or active artifacts.
