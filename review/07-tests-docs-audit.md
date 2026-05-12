# Auditoria de Testes, Documentação e Completude — SignalHub

Data: 2026-05-12
Escopo revisado: arquivos `*.test.ts(x)` em `apps/`, `packages/`, `scripts/`; `vitest.config.ts`; `README.md`, `PRD.md`, `CLAUDE.md`; `.claude/docs/*.md`.

---

## Sumário

O projeto tem uma base de testes **robusta para o backend**: o pacote `packages/db` cobre repositórios com Postgres real (testcontainers), o worker tem 1.382 linhas de testes cobrindo retenção, alertas, backups, DNS-rebinding e advisory locks, e a query API tem 2.000 linhas com cobertura de filtros e códigos de erro.

Os principais déficits são:

1. **Sem testes de rate limiting** apesar de `@fastify/rate-limit` estar registrado em `apps/api/src/app.ts:56` — o PRD lista rate limiting como capacidade de Phase 4 (`PRD.md:434`) mas não há nenhum teste que envie 1001 requests e exija `429`.
2. **Gap PRD ↔ código**: o PRD declara `POST /v1/logs` como deliverable de Phase 1 (`PRD.md:243`), mas o endpoint não existe e nada na documentação principal aponta esse desvio em destaque (apenas o aviso genérico "stored log telemetry not implemented" em `README.md:24`).
3. **Documentação Portuguesa vs Inglesa**: o PRD inteiro está em inglês mas a CLAUDE.md diz "Keep project-facing documentation in English" — coerente — porém o PRD ainda menciona stack genérico (ClickHouse, Cloudflare R2, MinIO, Recharts) que diverge do stack real implementado (Postgres puro, Kysely, sem chart deps). Esse PRD não foi atualizado para refletir o que foi efetivamente construído.
4. **Vários componentes do console sem teste próprio** (27 componentes em `apps/console/src/components/`). Embora muitos sejam testados indiretamente via painéis pais, alguns têm lógica que merece teste isolado (`OverviewKpiGrid`, `OverviewMiniTrends`, `SpanTimeline`, `ErrorSourceMapResolution`).
5. **Tabela em `SECRETS.md` documenta `RETENTION_BREADCRUMBS_DAYS`** corretamente, mas o `README.md:69-77` mostra a tabela de retenção sem incluir explicitamente o caminho de override por env var — apenas tabela com defaults.
6. **Setup file global (`apps/console/src/test/setup.ts`) é aplicado para todos os testes** (Node e jsdom), o que é desperdiço para testes Node, embora seja inócuo.
7. **Smoke tests fracos** em `SnippetPanel`, `SessionTimeline`, `EventDetailDrawer`, `LlmCallDetailDrawer`, `ConsoleModeTabs` — verificam presença textual mas não interação ou estados de borda.
8. **Ausência total de testes de SDK ↔ API real** além do `apps/api/test/e2e.test.ts` que cobre apenas o caminho `event`; nenhum end-to-end para `error`, `llm`, `trace`, `span`, `breadcrumb`.

---

## Tabela: Arquivos críticos sem teste ou com cobertura superficial

