# Auditoria de Infraestrutura, Deploy e Configuração — SignalHub

Revisão sênior de DevOps/Infra/Deploy do estado atual do repositório `/home/user/SignalHub` (Fase 5C). Análise estritamente de leitura; nenhum arquivo de código foi alterado.

---

## 1. Sumário

O projeto SignalHub apresenta uma base operacional sólida: configuração validada com Zod, scripts de doctor com redação de segredos, migrações idempotentes com lock de advisory transacional, healthchecks de Postgres e Redis no Compose, bind explícito a `127.0.0.1` para serviços de dados e separação de volumes. Há, contudo, riscos relevantes na cadeia de Docker (imagem rodando como root, sem multi-stage, sem HEALTHCHECK, sem inicializador de PID 1, sem `pnpm prune`), no Compose (sem `restart` policy, com placeholder de senha aceito como default), no `package.json` (ausência de `engines`, ausência de scripts de lint reais, ausência de `dev` no root), no `tsconfig.base.json` (faltam flags como `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`), na cobertura de testes (sem provider de coverage), na ausência total de pipeline CI/CD (`.github/workflows/` inexistente), no design de backups (sem compressão/criptografia/checksum) e na documentação operacional (sem procedimento explícito de rollback).

Severidades totais (estimativa): CRÍTICO 4, ALTO 11, MÉDIO 10, BAIXO 7, INFORMATIVO 5.

---

## 2. Tabela de Achados

