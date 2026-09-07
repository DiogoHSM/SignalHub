# syntax=docker/dockerfile:1.7

FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache postgresql16-client tini curl
RUN addgroup -S sigmon && adduser -S -G sigmon sigmon

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
RUN mkdir -p /app /var/lib/sigmon/backups /var/lib/sigmon/source-maps && chown -R sigmon:sigmon /app /var/lib/sigmon

USER sigmon

COPY --chown=sigmon:sigmon package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=sigmon:sigmon apps/api/package.json ./apps/api/package.json
COPY --chown=sigmon:sigmon apps/console/package.json ./apps/console/package.json
COPY --chown=sigmon:sigmon apps/worker/package.json ./apps/worker/package.json
COPY --chown=sigmon:sigmon packages/cli/package.json ./packages/cli/package.json
COPY --chown=sigmon:sigmon packages/config/package.json ./packages/config/package.json
COPY --chown=sigmon:sigmon packages/db/package.json ./packages/db/package.json
COPY --chown=sigmon:sigmon packages/queues/package.json ./packages/queues/package.json
COPY --chown=sigmon:sigmon packages/sdk/package.json ./packages/sdk/package.json
COPY --chown=sigmon:sigmon packages/telemetry/package.json ./packages/telemetry/package.json

RUN --mount=type=cache,id=sigmon-pnpm-store,target=/home/sigmon/.local/share/pnpm/store pnpm install --frozen-lockfile

COPY --chown=sigmon:sigmon apps ./apps
COPY --chown=sigmon:sigmon packages ./packages
COPY --chown=sigmon:sigmon docs/AGENT-SETUP.md ./docs/AGENT-SETUP.md
COPY --chown=sigmon:sigmon scripts ./scripts
COPY --chown=sigmon:sigmon tsconfig.base.json vitest.config.ts ./

RUN pnpm --filter @sigmon/console build

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start:api"]