| Arquivo / Área | Tipo | Severidade | Observação |
|---|---|---|---|
| `apps/api/src/app.ts:56` (rate-limit) | Sem teste | ALTO | Nenhum teste exercita o limite 1000/min ou retorno 429. |
| `apps/api/src/main.ts` | Sem teste direto | MÉDIO | Composição de dependências e migration-on-boot não testados isoladamente. |
| `apps/api/src/system-health.ts` | Coberto parcialmente em `system.test.ts` | BAIXO | Funções pure-side são testadas; integração com probes reais não. |
| `apps/api/src/plugins/request-context.ts` | Sem teste | MÉDIO | Plugin global de contexto não tem cobertura dedicada. |
| `apps/console/src/components/OverviewKpiGrid.tsx` | Sem teste | MÉDIO | Testado indiretamente via `OverviewDashboard.test.tsx`. Formatação de p95, custos e contadores merece teste unitário. |
| `apps/console/src/components/OverviewMiniTrends.tsx` | Sem teste | MÉDIO | Renderização SVG/CSS sem chart lib é fonte natural de regressões; sem teste de empty/NaN buckets. |
| `apps/console/src/components/OverviewTopLists.tsx` | Sem teste | MÉDIO | Drill-in seeding de filtros (UX crítica do Overview, ARCHITECTURE.md:171) testado só via dashboard pai. |
| `apps/console/src/components/OverviewRecentSignals.tsx` | Sem teste | BAIXO | Renderização simples. |
| `apps/console/src/components/SpanTimeline.tsx` | Sem teste | MÉDIO | Renderização ordenada de spans, regra "spans loaded after trace selection" (UI-UX.md:36) não tem teste unitário. |
| `apps/console/src/components/ErrorSourceMapResolution.tsx` | Sem teste | ALTO | Componente sensível: deve nunca exibir `sourcesContent`. Apenas testado via painel pai (`ErrorInvestigationPanel.test.tsx`). |
| `apps/console/src/components/ErrorRawOccurrencesPanel.tsx` | Sem teste | MÉDIO | Coberto indiretamente. |
| `apps/console/src/components/ErrorGroupDetail.tsx` / `ErrorGroupList.tsx` / `ErrorGroupFilters.tsx` / `ErrorGroupsPanel.tsx` | Sem testes | MÉDIO | Workflow de status de grupo (open→investigating→resolved→ignored) testado só via API. |
| `apps/console/src/components/SetupWorkspace.tsx` | Sem teste | MÉDIO | Componente central do primeiro contato do operador. |
| `apps/console/src/components/EnvironmentSelector.tsx` / `ProjectSwitcher.tsx` | Sem teste | MÉDIO | Concentram lógica de seleção/escopo. |
| `apps/console/src/components/EntitiesTenantList.tsx` / `EntitiesTenantDetail.tsx` | Sem teste | BAIXO | Coberto via `EntitiesInvestigationPanel.test.tsx`. |
| `apps/console/src/components/UsersUserList.tsx` / `UsersUserDetail.tsx` | Sem teste | BAIXO | Coberto via `UsersInvestigationPanel.test.tsx`. |
| `apps/console/src/components/EventList.tsx` / `EventFilters.tsx` | Sem teste | BAIXO | Coberto indiretamente. |
| `apps/console/src/components/TraceList.tsx` / `TraceFilters.tsx` | Sem teste | BAIXO | Coberto indiretamente. |
| `apps/console/src/components/LlmCallList.tsx` / `LlmFilters.tsx` / `LlmAggregateStrip.tsx` | Sem teste | BAIXO | Coberto indiretamente. |
| `apps/console/src/components/ErrorList.tsx` / `ErrorFilters.tsx` | Sem teste | BAIXO | Coberto indiretamente. |
| `apps/console/src/main.tsx` | Sem teste | BAIXO | Bootstrap React; coberto via App.test.tsx. |
| `packages/sdk/src/queue.ts` (cobertura) | Smoke | BAIXO | `packages/queues/test/telemetry-queue.test.ts:37` usa `toBeDefined()` em vez de checar o ID gerado. |
| Rota `POST /v1/logs` | **NÃO EXISTE** | ALTO | Declarada em `PRD.md:243` mas omitida em código e arquitetura — PRD desatualizado. |
| E2E para `error`, `llm`, `trace`, `span`, `breadcrumb` | Faltam | MÉDIO | `apps/api/test/e2e.test.ts:49` só cobre o caminho `event`. |
| Idempotência de ingestão (mesmo id reenviado) | Sem teste | MÉDIO | Worker re-inserts não verificados. |
| Webhook delivery throttling/retry | Sem teste | MÉDIO | Apenas success e single-fail são cobertos em `apps/worker/test/telemetry-worker.test.ts`. |
| Migration rollback / down | N/A | INFORMATIVO | Arquitetura forward-only declarada; OK. |

