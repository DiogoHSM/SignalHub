# Integration Console Design

Date: 2026-05-02

## Goal

Build the first operator-facing web console for SignalHub as an admin-only setup workspace. The console should make a self-hosted installation usable for multiple projects without requiring manual API calls or direct database edits.

This is the first slice of the broader Operational Console in `PRD.md`. It intentionally prioritizes project setup, environment setup, API key lifecycle, integration snippets, and a lightweight connection check before full dashboards.

## Non-Goals

- No public SaaS flow.
- No organization, billing, workspace, or role model.
- No Clerk or external auth vendor.
- No full analytics dashboard in this slice.
- No regular-user console access in this slice.
- No API key secret recovery after creation.

## User Model

The first console is admin-only.

The existing simple administration model remains:

- One or more admin users can access the console.
- Additional non-admin users may exist in the system, but they cannot access this first console surface.
- API key creation and revocation stay behind admin authorization.

This keeps secret-handling and project configuration safe while the self-hosted product is still early.

## Recommended Product Shape

The first screen should be the actual Integration Console, not a landing page or marketing surface.

The layout should be a dense operational workspace:

- Left project list for switching between monitored projects.
- Main project detail area with environment selection.
- API key panel for listing active/revoked keys, creating keys, and revoking keys.
- Snippet panel with generated examples for the selected project, environment, and API key context.
- Connection check panel showing whether telemetry is arriving for the selected project/environment.
- Secondary admin entry for simple user administration.

The console should feel like infrastructure software: quiet, compact, predictable, and optimized for repeated setup work.

## Primary Workflows

### Sign In

Admins sign in with the existing session-based auth flow.

The console should call `GET /auth/me` on load:

- If unauthenticated, show the login form.
- If authenticated and admin, show the console.
- If authenticated but not admin, show an access-denied state.

Google sign-in can remain supported only if the existing API configuration enables it, but it is not required for this slice.

### Manage Projects

Admins can:

- List active projects.
- Create a project.
- Rename a project.
- Archive a project.
- Select a project as the active console context.

This maps to the existing admin project routes:

- `GET /admin/projects`
- `POST /admin/projects`
- `GET /admin/projects/:id`
- `PATCH /admin/projects/:id`
- `DELETE /admin/projects/:id`

### Manage Environments

Within a selected project, admins can:

- List environments.
- Create environments such as `Production`, `Staging`, and `Development`.
- Rename an environment.
- Archive an environment.
- Select the active environment for snippets and connection checks.

This maps to:

- `GET /admin/projects/:projectId/environments`
- `POST /admin/projects/:projectId/environments`
- `PATCH /admin/environments/:id`
- `DELETE /admin/environments/:id`

### Manage API Keys

Within a selected project, admins can:

- List API keys without hashes or secrets.
- Create an API key for a selected environment.
- Copy the one-time secret immediately after creation.
- Revoke an API key.

The UI must make the one-time nature of the secret explicit. After the create dialog is closed, the key secret is no longer recoverable.

This maps to:

- `GET /admin/projects/:projectId/api-keys`
- `POST /admin/projects/:projectId/api-keys`
- `DELETE /admin/api-keys/:id`

### Copy Integration Snippets

The console should generate snippets from the currently selected project/environment. Snippets should cover:

- `@signal-hub/sdk`
- Raw HTTP ingestion
- Environment variable examples for self-hosted deployments

The snippet panel should avoid storing secrets in browser storage. If a key has just been created, the one-time secret can be interpolated into snippets while the modal/session state is still alive. Otherwise, snippets should show an explicit placeholder such as `SIGNAL_HUB_API_KEY`.

### Check Connection

The console should provide a lightweight read-only check for the selected project/environment:

- Last event arrival status if data exists.
- Small counts for events/errors in the last 24 hours when query repositories are available.
- Clear empty state when no telemetry has arrived yet.
- Clear unavailable state when query methods are not configured.

This should use existing authenticated query routes where possible:

- `GET /query/events`
- `GET /query/errors`
- `GET /query/aggregates/events`
- `GET /query/aggregates/errors`

