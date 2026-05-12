# SignalHub — Sumário Consolidado da Revisão

> Análise rigorosa do código-fonte realizada em 8 frentes paralelas, focada em segurança, lógica, qualidade, navegação, tratamento de erros, stubs, gaps de documentação e operação. Nenhuma alteração de código foi feita.

## Escopo da análise

| Frente | Arquivo | Achados | Críticos | Altos |
|---|---|---|---|---|
| 1. Segurança (API/Auth/Ingestão) | `01-security-audit.md` | 44 | 2 | 6 |
| 2. Lógica backend e tratamento de erros | `02-backend-logic-errors.md` | 65 | 1 | 12 |
| 3. Camada de banco (Postgres/Kysely) | `03-database-audit.md` | 30 | 1 | 7 |
| 4. Console (frontend React) | `04-frontend-console-audit.md` | 90 | 0 | ~12 |
| 5. SDK | `05-sdk-audit.md` | 21 | 1 | 6 |
| 6. Infra / Deploy / Config | `06-infra-deploy-config-audit.md` | 37 | 4 | 11 |
| 7. Testes e documentação | `07-tests-docs-audit.md` | ~30 | — | vários |
| 8. Worker e filas (BullMQ) | `08-worker-queues-audit.md` | 24 | 2 | 9 |
| **Total** | — | **≈340** | **11** | **≈63** |

Os arquivos detalhados em `review/` contêm tabelas com `path:line`, severidade, descrição, cenário/PoC e recomendação por achado.

---

## Achados CRÍTICOS consolidados (11)

| # | Frente | Local | Resumo |
|---|---|---|---|
| C1 | Segurança | `apps/api/src/routes/admin.ts:329-346` | SSRF gate de webhooks só ativa em `production`; em dev/staging permite chamar `127.0.0.1`, `169.254.169.254` (cloud metadata), AWS IMDS, Redis interno etc. |
| C2 | Segurança | `apps/worker/src/alerts.ts` (validação de URL) | Mesma falha de SSRF gate por `NODE_ENV` no worker que entrega alertas — atacante com admin pode usar webhook como proxy SSRF. |
| C3 | Backend logic | `apps/api/src/main.ts:494` | `await app.listen(...)` sem `try/catch` — falha de bind crasha o processo sem log estruturado nem cleanup de DB/Redis/Queue. |
| C4 | Database | `packages/db/src/repositories/system.ts:135-148` | `deleteExpiredFromTable(tableName: string)` aceita nome de tabela como string sem allowlist. Hoje é seguro (callers hardcoded), mas é hot-spot para regressão futura. |
| C5 | SDK | `packages/sdk/src/client.ts:48-55` / `retry.ts:51-58` | API key vai em `Authorization: Bearer` em SDK que serve browser. Sem separação `@signal-hub/sdk/node` vs `/browser`. Chave acaba em bundles públicos. |
| C6 | Infra | `Dockerfile` | Container roda como `root` (sem `USER` non-root). |
| C7 | Infra | `docker-compose.yml:7,41,63` | Aceita `signalhub-local-only-change-me` como senha padrão do Postgres. Sai como default operacional. |
| C8 | Infra | (ausência) `.github/workflows/` | Não existe CI/CD configurado — sem lint/test/build/scan automatizado. |
| C9 | Infra | `scripts/backup-create.ts` | Backups sem compressão eficaz, sem criptografia, sem checksum/verificação de integridade. |
| C10 | Worker/queues | `packages/db/src/repositories/telemetry-writes.ts:99-213` | `INSERT` sem `ON CONFLICT` — retries do BullMQ produzem `unique_violation` em jobs já processados, jogando para DLQ telemetria válida. |
| C11 | Worker/queues | `telemetry-writes.ts` (insertError + upsertErrorGroup) | `insertError` não é idempotente; interação com `upsertErrorGroupForOccurrence` em transação pode duplicar contadores em retry. |

---

## Temas transversais (cross-cutting)

### 1. Observabilidade quase nula
- `Fastify({ logger: false })` em `apps/api/src/app.ts:41` — API não loga requests, erros, latência. (Frente 2 F02, frente 1 F-08, frente 7)
- Worker usa `console.*` — sem nível, sem contexto, sem formato estruturado. (Frente 8)
- Sem métricas Prometheus/OpenTelemetry mesmo sendo um produto de observabilidade. Reentrância irônica.
- Nenhum `setErrorHandler` no Fastify — handlers padrão expõem stack traces. (Frente 1 F-08, frente 2)

### 2. Erros engolidos sistematicamente
- Padrão `} catch { return reply.status(503).send({error: "...unavailable"}) }` repetido em 40+ pontos em `routes/admin.ts`, `routes/query.ts`, `routes/alerts.ts`, `routes/system.ts`, `routes/ingestion.ts`. Nada é logado. Operar em produção sem APM externo será cego. (Frente 2)
- Frontend faz o mesmo: 401/403/404/409/422/500 colapsam em "unavailable" idêntico no console. (Frente 4 F-28)

