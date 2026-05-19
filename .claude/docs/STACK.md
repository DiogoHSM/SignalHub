# Stack

## Runtime

- Node.js 22.x release baseline. Newer Node.js versions may work for local drills, but 22.x is the supported target.
- pnpm 9.15.x workspaces.
- TypeScript with native ESM.

## API

- Fastify 5.
- Zod for payload and configuration validation.
- `@fastify/cookie` for signed human session transport.
- `@fastify/multipart` for admin source-map artifact uploads.
- `@jridgewell/trace-mapping` and `fflate` for source-map frame resolution and ZIP bundle extraction.
- Optional Google OAuth uses Google authorization-code flow through Node `fetch` and links only existing local users.

## Data and Queue

- Postgres 16 for operational and typed telemetry storage.
- Kysely for SQL access.
- Redis 7 for queue backing.
- BullMQ for durable ingestion queueing.

## Security Libraries

- Argon2 for password hashing.
- HMAC session signing through Node `crypto`.
- API key generation and verification in `@sigmon/telemetry`.

## Package Layout

- `apps/api`: Fastify application, routes, startup wiring.
- `apps/worker`: telemetry worker process.
- `packages/cli`: Node-based SignalMonitor CLI, currently focused on source-map CI uploads.
- `packages/sdk`: TypeScript SDK for sending telemetry to the existing ingestion API.
- The JavaScript SDK exports manual breadcrumb capture through `client.breadcrumb` and optional browser breadcrumb helpers.
- `packages/config`: environment parsing and validation.
- `packages/db`: Kysely client, schema, migrations, repositories.
- `packages/queues`: BullMQ queue creation and enqueue helpers.
- `packages/telemetry`: ingestion schemas, auth helpers, API key helpers, ids, sanitization.

## CI

- GitHub Actions runs pull request and `main` branch checks on `ubuntu-latest`.
- CI uses Node.js 22, Corepack, pnpm 9.15.4, Docker Compose, Vitest, and the repo-native `pnpm smoke:compose` runner.

## Commands

- `pnpm dev:api`: start API in development mode.
- `pnpm dev:worker`: start worker in development mode.
- `pnpm start:api`: start API without the development watcher.
- `pnpm start:worker`: start worker without the development watcher.
- `pnpm db:migrate`: run database migrations.
- `pnpm seed:admin`: seed bootstrap admin.
- `pnpm source-maps:upload`: upload source-map artifacts from CI using a source-map upload token.
- `pnpm smoke:compose`: run the local-first Docker Compose release smoke harness.
- `pnpm test`: run Vitest.
- `pnpm build`: build all workspace packages.

## Console Stack

- Vite + React + TypeScript for `apps/console`.
- Testing Library + jsdom for browser component tests.
- `@fastify/static` for production console asset delivery from the API.
