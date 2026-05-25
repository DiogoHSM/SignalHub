FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache postgresql16-client tini curl
RUN addgroup -S sigmon && adduser -S -G sigmon sigmon

RUN corepack enable
RUN mkdir -p /app /var/lib/sigmon/backups /var/lib/sigmon/source-maps && chown -R sigmon:sigmon /app /var/lib/sigmon

USER sigmon

COPY --chown=sigmon:sigmon package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=sigmon:sigmon apps ./apps
COPY --chown=sigmon:sigmon packages ./packages
COPY --chown=sigmon:sigmon scripts ./scripts
COPY --chown=sigmon:sigmon tsconfig.base.json vitest.config.ts ./

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sigmon/console build

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start:api"]
