# Rate Limiting, Proxy Identity, and Outbound Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate-limit unauthenticated CORS work, derive client IP only from trusted proxies, and enforce one destination/transport/deadline policy at every privileged outbound connection.

**Architecture:** Configure Fastify proxy trust before instance creation, register a patched global `onRequest` limiter before the CORS lookup, and centralize outbound validation plus a custom DNS lookup that validates the exact address used by the socket. Route webhook, monitor, warehouse, and backup clients through the policy.

**Tech Stack:** TypeScript, Fastify 5, `@fastify/rate-limit` 11.2+, ioredis, Node `http`/`https`/`dns`, node-postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-network-egress-design.md`

## Global Constraints

- `TRUSTED_PROXY_CIDRS` defaults empty; production rejects trust-all, booleans, and hop counts.
- Use `@fastify/rate-limit` 11.2 or newer so default IP keys canonicalize IPv6 and mask the configured subnet.
- CORS origin lookup occurs only after the global `onRequest` limit.
- The actual socket lookup validates every resolved address; a separate DNS preflight is insufficient.
- Secret-bearing webhooks/backups and production warehouses require verified TLS.
- Loopback is allowed only outside production with `ALLOW_LOOPBACK_OUTBOUND=true`; private ranges require explicit CIDRs.

---

### Task 1: Trusted proxy configuration and patched IP normalization

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/security-headers.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `config.trustedProxyCidrs: string[]`; `BuildAppOptions.trustProxy`; Fastify receives the CIDR array before construction.
- Consumes: `request.ip` in global/login limiters.

- [ ] **Step 1: Write failing config and request-IP tests**

```ts
expect(loadConfig({ ...baseEnv(), TRUSTED_PROXY_CIDRS: "10.0.0.4/32,fd00::4/128" }).trustedProxyCidrs)
  .toEqual(["10.0.0.4/32", "fd00::4/128"]);
expect(() => loadConfig({ ...prodEnv(), TRUSTED_PROXY_CIDRS: "0.0.0.0/0" })).toThrow("trusted_proxy_too_broad");
```

API tests prove an untrusted peer cannot set `X-Forwarded-For`, while an explicitly trusted injected peer resolves the rightmost untrusted client.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/config/test/config.test.ts apps/api/test/security-headers.test.ts`

Expected: FAIL because the config/Fastify option does not exist.

- [ ] **Step 3: Upgrade and configure**

Run: `pnpm add @fastify/rate-limit@^11.2.0`

Parse and validate literal IP/CIDR entries; reject `true`, numeric hops, `0.0.0.0/0`, and `::/0` in production. Set `fastifyOptions.trustProxy = options.trustProxy` only when the array is non-empty. Keep the limiter's default normalized IP key generator with `ipv6Subnet: 64`.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run packages/config/test/config.test.ts apps/api/test/security-headers.test.ts`

```bash
git add package.json pnpm-lock.yaml packages/config/src/index.ts packages/config/test/config.test.ts apps/api/src/app.ts apps/api/test/security-headers.test.ts .env.example
git commit -m "fix(api): trust only configured proxy cidrs"
```

### Task 2: Rate-limit before database-backed CORS

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/test/e2e.test.ts`
- Modify: `apps/api/test/security-headers.test.ts`
- Modify: `packages/db/src/repositories/admin.ts`
- Modify: `packages/db/test/repositories.test.ts`

**Interfaces:**
- Produces: early global limiter and `BrowserOriginCache` with `get`, `allow`, `invalidate`.
- Consumes: normalized `request.ip`, static origin set, indexed DB lookup.

- [ ] **Step 1: Write a failing lookup-count test**

```ts
it("returns 429 before an OPTIONS probe performs another origin lookup", async () => {
  for (let index = 0; index < 2; index += 1) await preflight(app, "https://allowed.test");
  const blocked = await preflight(app, "https://allowed.test");
  expect(blocked.statusCode).toBe(429);
  expect(isBrowserCorsOriginAllowed).toHaveBeenCalledTimes(2);
});
```

Use a tiny injected limiter in the test. Add cache hit/expiry/invalidation tests and a repository plan assertion for the normalized active-origin index.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/api/test/e2e.test.ts apps/api/test/security-headers.test.ts packages/db/test/repositories.test.ts`

