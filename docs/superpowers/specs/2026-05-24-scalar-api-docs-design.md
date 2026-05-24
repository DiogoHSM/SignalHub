# Scalar API Docs Design

## Goal

Expose a beautiful public API reference for SignalMonitor using Scalar, so integrators can discover the ingestion API, required authentication, request shapes, and operational endpoints from the deployed app itself.

The production target is:

- `GET /docs`: public Scalar API Reference HTML.
- `GET /openapi.json`: public OpenAPI 3.1 document.

The docs are public. Endpoint security remains unchanged: ingestion still requires scoped API keys, source-map upload still requires source-map upload tokens, and admin/query/system routes still require human session authentication.

## Scope

This slice adds the first maintained OpenAPI reference for the current API surface. It prioritizes accurate integration docs over complete internal route generation.

The OpenAPI document covers:

- Health and readiness: `/health`, `/ready`.
- Public ingestion: `/v1/events`, `/v1/errors`, `/v1/breadcrumbs`, `/v1/llm`, `/v1/traces`, `/v1/spans`.
- Source-map CI upload: `/v1/source-maps`.
- Auth/admin/query/system route groups summarized with their session-auth requirement, enough to orient operators and future doc expansion.

The docs include security schemes for:

- Bearer ingestion API keys for telemetry ingestion.
- Bearer source-map upload tokens for source-map CI uploads.
- Session cookies for admin/query/system routes.

## Non-Goals

- Do not convert every Fastify route to schema-driven OpenAPI generation in this slice.
- Do not expose secrets, example real API keys, or deployment environment values.
- Do not weaken route auth or make admin/query APIs public.
- Do not build a separate marketing documentation site.
- Do not document deferred product features as available.

## Architecture

Add a small docs module under `apps/api/src` that exports an OpenAPI 3.1 document object. Keep the document close to API code, versioned with the service, and covered by tests.

Register two public routes in `buildApp`:

- `/openapi.json` returns the OpenAPI JSON document.
- `/docs` serves a Scalar-powered HTML page that loads `/openapi.json`.

Prefer the official Scalar API Reference package if it integrates cleanly with Fastify and the current ESM build. If that adds unnecessary complexity, serve a minimal HTML shell using Scalar's browser bundle. The route must be deterministic, self-contained enough for tests, and safe behind EasyPanel.

## User Experience

Operators and integrators can open:

```text
https://my.sigmon.app/docs
```

They see a modern API reference with endpoint groups, request/response examples, and authentication requirements. The docs should make the browser-vs-server SDK split visible through examples or descriptions:

- Browser apps use `@sigmon/sdk/browser` and scoped browser ingestion keys.
- Server apps use `@sigmon/sdk/node` and secret server-side ingestion keys.
- Raw HTTP examples use `Authorization: Bearer sh_...`.

## Testing

Add focused API tests that assert:

- `GET /openapi.json` returns JSON with `openapi: "3.1.0"`.
- The spec includes the key ingestion paths and security schemes.
- `GET /docs` returns HTML and references the OpenAPI route.
- Existing health and security-header behavior remains intact for docs routes.

Run the API-focused tests and TypeScript lint/build for the API package. Before handoff, run the repo's normal verification slice appropriate for a documentation/API route change.

## Documentation

Update README and deployment docs to mention:

- Public API docs are available at `/docs`.
- The raw OpenAPI document is available at `/openapi.json`.
- Deployed EasyPanel instances can use `https://my.sigmon.app/docs` as the integration reference.
