# Decisions

## 2026-05-24: Deploy only application services from GitHub Actions

Decision: GitHub Actions may trigger EasyPanel deploy hooks for the repository-built `api`, `worker`, and optional split `scheduler` services after the `main` CI gates pass. Postgres and Redis are excluded from repository-triggered deploy hooks.

Rationale: API, worker, and scheduler are stateless application services that should roll forward with repository builds. Postgres and Redis are stateful template services; redeploying them from GitHub would add unnecessary operational risk and does not correspond to a code build.

## 2026-05-19: Use SignalMonitor as the product identity

Decision: SignalMonitor is the current product identity. The project was formerly developed as SignalHub. The intended public website/domain is `sigmon.app`, and the intended deployed application host is `my.sigmon.app`.

Rationale: The Phase 6E rename gives the product a clearer monitoring-focused identity while preserving explicit historical context where useful. MicroERP remains Diogo's personal project and first real validation target, not part of the SignalMonitor product or repository.

## 2026-05-10: Store source maps locally and resolve stacks on demand

Decision: SignalMonitor supports source-map artifacts as a local-first admin workflow. The API stores uploaded `.map` files under `SOURCE_MAPS_LOCAL_DIR`, stores artifact metadata and cached resolved frames in Postgres, and resolves raw error stacks on demand.

Rationale: Self-hosted operators need production stack resolution without introducing SaaS dependencies or object storage as a first requirement. Strict project, environment, release, and minified-file matching avoids unsafe guessing. The console shows resolved frame metadata but not original source code or `sourcesContent`.

## 2026-05-10: Store grouped error workflow separately from raw occurrences

Decision: SignalMonitor adds an `error_groups` table for operational error triage while preserving immutable raw `errors` records linked by `error_group_id`.

Rationale: Operators need issue-level counts, status, regression, and prioritization without losing audit/debug access to every raw occurrence. Keeping the mutable workflow on groups avoids mutating individual occurrence history and keeps self-hosted storage simple.

## 2026-05-10: Add read-only operator diagnostics before release automation

Decision: SignalMonitor adds a read-only operator doctor command before introducing broader release automation.

Rationale: Phase 4D needs a repeatable install and release baseline that can identify configuration, placeholder secret, Compose, and health issues without mutating operator data or exposing secrets.

## 2026-05-02: Phase 2 SDK sends one request per signal

Decision: The first JavaScript SDK targets the existing single-signal ingestion endpoints and does not add batch ingestion.

Rationale: This keeps Phase 2 installable and compatible with the completed self-hosted core. Buffered client flush and bounded retries improve product integration without changing backend storage or queue contracts.

## Phase 1 Runtime Shape

Use Fastify API, Redis/BullMQ queueing, a worker process, and Postgres as the source of truth for Phase 1.

Rationale: this produces an installable telemetry foundation without adding ClickHouse, object storage, or SaaS platform complexity before the core ingestion contract is proven.

## API Keys

Ingestion uses bearer API keys scoped to one project and one environment. API keys are stored hashed and only the prefix is retained for lookup and operator identification.

Rationale: clients should not choose project or environment scope on each request, and leaked database records should not reveal usable ingestion secrets.

## Human Access

Use a bootstrap admin seed plus local email/password login for Phase 1. Admins manage installation resources; authenticated humans can query telemetry.

Rationale: the product needs real operator access but not a SaaS organization model or enterprise identity matrix yet.

## Sanitization Boundary

The worker recursively sanitizes sensitive values before typed persistence.

Rationale: queued ingestion payloads are accepted quickly, while persistence remains responsible for ensuring stored telemetry is safe for operator querying.

## Compose as Primary Install Path

Docker Compose is the supported production-oriented self-hosted installation path for this release line.

Rationale: the stack has only API, worker, Postgres, and Redis, and Compose gives operators a reproducible local/self-hosted deployment without extra infrastructure. Kubernetes, Helm, and systemd are deferred.