| # | Severidade | Categoria | Achado | Local |
|---|---|---|---|---|
| F1 | CRÍTICO | Dockerfile | Container roda como root (sem `USER`) | `Dockerfile:1-18` |
| F2 | CRÍTICO | Compose | Senha de Postgres aceita placeholder de produção como default no Compose | `docker-compose.yml:7`, `:41`, `:63` |
| F3 | CRÍTICO | CI/CD | Não existe `.github/workflows/` (nenhum CI configurado) | repositório raiz |
| F4 | CRÍTICO | Backups | Dump sem compressão, sem criptografia, sem checksum/verificação de integridade | `apps/worker/src/backups.ts`, `.env.example:31-41` |
| F5 | ALTO | Dockerfile | Sem multi-stage; node_modules de devDependencies vão para imagem final | `Dockerfile:1-18` |
| F6 | ALTO | Dockerfile | Sem `HEALTHCHECK` na imagem da API | `Dockerfile:1-18` |
| F7 | ALTO | Dockerfile | Sem `tini`/`dumb-init`/`ENTRYPOINT` em exec form: SIGTERM pode não chegar ao Node corretamente | `Dockerfile:18` |
| F8 | ALTO | Dockerfile | `pnpm install --frozen-lockfile` sem `pnpm prune --prod` e sem `pnpm fetch` para cache | `Dockerfile:15-16` |
| F9 | ALTO | Compose | Sem `restart: unless-stopped`/`on-failure` em nenhum serviço | `docker-compose.yml:1-77` |
| F10 | ALTO | Compose | Sem `healthcheck` para os serviços `api` e `worker` | `docker-compose.yml:31-71` |
| F11 | ALTO | TS Config | `tsconfig.base.json` sem `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` | `tsconfig.base.json` |
| F12 | ALTO | TS Config | Pacotes têm script `build` como `tsc --noEmit`; nenhum emite código real exceto `@signal-hub/sdk` | `apps/api/package.json:8`, `apps/worker/package.json:11`, `packages/db/package.json:8` |
| F13 | ALTO | package.json | Sem campo `engines` (Node 22 / pnpm 9.15) | `package.json` |
| F14 | ALTO | Vitest | Sem configuração de `coverage` no Vitest | `vitest.config.ts` |
| F15 | ALTO | .env.example | `BOOTSTRAP_ADMIN_PASSWORD=change-me-admin-password-32-chars-min` é placeholder; em ambientes que `cp .env.example .env` sem trocar, a verificação de produção falha mas em `development` o admin é criado com essa senha frágil | `.env.example:14`, `packages/config/src/index.ts:9-21` |
| F16 | MÉDIO | Dockerfile | Sem versão pinada para `postgresql16-client` (Alpine atualiza patches automaticamente) | `Dockerfile:5` |
| F17 | MÉDIO | Dockerfile | Apenas uma imagem para API e Worker; arrasta o cliente `psql` para a API que não o utiliza | `Dockerfile:5`, `docker-compose.yml:31-71` |
| F18 | MÉDIO | Dockerfile | `WORKDIR /app` sem `chown` posterior implica arquivos pertencentes a root mesmo se `USER` for adicionado | `Dockerfile:3-13` |
| F19 | MÉDIO | Compose | Porta 3000 publicada em `0.0.0.0` por padrão (não `127.0.0.1`) | `docker-compose.yml:45` |
| F20 | MÉDIO | Compose | Postgres e Redis sem `command` com `shared_buffers`/`max_connections` ajustáveis; defaults frágeis em produção self-hosted | `docker-compose.yml:2-29` |
| F21 | MÉDIO | Backups | `--no-owner --no-privileges` no `pg_dump` é correto, mas `--format=custom` sem `-Z` (compressão) | `apps/worker/src/backups.ts` (função `dumpPostgresDatabase`) |
| F22 | MÉDIO | Migrations | Migrações idempotentes com checksum SHA-256, mas sem suporte a “down” e sem registro de duração | `packages/db/src/migrate.ts` |
| F23 | MÉDIO | Docs | `DEPLOYMENT.md` não documenta rollback (downgrade/rollback de release ou de migração) | `.claude/docs/DEPLOYMENT.md` |
| F24 | MÉDIO | Logs | Fastify roda com `logger: false`; perde request id, latência, status code | `apps/api/src/app.ts:41` |
| F25 | MÉDIO | Doctor | Doctor não checa permissão de escrita em `BACKUPS_LOCAL_DIR` | `scripts/doctor.ts:177-181` |
| F26 | BAIXO | .gitignore | Não ignora `*.log`, `tmp/`, `*.dump`, `*.bak`, `*.tgz`, `*.tar.gz`, `*.map` artefatos enviados | `.gitignore` |
| F27 | BAIXO | .env.example | Falta `NODE_ENV` documentado em SECRETS.md como permitido (`test` não está documentado como uso válido) | `.claude/docs/SECRETS.md:9` |
| F28 | BAIXO | package.json | Falta script `dev` aglomerador (API + worker + console em paralelo) | `package.json:7-23` |
| F29 | BAIXO | Compose | Volumes anônimos sem labels/driver explícito (auditoria fica difícil) | `docker-compose.yml:73-77` |
| F30 | BAIXO | TS paths | `tsconfig.base.json` e `vitest.config.ts` mantêm aliases duplicados manualmente (alto risco de drift) | `tsconfig.base.json:14-25`, `vitest.config.ts:15-39` |
| F31 | BAIXO | SDK build | `@signal-hub/sdk` emite `dist/` (correto), mas não há script de publicação/changelog/release workflow | `packages/sdk/package.json` |
| F32 | BAIXO | Doctor | Não checa versão mínima de Node ou pnpm (só verifica que comando responde) | `scripts/doctor.ts:323-324` |
| F33 | INFO | Config | `loadConfig` ignora silenciosamente valores em branco para várias opcionais (boa UX, anotar) | `packages/config/src/index.ts:3-5` |
| F34 | INFO | Compose | Healthcheck do Postgres bom; do Redis poderia exigir `AUTH` quando houver | `docker-compose.yml:12-29` |
| F35 | INFO | Scripts | `seed-admin.ts` usa `pg_advisory_xact_lock(927380402914)`; `migrate.ts` usa `…2913` — IDs distintos por escopo, bom | `scripts/seed-admin.ts:17`, `packages/db/src/migrate.ts:22` |
| F36 | INFO | Doctor | `doctor.ts` faz redação de URL credentials de forma robusta | `scripts/doctor.ts:199-204` |
| F37 | INFO | Restore | `backup-restore.ts` exige `--yes` explícito, evita erro humano | `scripts/backup-restore.ts:35-37` |

---

## 3. Detalhes por Seção

### 3.1 Dockerfile (`/home/user/SignalHub/Dockerfile`)

