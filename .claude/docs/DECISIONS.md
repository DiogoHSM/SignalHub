# Decisions

## 2026-05-10: Add read-only operator diagnostics before release automation

Decision: SignalHub adds a read-only operator doctor command before introducing broader release automation.

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