---

## Detalhes

### Cobertura

#### Pontos fortes

- `packages/db/test/repositories.test.ts` (4.389 linhas) usa `PostgreSqlContainer` real, cobre migrations idempotentes (linha 178), checksum mismatch (4379), cross-scope rejection (4181, 240, 663, 772, 966), retention locks (838, 853), backup locks (1263), grouping fingerprints (725-754, 1416-1909), session timeline isolation (2691), default limits (4353).
- `apps/worker/test/telemetry-worker.test.ts` cobre DNS-rebinding (1140), credentials em URL (1034), reserved header tokens (1245), webhook secret header (1177), cooldowns (786), advisory lock skip (510, 831), heartbeat overlap (1351).
- `apps/api/test/query.test.ts` testa 4xx (401, 400) e 503 com dependências quebradas (em `query.test.ts:992-1028`, `1542`).
- `scripts/doctor.test.ts` cobre redaction, parseamento de args, placeholder detection, IPv6 localhost — pure logic.

#### Lacunas

- **CRÍTICO — Sem teste de rate limit**: `apps/api/src/app.ts:56` registra `rateLimit({ max: 1000, timeWindow: "1 minute" })`. Nenhum teste em `apps/api/test/` envia >1000 requests para `/v1/events` ou outro endpoint e verifica retorno `429`. PRD lista "rate limiting" como Phase 4 (`PRD.md:434`).
- **ALTO — Ingestion 5xx caminhos parciais**: `apps/api/test/ingestion.test.ts` cobre `enqueue` throwing (linha 63) e key inválida (85) mas não:
  - timeout do `verifyApiKey`
  - payload com `content-length` muito grande (Fastify body limit)
  - `content-type` ausente ou diferente de `application/json` (exceto multipart no admin)
  - JSON malformado
- **ALTO — Multi-tenancy boundaries no nível HTTP**: `packages/db/test/repositories.test.ts:4181` verifica que telemetry de project-A não retorna em filter project-B. Mas não há teste HTTP (`/query/events?project_id=A` enviado com API key escopada para B) — a lógica está toda no repositório e a rota só forward sem checar match com sessão.
- **MÉDIO — Concorrência e idempotência**:
  - Reentrega de jobs com mesmo `id` pelo BullMQ não tem teste em `apps/worker/test/telemetry-worker.test.ts`.
  - Não há teste que envie 2 inserts paralelos da mesma fingerprint para validar o comportamento do `error_groups` (lock/transaction).
- **MÉDIO — E2E coberto apenas para events**: `apps/api/test/e2e.test.ts:49` testa ingestão→queue→worker→query apenas para `event`. Os caminhos `/v1/errors`, `/v1/llm`, `/v1/traces`, `/v1/spans`, `/v1/breadcrumbs` não têm e2e dedicado nem coberto por `it.each`.
- **MÉDIO — Webhook delivery**: testes verificam path positivo, redirect, blocked DNS, mas não cobrem:
  - múltiplas tentativas com backoff (retry policy explícita)
  - timeout `ALERTS_WEBHOOK_TIMEOUT_MS` honrado
  - corrupção/truncamento de body grande
- **MÉDIO — Source-map**:
  - Bundle ZIP com sub-pastas, encoding de filename (`apps/api/test/query.test.ts:91-159`) é coberto, mas zip-bomb (decompressed-to-compressed ratio) não tem teste.
  - `apps/api/test/query.test.ts:196` testa rejeição de symlink mas não testa rejeição de paths com `..` codificados em UTF-8 / Unicode.
- **MÉDIO — Migration checksum**: 1 teste (linha 4379). Falta:
  - migration nova com checksum válido mas em ordem errada
  - migration aplicada parcialmente (transação interrompida)