```
1  FROM node:22-alpine
2
3  WORKDIR /app
4
5  RUN apk add --no-cache postgresql16-client
6
7  RUN corepack enable
8
9  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
10 COPY apps ./apps
11 COPY packages ./packages
12 COPY scripts ./scripts
13 COPY tsconfig.base.json vitest.config.ts ./
14
15 RUN pnpm install --frozen-lockfile
16 RUN pnpm --filter @signal-hub/console build
17
18 CMD ["pnpm", "start:api"]
```

- **F1 CRÍTICO — root user**: `Dockerfile:1-18` não cria nem comuta para usuário não-root. Em conjunto com `WORKDIR /app` herdado de `node:22-alpine` (que tem usuário `node` com UID 1000 disponível), o container final roda como UID 0. Qualquer escape de container ou exploração de RCE em Fastify obtém privilégios de root no host se for usado em modo `--privileged` ou com volumes sensíveis.
- **F5 ALTO — sem multi-stage**: tudo é construído em uma única camada. Sobram em produção: `apk` toolchain (mínima, ok), build do console com `vite` (devDependencies), `tsx` e workspaces inteiros com testes (`scripts/doctor.test.ts`, `packages/config/test/`). Tamanho de imagem e área de ataque crescem significativamente.
- **F6 ALTO — sem HEALTHCHECK**: a imagem não declara `HEALTHCHECK CMD curl ... /health`. Orquestradores (Docker Swarm, Nomad, ECS) que dependem disso ficam cegos. No Compose, F10 documenta a mesma ausência no nível do serviço.
- **F7 ALTO — SIGTERM/PID 1**: `CMD ["pnpm", "start:api"]` (`Dockerfile:18`) faz com que o PID 1 seja `pnpm`, não o Node. `pnpm` repassa sinais para o filho via `tsx`/Node, mas em Alpine não há `tini` nem `dumb-init` como inicializador. Em práticas de produção, recomenda-se `ENTRYPOINT ["tini", "--"]` ou `exec node ...`. O código de `apps/api/src/main.ts:512-518` e `apps/worker/src/main.ts:216-220` já trata SIGINT/SIGTERM corretamente, mas a propagação ao Node depende do shim do pnpm.
- **F8 ALTO — sem `pnpm prune --prod`**: `Dockerfile:15-16` instala tudo, inclusive devDependencies (`vitest`, `tsx`, `testcontainers`, `@testing-library/*`). Em produção apenas `tsx` é necessário porque os scripts `start:api` e `start:worker` rodam `tsx src/main.ts` direto. Convém: (a) compilar TS para JS num stage anterior; (b) descartar devDependencies; (c) usar `node dist/main.js` no estágio final.
- **F16 MÉDIO — versão não pinada**: `postgresql16-client` (`Dockerfile:5`) é genérico; o apk repositório do Alpine pode trazer 16.x atualizações que mudem comportamento de `pg_dump`/`pg_restore`. Pinar `=16.4-r0` (ou similar) ou usar `--repository` controlado.
- **F17 MÉDIO — imagem única**: API e Worker usam o mesmo `Dockerfile` (`docker-compose.yml:31-71`). A API não usa `pg_dump`/`pg_restore`; o `postgresql16-client` poderia ficar apenas na imagem do worker.
- **F18 MÉDIO — permissions**: arquivos copiados são propriedade de root. Se um `USER node` for introduzido, vai precisar de `--chown=node:node` em todos os `COPY`.

### 3.2 docker-compose.yml (`/home/user/SignalHub/docker-compose.yml`)