### 3. Multi-tenant boundary frágil em alguns cantos
- `error_stack_resolutions.error_id` referencia somente `errors(id)` sem incluir `(project_id, environment_id)` (DB F03).
- Source-map resolver pode cruzar tenants em cenário de mapa compartilhado (Segurança F-19).
- Lockout admin não previsto: `findSessionUser` ignora `archivedAt` em users (Backend Logic).

### 4. Idempotência e duplicação de telemetria
- BullMQ pode reenviar jobs (stalled, network failure). Worker não declara `concurrency`/`lockDuration`. Inserts em telemetry sem `ON CONFLICT`. (Worker C10/C11, Backend Logic)
- `enqueueTelemetryJob` não passa `jobId: payload.id` para deduplicação na fila.

### 5. Falta de retry/timeout em integrações externas
- `fetch` Google OAuth sem `AbortSignal.timeout` (Backend Logic).
- `pg_dump` sem timeout (Backend Logic + Infra).
- Upload S3 sem timeout.
- Webhook de alerta sem retry — combinado com cooldown pode perder até 30min de alertas (Worker F-altos).

### 6. Shutdown não-graceful
- API: `Promise.allSettled([app.close(), queue.close(), redis.quit(), db.destroy()])` em paralelo — fecha Redis/DB enquanto requests em voo ainda usam (Backend Logic).
- Worker: shutdown sem timeout bounded — pode pendurar para sempre se um job travar (Worker).

### 7. Hardening de produção ausente
- Sem headers de segurança (CSP, HSTS, X-Frame-Options, X-Content-Type-Options). (Segurança F-08)
- CORS default-deny — bom, mas sem cookie `__Host-` prefix.
- `tsconfig.base.json` sem `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`.
- Container Docker como root, sem HEALTHCHECK, sem tini, sem `pnpm prune --prod`. (Infra)

### 8. Performance / escalabilidade DB
- Zero paginação por cursor em endpoints de listagem grandes (DB F06).
- `getOverview` faz 18 queries sequenciais por chamada (DB F08).
- Índices compostos `(project_id, environment_id, session_id)` ausentes em events/errors/llm_calls/traces (DB F05).
- Retenção sem cleanup de `error_groups` órfãos.
- DLQ é write-only — sem replay, sem retention, sem alerta de crescimento. (Worker)

### 9. Stubs visíveis no produto
- APIs de revoke/update/archive de API keys, users, alert rules, channels existem no `api/client.ts` mas **não há UI** que as chame (Frontend F-15/17/18/35).
- `googleOAuthEnabled` é fetcheado de `/console/config` mas nunca consumido na UI (Frontend F-26).
- Sem roteamento — reload da página sempre volta para Setup, perde deep links (Frontend F-08).
- Drawers sem `role="dialog"`, sem foco, sem escape, sem botão "Fechar" (Frontend F-44).

### 10. Documentação ≠ código
- `PRD.md:243` lista `POST /v1/logs` — não existe (já é breadcrumb).
- `PRD.md:822-849` cita stack ClickHouse/R2/MinIO/Recharts/shadcn/TanStack — nenhum em uso real.
- `PRD.md:451-457` promete canais email/telegram/discord — só webhook genérico implementado.
- `PRD.md:466` exige sanitização de `cpf`/`credit_card`/`cookie` — não testada.
- `STACK.md:48` lista subset incompleto dos scripts do `package.json`.
- README não menciona `pnpm dev:console`.

---

## Pontos positivos (confirmados)

A análise também identificou áreas sólidas que vale preservar:

- **Sem SQL injection** real — todas as queries Kysely/`sql\`...\`` são parametrizadas. Auditoria linha a linha confirmou.
- **Argon2id** em senhas com parâmetros adequados; `timingSafeEqual` em sessão e API keys.
- **Path traversal e ZipSlip bem mitigados** em source-maps: `safeSegment`, `validateStoragePath` com `realpath` + `lstat` para symlinks, `assertInsideLocalDir`.
- **DNS rebinding tratado** no worker quando em produção (com defeito de só agir em prod — ver C2).
- **CORS default-deny** (`origin: false` se não configurado).
- **Source-map resolver não expõe `sourcesContent`** — alinhado com a constraint do PRD.
- **Sanitização defensiva no SDK** com `WeakSet` para ciclos, `enforcePayloadSize` fail-closed, `TextEncoder` para bytes.
- **Concorrência de flush no SDK bem resolvida** (`inFlightFlush` + `pendingFlushAfterActive`).
- **Migrações idempotentes** com checksum + advisory lock (913, 914, 915, 916 — distintos por área).
- **`forUpdate()`** em backfill/source-map writes.
- **`packages/db/test/repositories.test.ts`** (4.389 linhas) com PostgreSqlContainer real cobrindo cross-scope rejection, locks, fingerprints, retenção.
- **`apps/worker/test/telemetry-worker.test.ts`** cobre DNS-rebinding, credenciais em URL, reserved tokens, cooldowns, advisory lock skip.
- **Console**: nenhum `dangerouslySetInnerHTML`, `eval`, `Function()`, tokens em localStorage. `credentials: "include"` consistente. `encodeURIComponent` em todos os path segments.
- **`scripts/backup-restore.ts`** exige `--yes` obrigatório.
- **Graceful shutdown** existe (SIGINT/SIGTERM) em API e Worker — mesmo com defeitos.
- **Healthchecks de Postgres/Redis** no Compose; bind em `127.0.0.1` para serviços de dados.
- **Doctor** redige segredos no output.