Expected: lookup count increases before the limiter can reject.

- [ ] **Step 3: Reorder registration and add cache**

Register rate-limit with global `onRequest`, Redis, `skipOnError: false`, and the current defaults before adding the browser-origin `onRequest` hook. Cache positive and negative DB results for 60 seconds, cap at 1,000 entries, and invalidate after create/archive origin calls.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run apps/api/test/e2e.test.ts apps/api/test/security-headers.test.ts packages/db/test/repositories.test.ts`

```bash
git add apps/api/src/app.ts apps/api/test/e2e.test.ts apps/api/test/security-headers.test.ts packages/db/src/repositories/admin.ts packages/db/test/repositories.test.ts
git commit -m "fix(api): limit requests before cors lookup"
```

### Task 3: Shared destination policy and socket lookup

**Files:**
- Rewrite: `packages/config/src/network-security.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Create: `packages/config/test/network-security.test.ts`
- Create: `packages/config/src/safe-lookup.ts`
- Create: `packages/config/test/safe-lookup.test.ts`

**Interfaces:**
- Produces: `OutboundPolicy`, `classifyAddress`, `validateOutboundUrl`, and `createSafeLookup(policy, lookup)` with Node's lookup callback signature.
- Consumes: environment, loopback flag, explicit private CIDRs, protocol requirements.

- [ ] **Step 1: Write failing address-table and rebinding tests**

```ts
it.each(["0.0.0.0", "100.64.0.1", "192.0.2.1", "198.18.0.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "2001:db8::1"])
  ("rejects non-global address %s", (address) => expect(() => policy.assertAddress(address)).toThrow("outbound_address_forbidden"));

it("rejects a private address returned by the socket lookup", async () => {
  const safeLookup = createSafeLookup(policy, (_host, _opts, cb) => cb(null, "127.0.0.1", 4));
  await expect(invokeLookup(safeLookup, "public.example")).rejects.toThrow("outbound_address_forbidden");
});
```

Include IPv4-mapped, NAT64, 6to4, malformed numeric, explicit allowlisted private CIDR, and development loopback controls.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/config/test/network-security.test.ts packages/config/test/safe-lookup.test.ts`

Expected: current manual classifier misses reserved classes and lacks socket lookup enforcement.

- [ ] **Step 3: Implement exact lookup validation**

Use `dns.lookup(host, { all: true, verbatim: true })`, validate every returned address, and return only validated results to the socket callback. Literal hosts pass through the same classifier. `validateOutboundUrl` rejects credentials and unsupported protocols before lookup. Export the policy and lookup helpers from `packages/config/src/index.ts` so consumers use the `@sigmon/config` package boundary.

- [ ] **Step 4: Verify GREEN and commit**

Run: `pnpm vitest run packages/config/test/network-security.test.ts packages/config/test/safe-lookup.test.ts packages/config/test/config.test.ts`

```bash
git add packages/config/src/network-security.ts packages/config/src/safe-lookup.ts packages/config/src/index.ts packages/config/test/network-security.test.ts packages/config/test/safe-lookup.test.ts packages/config/test/config.test.ts
git commit -m "fix(network): validate actual outbound socket targets"
```

### Task 4: Apply transport policy to HTTP integrations

**Files:**
- Create: `packages/config/src/safe-http-client.ts`
- Create: `packages/config/test/safe-http-client.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `apps/worker/src/alerts.ts`
- Modify: `apps/worker/test/telemetry-worker.test.ts`
- Modify: `apps/worker/src/monitors.ts`
- Modify: `apps/worker/src/backups.ts`
- Modify: `apps/worker/test/backups.test.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/test/admin.test.ts`

**Interfaces:**
- Consumes: Task 3 policy/lookup.
- Produces: `safeHttpRequest({ url, method, headers, body, timeoutMs, policy, redirectLimit })`.

- [ ] **Step 1: Write failing HTTP controls**

