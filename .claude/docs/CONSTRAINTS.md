# Constraints

- Phase 1 is self-hosted and single-installation oriented.
- Projects and environments are the telemetry boundaries.
- Ingestion API keys are scoped to exactly one project and one environment.
- Human sessions are required for query routes.
- Admin routes require an admin human session.
- API keys are only shown once at creation time; persisted records keep a prefix and hash.
- Worker sanitization runs before telemetry persistence.
- The API must not return ingestion success unless the queue accepts the job.
- `SESSION_SECRET`, `API_KEY_PEPPER`, and `BOOTSTRAP_ADMIN_PASSWORD` must be at least 32 characters outside tests.
- Google OAuth is optional and inert unless all required OAuth variables are configured.
- Logs, ClickHouse, object storage, dashboards, SDKs, SaaS workspaces, billing, invites, and full RBAC are out of scope for Phase 1.
- Root-level `SECRETS.md` is ignored and must not be committed.
- `.claude/docs/SECRETS.md` may be committed only with sanitized variable names, descriptions, and example-safe values.