- **F2 CRÍTICO — placeholder como default**: `docker-compose.yml:7` e `:41,:63` usam `${POSTGRES_PASSWORD:-signalhub-local-only-change-me}`. Em qualquer ambiente onde o operador esqueça de criar `.env`, o Postgres sobe com a senha de placeholder e o `DATABASE_URL` interno do API/Worker também usa esse valor. O `loadConfig` (`packages/config/src/index.ts:31-45`) só rejeita esse placeholder quando `NODE_ENV=production`; em `development` ele inicia normalmente. Recomenda-se: remover o fallback do Compose e fazer `docker compose up` falhar se `POSTGRES_PASSWORD` não estiver definido (omitir o `:-`).
- **F9 ALTO — `restart` policy ausente**: nenhum serviço (`postgres`, `redis`, `api`, `worker`) declara `restart`. Em uma operação self-hosted, depois de um restart de host ou um OOM, os serviços não sobem. Padrão recomendado: `restart: unless-stopped` para todos.
- **F10 ALTO — sem healthcheck em API/Worker**: `postgres` e `redis` têm healthcheck explícito (linhas 12-16 e 25-29). `api` e `worker` (linhas 31-71) não têm. O `depends_on … condition: service_healthy` (`docker-compose.yml:48-52, 67-71`) verifica apenas o estado das deps; outros consumidores (proxy, futura camada de orquestração) ficam sem condição clara.
- **F19 MÉDIO — porta da API em 0.0.0.0**: `docker-compose.yml:45` publica `"3000:3000"` (todas as interfaces), enquanto Postgres (linha 9) e Redis (linha 22) usam `127.0.0.1:...`. Para self-hosted sem reverse proxy à frente, recomenda-se `127.0.0.1:3000:3000` e exposição via Nginx/Caddy, ou ao menos documentar a expectativa de proxy.
- **F20 MÉDIO — tuning Postgres/Redis**: imagens default não definem `shared_buffers`, `work_mem`, `max_connections`, `maxmemory`, política de eviction. Em telemetria com escrita pesada isso aparece sob carga.
- **F29 BAIXO — volumes sem labels**: `volumes: { postgres_data: , redis_data: , backup_data: , source_map_data: }` (linhas 73-77). Sem `labels:` ou `driver:` explícito, auditoria/observabilidade do disco fica difícil.
- **F34 INFO — healthcheck Redis**: simples `redis-cli ping`. Se um dia houver `requirepass`, esse comando falhará silenciosamente.

### 3.3 Variáveis de ambiente e configuração

- **F4 / F15** (ver seções específicas). Em `.env.example`:
  - `BOOTSTRAP_ADMIN_EMAIL=admin@example.com` (`.env.example:13`) é vazado como default em todos os ambientes de desenvolvimento. Mesmo sendo dev, é prática de risco caso essa instância seja exposta acidentalmente.
  - `RETENTION_*`, `ALERTS_*`, `BACKUPS_*` estão completos (boa cobertura).
  - Falta `NODE_ENV=test` documentado em `SECRETS.md` como valor aceito (o Zod aceita, mas a documentação só lista `development`).
- **F33 INFO**: `emptyStringToUndefined` (`packages/config/src/index.ts:3`) silenciosamente trata `""` como ausência; isso é útil para overrides em Compose mas pode mascarar erros de operador.
- `loadConfig` impõe:
  - mínimo de 32 caracteres para `SESSION_SECRET`, `API_KEY_PEPPER`, `BOOTSTRAP_ADMIN_PASSWORD` fora de `test` (`packages/config/src/index.ts:112-116`). Boa prática.
  - rejeita placeholders em produção (`packages/config/src/index.ts:17-21`, `:124-126`).
  - rejeita o placeholder local de senha do Postgres dentro de `DATABASE_URL` em produção (`packages/config/src/index.ts:31-45`).
  - exige Google OAuth completo quando habilitado (`packages/config/src/index.ts:129-133`).
  - exige todas as 4 chaves S3 quando `BACKUPS_S3_ENABLED=true` (`packages/config/src/index.ts:135-144`).

A validação está bem coberta pelos testes (`packages/config/test/config.test.ts`). Recomenda-se ainda:
- impor schema na URL: `z.string().url().refine(v => new URL(v).protocol === "postgres:" || …)`.
- exigir TLS no `DATABASE_URL` em produção (`sslmode=require`) quando o host não é interno.
- normalizar `BACKUPS_LOCAL_DIR` para caminho absoluto.

### 3.4 Scripts (`/home/user/SignalHub/scripts/`)

#### 3.4.1 `migrate.ts` + `packages/db/src/migrate.ts`

- Idempotente: usa `_migrations` com checksum SHA-256 (`packages/db/src/migrate.ts:33-49`). Bom.
- Transacional + advisory lock global: `pg_advisory_xact_lock(927380402913)` (`packages/db/src/migrate.ts:22`). Previne concorrência. Bom.
- **F22 MÉDIO**: não suporta migrações "down" nem registra duração ou autor. Em rollback, o operador precisa intervir manualmente.
- Não há comando para listar migrações pendentes (`pnpm db:status` inexistente).

