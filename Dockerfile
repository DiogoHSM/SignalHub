FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache postgresql16-client

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tsconfig.base.json vitest.config.ts ./

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @sigmon/console build

CMD ["pnpm", "start:api"]