- **MÉDIO — Auth**: Google OAuth tem 4 testes (`apps/api/test/auth.test.ts:77-170`), bons. Mas:
  - Sem teste de session secret rotation/expiry (`/auth/me` com cookie antigo).
  - Sem teste de admin downgrade enquanto sessão está ativa.
  - Sem teste de logout token reuse.
- **BAIXO — Backups**: `apps/worker/test/backups.test.ts` cobre 6 paths mas falta:
  - retry de upload S3 transient (5xx do S3 retornado uma vez, sucesso depois)
  - filename collision (mesmo timestamp no mesmo segundo)

### Qualidade dos testes

#### Asserts fracos

- `apps/console/src/components/SnippetPanel.test.tsx:20-29`: cadeia de `toBeInTheDocument`. Apenas verifica presença textual; não testa que o snippet TypeScript é sintaticamente correto, nem que API key placeholder não aparece como literal "undefined".
- `apps/console/src/components/EventDetailDrawer.test.tsx:28-44`: smoke. Testa `toBeInTheDocument` mas não verifica que campos sensíveis (não há aqui, mas o padrão se repete em LlmCallDetailDrawer) ficam sanitizados.
- `apps/console/src/components/LlmCallDetailDrawer.test.tsx:35-54`: smoke de presença textual.
- `apps/console/src/components/ConsoleModeTabs.test.tsx:11-40`: testa aria-pressed e onChange callback (OK), mas é shallow.
- `apps/console/src/components/SessionTimeline.test.tsx:36-65`: 2 testes só. Cobre loading/error/empty/highlight; falta interação com `nextCursor`/`previousCursor` (existem em `SessionTimelineResponse`).
- `apps/console/src/api/client.test.ts:115`: `await expect(...).resolves.toBeUndefined()` — soft. Aceitável aqui (204 No Content), mas idealmente também checaria fetch headers.
- `packages/queues/test/telemetry-queue.test.ts:37`: `expect(job.id).toBeDefined()` — deveria validar formato (`expect.stringMatching(/^[0-9]+$/)` ou similar) já que BullMQ usa string ids.
- `apps/worker/test/backups.test.ts:326-329`: `await expect(stat(...)).resolves.toBeTruthy()` — não verifica conteúdo, só existência. OK para "still present after prune" mas merecia tamanho/mtime explicito.

#### Mocks excessivos / acoplamento ao mock

- `apps/api/test/admin.test.ts` injeta `auth`, `users`, `adminResources`, `alerts`, `sourceMaps`, `ingestion`, `query` via `buildApp`. Isso é arquitetura por injeção (positivo), mas significa que **a API real nunca exercita o cabeamento de dependências em testes unitários** — só o `e2e.test.ts` valida o caminho real. Risco de drift entre o que `main.ts` injeta e o que os testes injetam.
- `apps/console/src/App.test.tsx`: mock gigante (~70+ métodos no `bootstrapClient`). Mantenha estes em um helper compartilhado para reduzir duplicação. Hoje cada componente test recria seu próprio mock.

#### Falta teardown / risco testcontainer

- `apps/api/test/e2e.test.ts:43-47`: `afterAll` para os containers OK, mas `app.close()`, `queue.obliterate`, `queue.close` e `db.destroy` estão dentro de `try/finally` no único `it`. Se um segundo `it` for adicionado, o app/db/queue serão reabertos sem garantia de reset. Refatorar para `beforeEach`/`afterEach`.
- `apps/worker/test/telemetry-worker.test.ts` e `apps/worker/test/backups.test.ts`: extensivamente usam stubs sem containers, OK.
- `packages/queues/test/telemetry-queue.test.ts:19-22`: cleanup OK.
- `packages/db/test/repositories.test.ts:107-109`: cleanup OK.

#### Testes lentos / flaky