#### 3.4.2 `seed-admin.ts`

- Idempotente: detecta usuário existente e usa advisory lock próprio (`scripts/seed-admin.ts:17`).
- Hash com Argon2 (`scripts/seed-admin.ts:27`).
- **F15 ALTO**: usa `config.bootstrapAdmin.password` direto do env. Se o operador trocou no `.env`, seguro. Se não trocou (apenas `NODE_ENV=development`), o admin é criado com a senha placeholder de 36 caracteres, que está publicada no repositório.
- Falha bem (mensagem clara) se o email já pertence a um não-admin (`scripts/seed-admin.ts:21-23`).

#### 3.4.3 `backup-create.ts`

- Aciona `runBackupOnce` (`scripts/backup-create.ts:15-25`) com trigger `manual`.
- Aplica `migrate` antes do backup (`scripts/backup-create.ts:13`). Útil em CI mas redundante para backups regulares; gasta tempo e pode bloquear se outro processo está migrando.

#### 3.4.4 `backup-restore.ts`

- Exige `--yes` explícito (`scripts/backup-restore.ts:35-37`). Bom.
- Usa `pg_restore` com `--clean --if-exists --no-owner --no-privileges` (`scripts/backup-restore.ts:84-87`). Adequado para restaurar em DB limpo.
- Repassa senha via `PGPASSWORD` no env do filho, não em argv (`scripts/backup-restore.ts:78`). Bom (evita aparecer em `ps`).
- **F4 CRÍTICO (vertente restore)**: como o backup não tem checksum, o restore não pode validar integridade antes de aplicar.

#### 3.4.5 `doctor.ts`

- Bem estruturado: separa checks puros de IO, redige segredos com `redactDoctorText` + `redactUrlUserInfo` (`scripts/doctor.ts:188-204`).
- Cobertura testada em `scripts/doctor.test.ts` (timeout, SIGTERM→SIGKILL, redação, parsing de args).
- **F25 MÉDIO**: não verifica permissão de escrita em `BACKUPS_LOCAL_DIR`. Verifica `SOURCE_MAPS_LOCAL_DIR` (`scripts/doctor.ts:177-181`).
- **F32 BAIXO**: o check de Node/pnpm (`scripts/doctor.ts:323-324`) executa o binário e considera exit code 0 como pass; não compara com `engines`/versão mínima.
- A lista de envs requeridos (`scripts/doctor.ts:29-36`) duplica `loadConfig`. Recomenda-se derivar do schema Zod.

### 3.5 Backups (`apps/worker/src/backups.ts`, `.env.example:31-41`)

- **F4 CRÍTICO**:
  - `dumpPostgresDatabase` invoca `pg_dump --format=custom --no-owner --no-privileges`. Não usa flag `-Z`/compressão (custom já tem alguma compressão padrão, mas baixa). Não gera artefato `.sha256` ou `.tar.gz` cifrado.
  - Sem GPG/age para criptografia em repouso. Em S3 (R2), o dump segue criptografado apenas pelo storage provider.
  - Sem verificação posterior `pg_restore --list` ou pg_dump `--exit-on-error`. Um dump corrompido só é detectado durante restore.
  - Retenção local (`BACKUPS_RETENTION_DAYS=14`) é controlada por nome de arquivo (regex `signalhub-\d{8}T\d{6}Z\.dump`). Funcional, mas vulnerável a clock skew.
- **F21 MÉDIO**: mesma área. Sugestão de pipeline: `pg_dump --format=custom | zstd | age -r <key>` com checksum SHA-256 publicado no metadado da tabela `backup_runs`.

### 3.6 CI/CD

- **F3 CRÍTICO**: `.github/workflows/` não existe. Toda a verificação de qualidade depende do operador rodar manualmente `pnpm test`, `pnpm build`, `docker compose config`, `pnpm doctor` (conforme `CLAUDE.md` e `.claude/docs/DEPLOYMENT.md:140-147`).
- Não há pipeline de:
  - lint/test em PRs;
  - scan de vulnerabilidades (`pnpm audit`, `trivy`, `grype`);
  - build de imagem Docker e push para um registry;
  - geração de SBOM;
  - release/publish do SDK (`packages/sdk`) no npm;
  - validação de migrações em PostgreSQL real (testcontainers já está disponível como devDep — só não está no CI).

