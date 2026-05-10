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
- Google OAuth is optional. It can authenticate existing, unarchived local users with verified Google email addresses, but it is not open signup.
- Logs, ClickHouse, product object storage, SaaS workspaces, billing, invites, and full RBAC remain outside the current self-hosted MVP scope.
- The JavaScript SDK is the only implemented SDK; additional SDKs are deferred.
- Root-level `SECRETS.md` is ignored and must not be committed.
- `.claude/docs/SECRETS.md` may be committed only with sanitized variable names, descriptions, and example-safe values.
- Docker Compose is the only supported production install path; Kubernetes, Helm, and systemd are deferred.