- `packages/db/test/repositories.test.ts` é o gargalo natural — testcontainers + Postgres + 70+ casos. O `vitest.config.ts:12` define `testTimeout: 30_000` que pode ser insuficiente quando o container pull demora.
- `apps/api/test/e2e.test.ts:207`: timeout de 90s para 1 teste — apropriado mas pesado para CI.
- Worker testes com timers (`apps/worker/test/telemetry-worker.test.ts:1322-1396` heartbeat scheduler, 607-685 retention scheduler) usam `vi.useFakeTimers` corretamente.

#### Faltam testes de contrato SDK↔API

- `packages/sdk/test/contract.test.ts` (138 linhas) é estritamente local: valida que o output do SDK passa pelos schemas Zod do `@signal-hub/telemetry/ingestion-schemas`. **Não envia request real** para uma API construída pelo `buildApp`.
- O único caminho que faz isso é `apps/api/test/e2e.test.ts` e cobre só `event`. Severidade: **ALTO** para garantir que o SDK e os endpoints continuem alinhados em todos os 6 sinais.

### Cross-cutting

- **Duplicação**: cada teste do console reconstrói `cleanup` no `afterEach` (`apps/console/src/components/*.test.tsx`). Existe `apps/console/src/test/setup.ts` mas só estende `expect` com matchers — não centraliza `cleanup()`.
- **Helpers reutilizáveis ausentes**:
  - Nenhum `buildAppForTests()` helper compartilhado em `apps/api/test/`. Cada arquivo recria suas dependências.
  - Nenhum factory builder de Postgres test container compartilhado entre `apps/api/test/e2e.test.ts` e `packages/db/test/repositories.test.ts` — duas declarações independentes.
  - `createMultipartPayload` em `apps/api/test/admin.test.ts:42-73` deveria estar em `apps/api/test/helpers/multipart.ts`.
- **Setup global vs por arquivo**: `vitest.config.ts:11` aplica `setupFiles: ["apps/console/src/test/setup.ts"]` globalmente. O setup importa `@testing-library/jest-dom`, que é inofensivo em Node mas adiciona overhead. Aceitável mas idealmente condicional via `environmentMatchGlobs`.
- **jsdom vs node por package**: configurado corretamente em `vitest.config.ts:9` (`["apps/console/**/*.test.tsx", "jsdom"]`). Os outros pacotes ficam em Node. OK.
- **Aliases proliferaram**: `vitest.config.ts:14-40` tem 20+ aliases. Indica que TypeScript `paths` ou um workspace mais limpo poderia substituir. Não é teste-bug, é manutenção. INFORMATIVO.

### Documentação ↔ Código

#### CRÍTICO

- **`PRD.md:243` declara `POST /v1/logs`** como deliverable de Phase 1. Não existe rota nem job kind no código (`apps/api/src/routes/ingestion.ts`, `apps/worker/src/telemetry-worker.ts`). README.md:24 menciona "no stored log telemetry", mas o PRD não foi atualizado.
- **`PRD.md:484` lista "logs: 30 days"** como retention; mas em `.claude/docs/SECRETS.md:37` e `README.md:69-77` o que existe é `RETENTION_BREADCRUMBS_DAYS=30`. PRD desatualizado.
- **`PRD.md:822-849` "Suggested Stack"** lista ClickHouse, Cloudflare R2, MinIO, Recharts, shadcn/ui, TanStack Query. Implementação real (`STACK.md`): Postgres puro, Kysely, sem chart deps, sem TanStack, sem shadcn (a UI usa CSS próprio e `lucide-react` apenas). DECISIONS.md (`Phase 1 Runtime Shape`) justifica a divergência, mas o PRD permanece ambíguo. Severidade: **ALTO**.

#### ALTO

