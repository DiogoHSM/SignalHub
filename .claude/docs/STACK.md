# Stack

## Runtime

- Node.js 22.
- pnpm 9.15.x workspaces.
- TypeScript with native ESM.

## API

- Fastify 5.
- Zod for payload and configuration validation.
- `@fastify/cookie` for signed human session transport.
- Google OAuth configuration keys are reserved for future support; Phase 1 auth is local email/password only.

## Data and Queue

- Postgres 16 for operational and typed telemetry storage.
- Kysely for SQL access.
- Redis 7 for queue backing.
- BullMQ for durable ingestion queueing.

## Security Libraries

- Argon2 for password hashing.
- HMAC session signing through Node `crypto`.
- API key generation and verification in `@signal-hub/telemetry`.

## Package Layout

- `apps/api`: Fastify application, routes, startup wiring.
- `apps/worker`: telemetry worker process.
- `packages/config`: environment parsing and validation.
- `packages/db`: Kysely client, schema, migrations, repositories.
- `packages/queues`: BullMQ queue creation and enqueue helpers.
- `packages/telemetry`: ingestion schemas, auth helpers, API key helpers, ids, sanitization.

## Commands

- `pnpm dev:api`: start API in development mode.
- `pnpm dev:worker`: start worker in development mode.
- `pnpm db:migrate`: run database migrations.
- `pnpm seed:admin`: seed bootstrap admin.
- `pnpm test`: run Vitest.
- `pnpm build`: build all workspace packages.
