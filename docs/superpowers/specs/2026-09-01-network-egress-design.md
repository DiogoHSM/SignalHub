# Rate Limiting, Proxy Identity, and Outbound Security Design

**Linear:** PER-507, PER-508

## Goal

Bound unauthenticated database work, derive client identity only from explicitly trusted proxies, and apply one transport, destination, DNS, and deadline policy to privileged outbound integrations.

## Non-goals

- Operating a WAF.
- Permitting arbitrary private-network egress by default.
- Supporting unverified TLS.
- Replacing Fastify or the job scheduler.

## Early request limiting and CORS

Register the global request limiter before the asynchronous browser-origin lookup. The limiter runs for `OPTIONS` and ordinary browser-ingestion requests, so a disallowed or allowed origin cannot create unbounded database work. Static configured origins remain an in-memory set. Database origins use a short bounded cache with explicit invalidation after admin origin changes; the database keeps its indexed normalized origin lookup.

Login-specific controls remain stricter than the global limit and are not replaced by it.

## Trusted proxy identity

Add `TRUSTED_PROXY_CIDRS`, default empty. Parse it as an explicit comma-separated list of IPs/CIDRs and pass that list to Fastify's `trustProxy`. Boolean `true`, an arbitrary hop count, and trust-all CIDRs are rejected in production. Direct requests ignore forwarded headers. Requests whose immediate peer matches the allowlist may derive the client from the forwarded chain according to Fastify's documented right-to-left trust algorithm.

Compose does not guess a proxy network. Self-hosting documentation shows how to obtain the exact reverse-proxy address or CIDR and warns that an overly broad range permits identity spoofing.

## Shared outbound policy

`packages/config` exposes one policy used by webhook alerts, HTTP monitors, warehouse exports, and S3-compatible backups. It validates at configuration time and again immediately before connection.

The destination classifier rejects loopback, unspecified, private, link-local, carrier-grade NAT, documentation, benchmarking, multicast, reserved, and non-routable IPv4/IPv6 ranges, including embedded IPv4 forms. DNS answers are checked through the connector's actual lookup callback, not through a separate preflight resolution, closing DNS-rebinding and validation-to-use gaps. Redirects are either disabled or each target is revalidated with the same policy.

Development may opt into loopback only with `ALLOW_LOOPBACK_OUTBOUND=true` outside production. Private ranges require explicit destination CIDRs in `OUTBOUND_PRIVATE_CIDRS`; there is no broad private-network switch.

## Transport rules

- Webhooks carrying a configured secret header require HTTPS, except the explicit non-production loopback case.
- S3-compatible backup endpoints require HTTPS under the same exception.
- Warehouse URLs accept only PostgreSQL schemes, reject URL user-info leakage in logs, require verified TLS outside the development loopback exception, and reject TLS-disable query parameters.
- Errors expose a stable category without echoing full URLs or credentials.

## Deadlines

Every integration has connection and total-operation deadlines. Warehouse exports additionally set PostgreSQL `statement_timeout`, `lock_timeout`, and per-destination scheduler time budgets. Timeout aborts close sockets/pools and allow the scheduler to continue with the next destination. Existing alert and monitor timeout configuration is routed through the shared helper.

## Acceptance criteria

- CORS probes are rate-limited before any async origin lookup.
- Direct and trusted-proxy requests receive correct, spoof-resistant identities.
- Every reserved-address representation is rejected at the actual connection lookup.
- Secret-bearing HTTP and object-storage requests cannot use plaintext transport in production.
- Warehouse connections require PostgreSQL plus verified TLS and cannot block the scheduler indefinitely.
- Documented loopback development remains functional.

## Verification

Add config parser tests, direct/trusted/untrusted proxy API tests, CORS lookup-count tests, address-table and DNS-rebinding tests, redirect tests, webhook/monitor/warehouse/backup transport tests, timeout cleanup tests, and ordinary public HTTPS controls. Use local fake servers only for explicitly enabled non-production loopback tests.