---

## Top 10 priorizado para remediação

Combinando severidade × esforço × blast radius:

1. **Corrigir validação SSRF para sempre bloquear ranges privados (não só em prod)** — `routes/admin.ts` + `worker/alerts.ts`. Acrescentar `100.64.0.0/10`, multicast, IPv6 broader. Resolver DNS antes de bater. **(C1, C2)**
2. **Adicionar `ON CONFLICT (id) DO NOTHING`** em todos os inserts de telemetria + passar `jobId: payload.id` ao enfileirar. Retries de BullMQ deixam de poluir DLQ. **(C10, C11)**
3. **Habilitar logger Fastify estruturado** + `setErrorHandler` global. Decidir entre pino simples e algo com redact. Crítico antes de qualquer release. **(transversal Tema 1, 2)**
4. **Container non-root + HEALTHCHECK + tini** no `Dockerfile`. Remover senha placeholder do `docker-compose.yml`. Pipeline CI mínimo (`.github/workflows/ci.yml` com lint/test/build). **(C6, C7, C8)**
5. **Backups com compressão real + checksum + criptografia opcional**. Verificar integridade no restore. **(C9)**
6. **Separar SDK em `@signal-hub/sdk/node` vs `@signal-hub/sdk/browser`** ou aplicar modelo de proxy (sem chave no cliente). **(C5)**
7. **try/catch no `app.listen`** + propagar erro com log estruturado e shutdown limpo. **(C3)**
8. **Allowlist explícita em `deleteExpiredFromTable`** para travar a regressão. **(C4)**
9. **Shutdown sequencial em ordem segura**: `app.close()` → drenar fila → `queue.close()` → `redis.quit()` → `db.destroy()`, com timeout bounded. **(transversal Tema 6)**
10. **Hardening de headers**: `helmet`-style (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) + cookie `__Host-` prefix. **(Segurança F-08)**

---

## Recomendações operacionais

- Defina uma **release "0.1.1" focada em hygiene** antes de promover Phase 5C como completa. Custos baixos para resolver C3, C4, C6, C7, C8, e o pacote 1/2/3 acima.
- Configure **APM externo** (Sentry, Honeycomb, Datadog ou self-hosted) antes de remover `logger: false` para não comer disco com logs verbosos.
- Crie um **runbook de incidentes** baseado nos achados de retenção/DLQ/heartbeat — hoje não há documentação de "DLQ está crescendo, e agora?".
- Atualize `PRD.md` removendo features não implementadas (ClickHouse, R2, MinIO, canais email/telegram/discord, `POST /v1/logs`) ou marque-as como **roadmap future**.
- Considere **mover stubs de UI para feature flags** explícitos — hoje há endpoints sem UI que dão a impressão de funcionalidade pronta.
- Adicione **testes 429** para `@fastify/rate-limit` e **testes E2E para os outros 5 sinais** (hoje só `event`).

---

## Como navegar os relatórios

Cada arquivo `review/0N-*.md` tem:

- **Sumário executivo** — visão de 30 segundos
- **Tabela de achados** com ID, severidade, `path:line`, descrição curta
- **Detalhe por achado** — descrição, impacto, cenário/PoC, recomendação
- **Seções por área** dentro daquela frente

Para reproduzir os PoCs de segurança, ver `01-security-audit.md` seção "Detalhes por achado".  
Para reproduzir gaps de UX, ver `04-frontend-console-audit.md` seção "Componentes".  
Para o impacto operacional de DB/queue, combinar `03-database-audit.md` + `08-worker-queues-audit.md`.

---

## Notas de método

- Análise estática, sem execução de testes nem build. Nenhum arquivo de código foi alterado.
- 8 sub-agentes paralelos, cada um focado em uma frente, com prompts independentes e sem visão do trabalho dos outros (cross-validation espontânea).
- Citações `path:line` são contra a árvore atual do branch `claude/code-audit-analysis-TXGMt`.
- Severidade é qualitativa (CRÍTICO / ALTO / MÉDIO / BAIXO / INFORMATIVO) e considera impacto × probabilidade × visibilidade.
- Algumas falhas de "engolir erro silenciosamente" foram contadas como um único achado transversal em vez de listadas individualmente, para não inflar números.