- **`PRD.md:451-457` "Initial channels"** lista email, webhook, telegram, discord, whatsapp. Implementação real: apenas **generic webhook** (`apps/api/src/routes/admin.ts`, `apps/console/src/components/AlertsPanel.tsx`). `PROJECT-SUMMARY.md:50` corretamente declara "Native email, Telegram, Discord ... out of scope" — PRD não foi sincronizado.
- **`PRD.md:462-475` "Data governance"** lista campos a mascarar (incluindo `cpf`, `credit_card`). O sanitizador atual (`packages/telemetry/src/sanitization.ts`) precisa ser auditado contra essa lista para confirmar — sanitization.test.ts cobre `authorization`, `password`, `api_key` mas não confirma explicitamente `cpf`/`credit_card`/`cookie`. Severidade: **ALTO** (afirmação no PRD não verificada por teste).

#### MÉDIO

- **`PRD.md:226` Phase 1 "analytical storage"** — implementação usa Postgres operacional, não há separação analítica. DECISIONS.md justifica, mas o termo "analytical" no PRD pode confundir leitores novos.
- **`PRD.md:301-413` Phase 3 "Operational Console"** descreve "Users" tela com "estimated cost for that user" entre outras. A implementação tem isso (UsersInvestigationPanel), porém a tela **"Settings"** em `PRD.md:318` não aparece no console real — não há `SettingsPanel.tsx`. Setup workspace e Artifacts substituem partes, mas não 1:1.
- **`README.md:198-209` Docker Compose Setup**: instrui `pnpm run doctor` antes de `docker compose up`. Doctor (em `scripts/doctor.ts`) faz checagens read-only; OK. Mas `pnpm install` precisa de Node 22 e pnpm 9.15.x — README.md:28-30 lista isso porém **não menciona que o `.env` deve ser preenchido antes do `pnpm install`** (na verdade não precisa, mas a ordem do passo 4 "Edit .env" vs passo 5 "Install" no `README.md:151-163` é local-dev, não Compose). Possível confusão para operador novo.
- **`.claude/docs/DEPLOYMENT.md:155`** menciona `pnpm dev:console`. Confirmado em `package.json:9`. OK.
- **`.claude/docs/STACK.md:48` lista `pnpm test` e `pnpm build`** mas omite `pnpm run doctor`, `pnpm db:migrate`, `pnpm backup:create`, `pnpm backup:restore`, `pnpm seed:admin`, `pnpm dev:console`, `pnpm build:console`. Todos existem em `package.json:7-22`. INFORMATIVO.
- **`README.md:500-505` Release Baseline** diz `pnpm test`, `pnpm build`, `docker compose config --quiet`, `pnpm run doctor`. `CLAUDE.md` lista ainda `pnpm --filter @signal-hub/sdk build`. Pequena inconsistência: CLAUDE.md tem comando adicional para SDK.

#### BAIXO

- **`.claude/docs/PROJECT-SUMMARY.md:23` "Read-only Events investigation workspace"** — capacidades enumeradas batem com componentes e tests.
- **`.claude/docs/UI-UX.md:25` "Filters apply only when the operator clicks Apply"** — testado em `EventInvestigationPanel.test.tsx`, `UsersInvestigationPanel.test.tsx:230`, `EntitiesInvestigationPanel.test.tsx:352`. OK.
- **`.claude/docs/DECISIONS.md:3-7` "Store source maps locally"** — implementado e coberto em `apps/api/test/query.test.ts:159-388` e `apps/api/test/admin.test.ts:366-640`.
- **`.claude/docs/INFRASTRUCTURE.md:40-42` "Source-map storage does not use object storage"** — confirmado pelo código.

### Stubs e features incompletas

- **PRD.md:434 "rate limiting"** — registrado em `app.ts:56` mas sem teste. (Repetido na seção Cobertura.)
- **PRD.md:434 "daily aggregations"** — não há sistema de aggregations diárias separadas; apenas computadas on-demand (`/query/aggregates/*`). Não documentado como descoped.
- **PRD.md:466 `cpf` masking** — não confirmado por teste; ver Documentação ↔ Código (ALTO).

### Onboarding

#### O que um dev novo encontra ao seguir `README.md`