### 3.7 TypeScript / Build

- **F11 ALTO** (`tsconfig.base.json`):
  - `strict: true` (`tsconfig.base.json:6`) está bom.
  - Faltam: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`.
  - Faltam: `verbatimModuleSyntax`, `isolatedModules`.
  - `declaration: true` é correto para o SDK.
  - `sourceMap: true` em base — bom em dev, em produção deveria estar em config separado para não vazar paths originais.
- **F12 ALTO**: scripts `build` em `apps/api/package.json:8`, `apps/worker/package.json:11`, `packages/db/package.json:8`, `packages/config/package.json:8`, `packages/telemetry/package.json`, `packages/queues/package.json` usam `tsc --noEmit`. Isso é “type-check”, não “build”. O runtime usa `tsx src/main.ts` (`apps/api/package.json:12`). Resultado: em produção, transpiltação é feita em tempo de execução por `tsx`. Implicações:
  - cold-start mais lento;
  - dependência de `tsx` em produção;
  - perda de optimizações de bundling e tree-shaking;
  - dificulta uma imagem `node:22-alpine-slim` sem TypeScript.
- **F30 BAIXO**: `tsconfig.base.json:14-25` e `vitest.config.ts:15-39` duplicam aliases. Qualquer adição/remoção exige sincronizar dois lugares. Sugere-se usar `vite-tsconfig-paths` no Vitest.
- **F31 BAIXO**: `@signal-hub/sdk` tem `tsconfig.build.json` correto que emite `dist/` (`packages/sdk/package.json:5-15`), mas não há workflow de release/publicação.

### 3.8 Vitest (`/home/user/SignalHub/vitest.config.ts`)

- **F14 ALTO**: nenhum bloco `coverage`. Sem `--coverage` por padrão, sem thresholds. Em projeto de telemetria onde regressões são caras, isso é um buraco.
- `environmentMatchGlobs` correta para console.
- `setupFiles: ["apps/console/src/test/setup.ts"]` é global; assets de DOM acabam carregando em todos os testes Node. Mover para `environmentMatchGlobs`-scoped setup é mais limpo.
- `testTimeout: 30_000` adequado para testcontainers (que está em devDeps mas não vejo uso global).

### 3.9 package.json (root)

- **F13 ALTO**: sem `engines` (`package.json:1-52`). `packageManager: "pnpm@9.15.4"` (`:6`) ajuda mas não substitui. Adicionar `"engines": { "node": ">=22 <23", "pnpm": ">=9.15.0 <10" }`.
- **F28 BAIXO**: sem script `dev` aglomerador (apenas `dev:api`, `dev:worker`, `dev:console`). Operadores e devs novos têm que aprender 3 comandos.
- Falta script: `format` (Prettier/Biome), `typecheck` separado de `lint`.
- `lint` é, na prática, `tsc --noEmit` em cada pacote (ver F12). Não há ESLint/Biome real.
- Boa modelagem do `db:migrate`, `seed:admin`, `backup:*`, `doctor` no root.

### 3.10 Logs e observabilidade

- **F24 MÉDIO** (`apps/api/src/app.ts:41`): `Fastify({ logger: false })`. Em produção, isso significa que nenhum log estruturado de request é emitido. O `app.listen` (`apps/api/src/main.ts:494`) também não loga. Em `shutdown` (`apps/api/src/main.ts:498-510`) há `console.info`/`console.error`. Sem JSON estruturado, ferramentas como Loki/ELK indexam mal.
- Worker (`apps/worker/src/main.ts`) também usa `console.*` direto.
- Não há configuração de level (`info`/`warn`/`error`) por env. Tudo é sempre verboso ou nulo.
- Nenhuma rotação de log (depende do orquestrador / docker logging driver). Documentar `logging:` no Compose seria valioso.

### 3.11 .gitignore (`/home/user/SignalHub/.gitignore`)

- Cobre: `.superpowers/`, `.worktrees/`, `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*` (exceto example), `/SECRETS.md`.
- **F26 BAIXO** — não cobre:
  - `*.log`, `npm-debug.log*`, `pnpm-debug.log*`;
  - `tmp/`, `.cache/`;
  - `*.dump`, `*.sql.gz`, `backups/`, `signalhub-*.dump` (artefatos de `pnpm backup:create` rodado localmente);
  - `*.map` (source maps locais durante upload manual antes do envio);
  - `.DS_Store`, `Thumbs.db`;
  - `.vscode/`, `.idea/` (decisão de equipe);
  - `.vite/`, `apps/console/dist/` (já coberto por `dist/`, ok).

### 3.12 Documentação operacional (`.claude/docs/`)

- `DEPLOYMENT.md` bem estruturado: Compose passos 1-8, doctor, retention, alerts, source maps, backups, migrations, readiness, password rotation, verification, console.
- **F23 MÉDIO**: falta seção “Rollback / Downgrade” cobrindo:
  - rollback de release: re-deploy de imagem anterior, comportamento de migrações forward-only;
  - rollback de migração: como reverter um `0007_breadcrumbs.sql` se ele for problemático (atualmente, não há rollback automático);
  - estratégia de blue/green ou drenar requests antes de `docker compose down`;
  - como restaurar de backup imediatamente anterior;
  - smoke tests após rollback.
- `DEPLOYMENT.md:107-113` documenta restore destrutivo corretamente.
- `INFRASTRUCTURE.md` lista volumes e bindings; falta mencionar capacidade, dimensionamento, política de retenção de logs do Docker.
- `SECRETS.md` excelente: cobre todas as variáveis, marca quais são secret vs operational, recomenda secret manager.

---

## 4. Recomendações Operacionais Priorizadas

### 4.1 Curto prazo (sprint atual)

1. **Dockerfile multi-stage com USER não-root (F1, F5, F7, F8)**
   ```dockerfile
   # Stage 1: deps
   FROM node:22-alpine AS deps
   RUN corepack enable && apk add --no-cache tini
   WORKDIR /app
   COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
   COPY apps/*/package.json packages/*/package.json ./...
   RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

   # Stage 2: build
   FROM deps AS build
   COPY . .
   RUN pnpm -r build && pnpm --filter @signal-hub/console build

   # Stage 3: prod
   FROM node:22-alpine AS runtime
   RUN apk add --no-cache tini postgresql16-client=16.4-r0
   WORKDIR /app
   COPY --from=build --chown=node:node /app /app
   USER node
   HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
     CMD wget -qO- http://127.0.0.1:3000/ready || exit 1
   ENTRYPOINT ["/sbin/tini", "--"]
   CMD ["pnpm", "start:api"]
   ```
2. **Compose: remover fallback de senha (F2) + restart policy (F9) + healthcheck API/worker (F10)**:
   ```yaml
   services:
     postgres:
       restart: unless-stopped
       environment:
         POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
     api:
       restart: unless-stopped
       healthcheck:
         test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/ready"]
         interval: 30s
         timeout: 5s
         retries: 3
       ports:
         - "127.0.0.1:3000:3000"   # ou manter 0.0.0.0 atrás de proxy documentado
   ```
3. **CI/CD mínimo (F3)** — `.github/workflows/ci.yml`:
   - matriz Node 22;
   - `pnpm install --frozen-lockfile`;
   - `pnpm lint && pnpm test && pnpm build`;
   - `docker compose config --quiet`;
   - `pnpm audit --prod`;
   - `trivy fs .` para imagem.
   - Pipeline separado de release que publica imagem em GHCR e SDK em npm.
4. **Engines pinned (F13)** em `package.json`:
   ```json
   "engines": { "node": ">=22 <23", "pnpm": ">=9.15.0 <10" }
   ```
5. **Doctor: validar permissão de escrita em `BACKUPS_LOCAL_DIR` (F25)** e versão mínima de Node/pnpm (F32).
6. **Logs Fastify (F24)**: ativar `logger: { level: process.env.LOG_LEVEL ?? "info", redact: [...] }`. Adicionar `LOG_LEVEL` em `.env.example` e SECRETS.md.

### 4.2 Médio prazo

7. **TS strictness (F11)**: ativar `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch` em `tsconfig.base.json`. Espere arrumar entre 20-50 sites; vale o investimento.
8. **Build real (F12)**: `tsc -p tsconfig.build.json` em cada pacote e `node dist/main.js` em vez de `tsx src/main.ts`. Stage final fica `node:22-alpine` sem `tsx`.
9. **Coverage (F14)**: adicionar `@vitest/coverage-v8` e thresholds (`lines: 80, functions: 80, branches: 70`) em `vitest.config.ts`.
10. **Backups robustos (F4, F21)**:
    - `pg_dump … | zstd --threads=0 > $FILE.zst`;
    - `sha256sum $FILE.zst > $FILE.zst.sha256`;
    - opcional: `age -R recipients.txt -o $FILE.zst.age $FILE.zst`;
    - validar com `pg_restore --list $FILE.zst` (após descomprimir) no final do job;
    - registrar `checksum` e `sizeBytes` em `backup_runs`.
11. **Rollback docs (F23)** em `DEPLOYMENT.md`:
    - retag e re-deploy da imagem N-1;
    - `docker compose stop api worker` → restaurar dump → reiniciar;
    - matriz de compatibilidade de migrações.

### 4.3 Longo prazo / melhoria contínua

12. **ESLint/Biome + Prettier** (F12, complemento): ter `lint` real.
13. **Imagem base distroless** ou `node:22-bookworm-slim` com `gcr.io/distroless/nodejs22` para área de ataque mínima.
14. **Observabilidade**: integrar OpenTelemetry no Fastify (já temos um SDK próprio de telemetria, ironia notável) com export para o próprio SignalHub ou stdout JSON.
15. **Secrets management**: integrar com 1Password CLI / SOPS / Vault em produção; documentar fluxo em SECRETS.md.
16. **Imagens dedicadas API vs Worker (F17)**: dois `Dockerfile` ou multi-stage com target diferentes; só worker carrega `postgresql16-client`.
17. **SBOM e assinatura**: gerar SBOM (Syft) e assinar imagens (cosign) no pipeline.
18. **Aliases TS centralizados (F30)**: usar `vite-tsconfig-paths` no Vitest para evitar duplicação.

---

## 5. Pontos Positivos a Preservar

- Validação de configuração com Zod e rejeição explícita de placeholders em produção (`packages/config/src/index.ts:17-21, 31-45, 112-116, 124-127`).
- Migrações idempotentes com checksum e advisory lock (`packages/db/src/migrate.ts:21-49`).
- Doctor com redação rigorosa de segredos e testes unitários abrangentes (`scripts/doctor.ts:188-204`, `scripts/doctor.test.ts`).
- Restore destrutivo com `--yes` obrigatório (`scripts/backup-restore.ts:35-37`).
- Graceful shutdown bem-estruturado em API e Worker (`apps/api/src/main.ts:496-518`, `apps/worker/src/main.ts:204-225`).
- Healthchecks de Postgres/Redis no Compose (`docker-compose.yml:12-16, 25-29`).
- Bind dos serviços de dados a `127.0.0.1` (`docker-compose.yml:9, 22`).
- `depends_on … service_healthy` correto (`docker-compose.yml:48-52, 67-71`).
- Documentação operacional escrita em inglês, consistente e cobrindo doctor, backups, rotação de senha (`.claude/docs/DEPLOYMENT.md`).
- SECRETS.md exemplar: distingue secrets de operational config e proíbe valores reais em docs.

---

## 6. Conclusão

O SignalHub está em uma fase em que a engenharia de configuração (Zod, doctor, advisory locks, validações de produção) já está bem acima da média; o gap está nas “arestas” do deploy: a imagem ainda é monolítica e rodando como root, o Compose tem defaults perigosos e sem `restart`, falta CI/CD inteiramente, a build de TypeScript é feita em runtime via `tsx`, e os backups carecem de integridade verificável. Fechar os quatro itens CRÍTICOS (F1-F4) e os três primeiros itens da seção 4.1 entrega rapidamente uma postura de produção compatível com o que a documentação já promete.
