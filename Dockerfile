FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache postgresql16-client tini curl
RUN addgroup -S sigmon && adduser -S -G sigmon sigmon

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json vitest.config.ts ./

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sigmon/console build
RUN mkdir -p /var/lib/sigmon/backups /var/lib/sigmon/source-maps
RUN chown -R sigmon:sigmon /app /var/lib/sigmon

USER sigmon
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "start:api"]