1. Pre-requisitos claros: Node 22, pnpm 9.15.x, Docker. (README.md:26-30) — OK.
2. `.env.example` (`README.md:34`) — existe com 44 variáveis (`.env.example:1-44`). Mapeado em `SECRETS.md`. OK.
3. `pnpm install` (passo 3) → `docker compose up -d postgres redis` (passo 4) → `pnpm db:migrate` (passo 5) → `pnpm seed:admin` → `pnpm dev:api`/`pnpm dev:worker` (passos 6). **Não inclui o console**: o operador precisa rodar `pnpm dev:console` separadamente (mencionado apenas em `DEPLOYMENT.md:155`). MÉDIO.
4. `pnpm run doctor` aparece em `Docker Compose Setup` (README.md:204) mas é **apresentado depois do "Local Development"**; um dev iniciante pode pular. INFORMATIVO.
5. README contém exemplos curl completos para login, criar projeto/ambiente/api-key e enviar cada signal (`README.md:262-444`). EXCELENTE.

#### Pontos atritados

- Para conseguir levantar tudo localmente sem Docker, o dev precisa de **Postgres 16 e Redis 7** instalados localmente. README assume Docker para essas deps (`README.md:165-169`). Aceitável.
- `BOOTSTRAP_ADMIN_PASSWORD` precisa de ≥ 32 chars em produção (`SECRETS.md:24`). O `.env.example:14` traz `change-me-admin-password-32-chars-min` (32 chars exatos com hyphen) — funciona para teste mas é placeholder. Doctor valida (`scripts/doctor.test.ts:91-100`).

---

## Lista de gaps PRD ↔ código

| PRD | Status no código | Severidade |
|---|---|---|
| `PRD.md:243` `POST /v1/logs` | **AUSENTE** — sem rota nem handler | ALTO |
| `PRD.md:484` `logs: 30 days` retention | Substituído por `breadcrumbs: 30 days` | MÉDIO |
| `PRD.md:822-849` Stack ClickHouse / R2 / MinIO / Recharts / shadcn / TanStack | Não implementado; Postgres only, sem chart libs | ALTO (PRD desatualizado) |
| `PRD.md:451-457` Channels email/telegram/discord/whatsapp | Apenas generic webhook | ALTO (PRD desatualizado) |
| `PRD.md:434` Rate limiting | Registrado em app.ts:56 mas sem teste | ALTO |
| `PRD.md:434` Daily aggregations | Não implementado (apenas on-demand aggregates) | MÉDIO |
| `PRD.md:434` Backup | Implementado (`apps/worker/src/backups.ts`) | OK |
| `PRD.md:434` SignalHub self-health panel | Implementado (`apps/console/src/components/SystemHealthPanel.tsx`) | OK |
| `PRD.md:434` Sensitive data masking | Implementado em worker; teste cobre subset, falta `cpf`/`credit_card` explicitos | ALTO |
| `PRD.md:434` Configurable retention | Implementado e coberto (`apps/worker/test/telemetry-worker.test.ts:479+`) | OK |
| `PRD.md:264-296` SDK `track`, `identify`, `captureError`, `startTrace`, `endTrace`, `span`, `llm`, `flush` | Implementado e testado em `packages/sdk/test/client.test.ts` | OK |
| `PRD.md:318` Console "Settings" screen | Inexistente; substituído por Setup + Artifacts; PRD ambíguo | BAIXO |
| `PRD.md:493-526` Phase 4.x "advanced evals" | Out of scope (Phase 6+), conforme PRD | OK |
| `PRD.md:528-544` "Intelligent error grouping" listado como future | **Implementado**: error_groups, fingerprints, status workflow em código real (`packages/db/src/repositories/error-groups.ts`); excede o PRD | OK / EXCEDE |
| `PRD.md:576-589` "Well-resolved source maps" como future | **Implementado** (`apps/api/src/source-maps/`); excede o PRD | OK / EXCEDE |
| `PRD.md:546-573` Session replay | Não implementado (breadcrumbs + session timeline são subset) | OK (deferido conforme PROJECT-SUMMARY.md:46) |