Test plaintext secret-header webhook rejection, plaintext S3 endpoint rejection, a redirect to loopback, a lookup that changes to private, timeout abort/cleanup, ordinary public HTTPS, and explicit dev loopback.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run packages/config/test/safe-http-client.test.ts apps/worker/test/telemetry-worker.test.ts apps/worker/test/backups.test.ts`

Expected: at least plaintext or redirect/rebinding cases reach the request path.

- [ ] **Step 3: Implement with Node HTTP(S)**

Build requests with `node:http`/`node:https`, pass `lookup: createSafeLookup(...)`, verified TLS defaults, an `AbortSignal.timeout(timeoutMs)`, response-size limits, and redirect revalidation on every hop. Never include the full URL in thrown messages. Export the client from `packages/config/src/index.ts`; API and worker import it from `@sigmon/config`.

- [ ] **Step 4: Replace integration fetch paths and verify**

Run: `pnpm vitest run packages/config/test/safe-http-client.test.ts apps/worker/test/telemetry-worker.test.ts apps/worker/test/backups.test.ts apps/api/test/admin.test.ts`

Expected: all malicious and legitimate controls PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/config/src/safe-http-client.ts packages/config/test/safe-http-client.test.ts packages/config/src/index.ts apps/worker/src/alerts.ts apps/worker/src/monitors.ts apps/worker/test/telemetry-worker.test.ts apps/worker/src/backups.ts apps/worker/test/backups.test.ts apps/api/src/routes/admin.ts apps/api/test/admin.test.ts
git commit -m "fix(network): secure privileged http integrations"
```

### Task 5: Warehouse TLS and deadlines

**Files:**
- Modify: `apps/worker/src/warehouse-exports.ts`
- Modify: `apps/worker/test/warehouse-exports.test.ts`
- Modify: `packages/config/src/index.ts`
- Modify: `packages/config/test/config.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: Task 3 safe lookup and policy.
- Produces: validated PostgreSQL client config with connection, statement, lock, and total destination deadlines.

- [ ] **Step 1: Write failing warehouse tests**

Reject non-PostgreSQL schemes, `sslmode=disable`, private lookup, and unverified TLS. Test a hanging query aborts, closes its client, and the next destination runs.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/worker/test/warehouse-exports.test.ts`

Expected: current `new Client({ connectionString })` accepts the unsafe cases or hangs.

- [ ] **Step 3: Build explicit client config**

Parse the URL, supply host/port/database/user/password separately, use the safe lookup, set `ssl: { rejectUnauthorized: true, servername: hostname }`, `connectionTimeoutMillis`, and run `set statement_timeout`/`set lock_timeout` on connect. Wrap one destination in an abortable total deadline and always `end()` in `finally`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm vitest run apps/worker/test/warehouse-exports.test.ts packages/config/test/config.test.ts`

```bash
git add apps/worker/src/warehouse-exports.ts apps/worker/test/warehouse-exports.test.ts packages/config/src/index.ts packages/config/test/config.test.ts .env.example
git commit -m "fix(warehouse): require verified tls and deadlines"
```

### Task 6: Documentation and slice verification

**Files:**
- Modify: `docs/SELF-HOSTING.md`
- Modify: `README.md`
- Modify: `.claude/docs/SECRETS.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: safe proxy/CIDR/loopback/TLS deployment guidance and PER-507/PER-508 evidence.

- [ ] **Step 1: Document exact deployment contracts**

Include conservative empty proxy defaults, how to identify one proxy CIDR, explicit private destination allowlists, loopback development only, and warehouse/webhook/S3 TLS requirements.

- [ ] **Step 2: Run focused malicious and ordinary controls**

Run: `pnpm vitest run packages/config/test apps/api/test/security-headers.test.ts apps/api/test/e2e.test.ts apps/api/test/admin.test.ts apps/worker/test/telemetry-worker.test.ts apps/worker/test/backups.test.ts apps/worker/test/warehouse-exports.test.ts`

Expected: PASS for CORS-before-DB, spoofed/trusted IPs, address encodings, DNS changes, redirects, TLS, deadlines, and public HTTPS/dev loopback controls.

- [ ] **Step 3: Run builds and commit**

Run: `pnpm --filter @sigmon/config build`

Run: `pnpm --filter @sigmon/api build`

Run: `pnpm --filter @sigmon/worker build`

```bash
git add docs/SELF-HOSTING.md README.md .claude/docs/SECRETS.md
git commit -m "docs(network): define proxy and egress policy"
```