The connection check is not a dashboard. It exists to answer: "Did my integration work?"

## Architecture

Add a small web console application served with the self-hosted install.

Recommended structure:

- `apps/console`: Vite + React + TypeScript browser UI source.
- API serves the built console assets in production.
- Local development runs the API and console as separate dev processes, with the console calling the API through a configured base URL.
- Docker/self-host packaging should expose one operational web entry point.

This is more scalable than embedding a large HTML file directly inside `apps/api`, but still avoids SaaS assumptions and vendor lock-in.

## Frontend Boundaries

The console UI should be split into focused units:

- `AuthGate`: resolves `GET /auth/me` and routes users to login, denied, or console.
- `ApiClient`: typed wrapper around auth, admin, and query endpoints.
- `ProjectSwitcher`: lists, selects, creates, renames, and archives projects.
- `EnvironmentSelector`: lists and manages environments for the active project.
- `ApiKeyPanel`: lists, creates, reveals once, and revokes API keys.
- `SnippetPanel`: renders SDK, HTTP, and environment-variable snippets.
- `ConnectionCheck`: performs the lightweight recent-ingestion check.
- `UserAdminPanel`: simple admin user management using existing user routes.

Each unit should depend on the API client and explicit props, not global mutable state beyond the authenticated session and active project/environment selection.

## Backend Boundaries

The existing API routes are enough for the first console slice.

Small backend additions may be needed for serving assets and making console configuration discoverable:

- Static asset serving for the built console.
- A minimal `GET /console/config` endpoint returning only non-secret browser configuration, such as API base path and whether Google sign-in is enabled.

The design should avoid adding new data tables for this slice.

## Data Flow

1. Browser loads the console.
2. Console asks `GET /auth/me`.
3. Admin user selects or creates a project.
4. Console loads environments and API keys for the selected project.
5. Admin selects or creates an environment.
6. Admin creates an API key for that environment.
7. API returns the one-time secret once.
8. Console displays copy actions and generated snippets.
9. Console checks query endpoints for recent data using the selected project/environment filters.

The selected project/environment can be kept in local browser state for convenience, but API key secrets must not be persisted.

## Error Handling

The console should use direct operational states instead of vague generic failures:

- `401 unauthenticated`: show login.
- `403 admin_required`: show access denied.
- `400 invalid_*`: show validation feedback near the form.
- `404 project_not_found`, `environment_not_found`, or `api_key_scope_not_found`: refresh lists and show stale-selection feedback.
- `501 *_repository_unavailable`: show setup/configuration unavailable state.
- `503 query_unavailable`: show connection check unavailable without blocking setup workflows.

Destructive actions such as archive/revoke require confirmation.

## Security Requirements

- Admin-only access for the first console.
- No API key hashes or secrets shown from list endpoints.
- One-time API key secret display only immediately after creation.
- No API key secret persistence in local storage, session storage, or URLs.
- Use existing session cookies for browser auth.
- Avoid sending credentials to third-party services.
- Keep Google sign-in optional and config-driven if exposed.

## Testing

Backend tests should cover:

- Console asset serving, if added to the API.
- Auth behavior for admin, non-admin, and unauthenticated users.
- Any runtime config endpoint introduced for the console.

Frontend tests should cover:

- Auth gate states.
- Project/environment selection and creation flows.
- API key creation with one-time secret display.
- API key revocation confirmation.
- Snippet generation with and without a freshly created secret.
- Connection check empty, unavailable, and successful states.

End-to-end or browser-level smoke tests should verify:

- Admin can sign in and reach the console.
- Admin can create project, environment, and API key.
- Generated snippets include the selected project/environment and only include the real secret immediately after creation.

## Acceptance Criteria

- A self-hosted admin can operate multiple monitored projects from one installation.
- The first console screen supports project, environment, and API key setup.
- The console generates JS SDK and raw HTTP snippets for the selected context.
- New API key secrets are shown once and never recoverable later.
- Non-admin users cannot access the console.
- The console can show whether telemetry has recently arrived, without becoming a full dashboard.
- The implementation adds no SaaS dependency and no external auth vendor dependency.