---

## Recomendações priorizadas

1. **CRÍTICO** — Adicionar teste de rate limit em `apps/api/test/ingestion.test.ts` (envio em loop > 1000/min ou stub do limiter para validar reply 429).
2. **ALTO** — Atualizar `PRD.md` para refletir: remoção de `/v1/logs`, stack real, canais reais, error-grouping/source-maps já implementados. Idealmente versionar (`PRD v0.3`).
3. **ALTO** — Adicionar teste explícito que sanitization redige `cpf`, `credit_card`, `cookie` em `packages/telemetry/test/sanitization.test.ts` para honrar `PRD.md:466`.
4. **ALTO** — Estender `apps/api/test/e2e.test.ts` para `error`, `llm`, `trace`, `span`, `breadcrumb` em formato `it.each` ou suite separada.
5. **ALTO** — Criar `apps/console/src/components/ErrorSourceMapResolution.test.tsx` para garantir que `sourcesContent` nunca é renderizado (assert negativo).
6. **MÉDIO** — Adicionar testes HTTP de multi-tenancy: request a `/query/events?project_id=B` enquanto sessão+verificações estão escopadas a `A`.
7. **MÉDIO** — Criar `apps/api/test/helpers/buildApp.ts` para reduzir duplicação de dependências mock e diminuir risco de drift com `main.ts`.
8. **MÉDIO** — Adicionar teste de idempotência: 2× `processTelemetryJob` com mesmo `id` não deve resultar em 2 linhas em `events`/`errors`/etc.
9. **MÉDIO** — Cobrir `OverviewKpiGrid`, `OverviewMiniTrends`, `SpanTimeline` com testes próprios.
10. **MÉDIO** — Atualizar `.claude/docs/STACK.md` para listar todos os scripts de `package.json` (atualmente só lista subset).
11. **BAIXO** — Centralizar `cleanup()` do React Testing Library em `apps/console/src/test/setup.ts` para eliminar boilerplate.
12. **BAIXO** — Substituir `expect(job.id).toBeDefined()` em `packages/queues/test/telemetry-queue.test.ts:37` por validação de formato concreto.
13. **INFORMATIVO** — Adicionar nota em `README.md` (seção Local Development) sobre `pnpm dev:console` ao lado de `pnpm dev:api` e `pnpm dev:worker`.

---

## Apêndice: arquivos consultados

- `/home/user/SignalHub/vitest.config.ts`
- `/home/user/SignalHub/README.md`
- `/home/user/SignalHub/PRD.md`
- `/home/user/SignalHub/CLAUDE.md`
- `/home/user/SignalHub/.env.example`
- `/home/user/SignalHub/package.json`
- `/home/user/SignalHub/.claude/docs/PROJECT-SUMMARY.md`
- `/home/user/SignalHub/.claude/docs/ARCHITECTURE.md`
- `/home/user/SignalHub/.claude/docs/STACK.md`
- `/home/user/SignalHub/.claude/docs/DEPLOYMENT.md`
- `/home/user/SignalHub/.claude/docs/CONSTRAINTS.md`
- `/home/user/SignalHub/.claude/docs/DECISIONS.md`
- `/home/user/SignalHub/.claude/docs/SECRETS.md`
- `/home/user/SignalHub/.claude/docs/INFRASTRUCTURE.md`
- `/home/user/SignalHub/.claude/docs/UI-UX.md`
- 50 arquivos `*.test.ts(x)` no escopo da auditoria
- Componentes em `apps/console/src/components/` (49 .tsx)
- Rotas em `apps/api/src/routes/` (8 .ts)
- Workers em `apps/worker/src/` (6 .ts)
- Repositórios em `packages/db/src/repositories/` (12 .ts)
