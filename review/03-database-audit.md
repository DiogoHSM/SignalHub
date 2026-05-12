# Auditoria da Camada de Banco — SignalHub

Escopo: `packages/db/src/schema.ts`, `client.ts`, `migrate.ts`, todas as migrations em `packages/db/migrations/` e todos os repositórios em `packages/db/src/repositories/`.

Data: 2026-05-12

## Sumário Executivo

A camada de banco é, em geral, **bem construída**: queries usam o builder Kysely com parametrização (placeholders `${}` em template tags `sql` são parametrizados pelo driver `pg`); o multi-tenant é consistentemente escopado por `project_id`/`environment_id`; FKs compostas garantem integridade entre `projects`/`environments` e tabelas dependentes; locks advisory protegem retenção, backup e avaliação de alertas; locks compostos `pg_advisory_xact_lock` são usados em migrations.

Pontos fortes:
- Uso ubíquo de timestamps `timestamptz`.
- Índices compostos cobrem o padrão de filtro `(project_id, environment_id, timestamp DESC)` nas tabelas de telemetria.
- Retention faz `DELETE` em lotes (batched) via CTE com `ctid IN (...)`.
- `pg_advisory_lock` distinto por componente (`927380402913` migração, `914` retenção, `915` avaliação de alerta, `916` backup).

Principais riscos:
1. **CRÍTICO** — `migrate.ts` usa `sql.raw(migrationSql)` em arquivos confiáveis, porém em outros pontos `sql.table(tableName)` recebe identificadores controlados pelo código (hardcoded). Não há injeção do usuário, mas qualquer chamada futura com input externo a `deleteExpiredFromTable` torna-se vulnerável (faltam guardas/allowlist).
2. **ALTO** — Migrations são apenas forward-only (nenhum `down`). Migrations destrutivas em 0007 alteram `retention_runs` (`ADD COLUMN ... NOT NULL DEFAULT 30`) sem janela transacional explícita e sem reversão.
3. **ALTO** — Tabela `errors` não tem unique constraint em `id` (é PK), mas a **FK composta para `error_groups`** depende de uma `UNIQUE (id, project_id, environment_id)` em `error_groups` — está coberta, porém faltam composições análogas em `errors` para garantir consistência entre `error_id` referenciado por `error_stack_resolutions` e o escopo (`project_id, environment_id`). `error_stack_resolutions.error_id` referencia somente `errors(id)`, abrindo brecha de violação de escopo.
4. **ALTO** — Várias tabelas de telemetria (`events`, `errors`, `llm_calls`, `traces`, `spans`, `breadcrumbs`) não possuem FK `ON DELETE CASCADE` para `environments`. Apenas `breadcrumbs` tem cascade. Isso impede o arquivamento/exclusão de um environment sem `DELETE` manual em cascata.
5. **ALTO** — Índices ausentes para padrões críticos: `errors(session_id, timestamp)`, `events(session_id, timestamp)`, `llm_calls(session_id, timestamp)`, `traces(session_id, timestamp)`, `errors(user_id|tenant_id)`, `spans(project_id, environment_id, timestamp DESC)`. A query `session-timeline.ts` força full table scan filtrado por `session_id`.
6. **ALTO** — Falta de paginação por cursor em **todas** as listagens (`listEvents`, `listErrors`, `listLlmCalls`, `listTraces`, `listTraceSpans`, `listErrorGroups`). Usa-se apenas `LIMIT`; investigação histórica não é navegável de forma estável.
7. **ALTO** — `numeric/bigint` retornados como `string` são convertidos com `Number(...)` sem validação de overflow em **vários repositórios** (perda de precisão para `cost_usd` agregado ou `count(*)` grande). Só `backups.ts` checa `Number.isSafeInteger`.
8. **MÉDIO** — `insertEvent`, `insertLlmCall`, `insertTrace`, `insertSpan`, `insertBreadcrumb` não validam que `(project_id, environment_id)` apontem para escopo ativo (não arquivado). A FK garante existência mas não estado.
9. **MÉDIO** — `users_active_email_idx` ignora `archived_at IS NOT NULL` ao reusar emails (intencional?), mas permite ataque de timing: dois usuários arquivados podem compartilhar email; lookup por `lower(email)` em `findUserByEmail` é seguro, mas reativação não é prevista.
10. **MÉDIO** — `getOverview` dispara **15+ queries sequenciais** com `await` separados. Há oportunidade clara de paralelização e/ou consolidação em uma única CTE.
11. **MÉDIO** — Operações relacionadas em `recordAlertEvent` + `recordNotificationDelivery` + `updateAlertRuleEvaluation` não estão envelopadas em transação no caminho de scheduler (somente o lock cobre).
12. **MÉDIO** — `JSONB` columns lidas como `unknown` e propagadas para tipos `Record` ou `metadata` sem validação ao ler. Risco de corrupção silenciosa se schema mudar.

---

## Tabela de Achados

| # | Severidade | Categoria | Localização | Resumo |
|---|---|---|---|---|
| F01 | CRÍTICO | SQL Safety | `system.ts:135-148` | `sql.table(tableName)` aceita string sem allowlist; uso atual é seguro mas a função é hot-spot de regressão |
| F02 | ALTO | Migrations | `migrations/*` + `migrate.ts:6-14` | Forward-only, sem `down`, sem reverter `ADD COLUMN NOT NULL DEFAULT` (0007) — risco em rollback |
| F03 | ALTO | Schema/FK | `0006_source_maps.sql:29` | `error_stack_resolutions.error_id REFERENCES errors(id)` (sem incluir scope) — cross-tenant write possível se `error_id` for forçado |
| F04 | ALTO | Schema/FK | `0001_initial.sql:51-164` | `events/errors/llm_calls/traces/spans` sem `ON DELETE` em FK para `environments` — bloqueia exclusão lógica |
| F05 | ALTO | Performance | `0001_initial.sql:175-179` + `0007_breadcrumbs.sql` | Falta de índices em `(project_id, environment_id, session_id)` para errors/events/llm_calls/traces e em `(spans.project_id, environment_id, timestamp DESC)` |
| F06 | ALTO | Performance | `telemetry-query.ts:482-579`, `error-groups.ts:247-290` | Sem paginação cursor — apenas LIMIT; navegação histórica impossível |
| F07 | ALTO | Tipos | `telemetry-query.ts:417-422`, `users-query.ts:143-148`, `entities-query.ts:140-145` | `toNumber` faz `Number(string)` sem checar `isSafeInteger`; perda em counts/cost_usd |
| F08 | ALTO | Performance | `telemetry-query.ts:707-1085` | 15+ queries sequenciais sem paralelização; cada uma faz scan independente do mesmo intervalo |
| F09 | MÉDIO | Consistência | `telemetry-writes.ts:99-213` | Inserts não validam escopo ativo (project/env arquivados aceitam writes) |
| F10 | MÉDIO | Multi-tenancy | `0001_initial.sql:69-90` | `errors` não tem unique (id, project_id, environment_id), forçando o tenant a confiar apenas em PK ao referenciar |
| F11 | MÉDIO | Performance | `error-groups.ts:260-277` | Subqueries `EXISTS` sem joins/index combinado em `errors(error_group_id, tenant_id|user_id)` |
| F12 | MÉDIO | Transações | `alerts.ts:486-545` | Sequência `recordAlertEvent` + `recordNotificationDelivery` + `updateAlertRuleEvaluation` invocada fora de transação atômica no caller |
| F13 | MÉDIO | Tipos | `schema.ts:5-6` | `JsonColumn = unknown` sem narrowing ao ler; uso ubíquo de `metadata: unknown` |
| F14 | MÉDIO | Schema | `0001_initial.sql:1-12` + `0005_error_groups.sql` | `users.id` text PK gerado pela aplicação; `error_groups.id` default `egrp_||hex(...)`. Geração mista (app vs DB) gera surpresas |
| F15 | MÉDIO | SQL Safety | `users-query.ts:194-197`, `entities-query.ts:191-194` | Construção do `LIKE` com `%${trimmed}%` permite caracteres `_` e `%` arbitrários — não escapados (LIKE wildcard injection cosmético, mas leak via DoS de padrão) |
| F16 | MÉDIO | Schema | `0001_initial.sql` | Coluna `errors.status` é `text` sem CHECK, mas `errors.severity` também sem CHECK. Apenas `error_groups` valida via CHECK |
| F17 | MÉDIO | Performance | `system.ts:135-148` | `deleteExpiredFromTable` usa `WHERE ctid in (... order by timestamp asc limit batch)` — `timestamp` index é (project_id, env_id, timestamp DESC); sem filtro de scope dentro da subquery, varredura cobre todo cluster |
| F18 | MÉDIO | Consistência | `error-groups.ts:159-245` | `upsertErrorGroupForOccurrence` faz `INSERT ON CONFLICT` mas o `affected_users_count`/`affected_tenants_count` no INSERT inicial não é atualizado no DO UPDATE — depende de `refreshErrorGroupStats` posterior em loop, custoso e racy se vários workers concorrentes |
| F19 | MÉDIO | Retention | `system.ts:135-167` | DELETE por `timestamp < cutoff` global, sem escopo `project_id` — exclui dados de todos os tenants sob a mesma política; impossível políticas por projeto |
| F20 | MÉDIO | Schema | `0001_initial.sql:166-173` | `dead_letter_jobs` não possui mecanismo de **replay** (nenhum índice em `queue_name`/`created_at`; sem campo de status/replayed_at) |
| F21 | BAIXO | Schema | `schema.ts:8` | `DefaultedInteger` permite `undefined` em `INSERT`; útil mas com side-effects: counter zerado pelo cliente quando deveria preservar valor existente |
| F22 | BAIXO | Schema | `0001_initial.sql:51-164` | Colunas de metadata/properties `JSONB NOT NULL DEFAULT '{}'` em todas as tabelas: bom; mas `errors.context` também é `NOT NULL DEFAULT '{}'`, dificulta consulta condicional vazia |
| F23 | BAIXO | SQL Safety | `error-groups.ts:166-171` | Interpolação de `reopenResolved` (boolean da aplicação) em `sql<boolean>` — OK porque é boolean parametrizado, mas o resultado é template SQL puro que poderia ser pré-compilado |
| F24 | BAIXO | Tipagem | `backups.ts:30-37` | `toSafeSizeBytes` lança em runtime; outras conversões de bigint (count(*)) não fazem o mesmo tratamento |
| F25 | BAIXO | Migrations | `0006_source_maps.sql:1` | IDs `smap_` e `egrp_` em SQL default `gen_random_bytes(12)` — boas, mas inconsistentes com `createId("smap")` chamado também no app code (duplicação de fonte de IDs) |
| F26 | BAIXO | Migrations | `0007_breadcrumbs.sql:1` | Único arquivo que usa `IF NOT EXISTS` e `ALTER ... ADD COLUMN IF NOT EXISTS` (parcial idempotência) — inconsistente com 0001-0006 |
| F27 | INFORMATIVO | Schema | `0001_initial.sql:53` | `events.project_id` referencia `projects(id)` mas FK composta (project_id, environment_id) já cobre — duplicação |
| F28 | INFORMATIVO | Tipagem Kysely | `telemetry-query.ts:584,590,654-657` | Uso de `sql<unknown>` para agregados — força conversões com `toNumber` espalhadas |
| F29 | INFORMATIVO | Index | `0001_initial.sql:179` | `spans_trace_id_idx` não inclui `(project_id, environment_id)` para escopo |
| F30 | INFORMATIVO | Schema | `0001_initial.sql:14-15` | `users_active_email_idx` partial unique on `lower(email)` impede duplicatas, mas reactivation/un-archive não tem migração documentada |

---

## Detalhes por Achado

### F01 — `sql.table(tableName)` sem allowlist (CRÍTICO)

`packages/db/src/repositories/system.ts:135-148`

```ts
async function deleteExpiredFromTable(db: SystemDb, tableName: string, cutoff: Date, batchSize: number): Promise<number> {
  const result = await sql<{ deleted_count: string }>`
    with deleted_rows as (
      delete from ${sql.table(tableName)}
      where ctid in (
        select ctid from ${sql.table(tableName)}
        where timestamp < ${cutoff}
        order by timestamp asc
        limit ${batchSize}
      )
      returning 1
    )
    select count(*)::text as deleted_count from deleted_rows
  `.execute(db);
```

`sql.table()` escapa o identificador, mas aceita qualquer string. Hoje as únicas chamadas usam literais hardcoded (`"events"`, `"errors"`, `"traces"`, `"spans"`, `"llm_calls"`, `"breadcrumbs"`) em `deleteExpiredTelemetry`, então não há injeção real. Porém:
- Não há **TypeScript narrowing** restringindo `tableName: string` a um union literal.
- Se um novo caller passar input externo, o método produzirá `DELETE FROM <qualquer-tabela>`.
- `sql.table` apenas quoteia; uma string como `"users"` deletaria a tabela inteira sob a condição.

Recomendação: substituir o parâmetro por `tableName: 'events' | 'errors' | 'traces' | 'spans' | 'llm_calls' | 'breadcrumbs'` (já permitido pelo tipo `Database`).

### F02 — Migrations forward-only, sem `down`, com ALTER destrutivo (ALTO)

`packages/db/src/migrate.ts:6-14` define apenas a sequência forward. `0007_breadcrumbs.sql:31-33` faz:

```sql
ALTER TABLE retention_runs
  ADD COLUMN IF NOT EXISTS deleted_breadcrumbs integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS breadcrumbs_days integer NOT NULL DEFAULT 30;
```

- Sem reverse migration registrada.
- `NOT NULL DEFAULT 30` é seguro para `ADD COLUMN` (rewrite mitigado pelo Postgres 11+), mas em rollback não há plano. 
- Checksum em `_migrations` previne reordenação, mas não permite revogar — qualquer mudança força `--force-reset` em produção.

### F03 — `error_stack_resolutions.error_id` sem escopo composto (ALTO)

`packages/db/migrations/0006_source_maps.sql:27-49`

```sql
error_id text NOT NULL REFERENCES errors(id) ON DELETE CASCADE,
project_id text NOT NULL,
environment_id text NOT NULL,
...
FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id),
```

A FK composta `(error_id, project_id, environment_id)` para `errors` **não existe**. Pode-se inserir resolução com `error_id` de outro tenant. `replaceErrorStackResolutions` em `source-maps.ts:236-306` faz check em runtime, porém um INSERT direto via SQL ou nova rota burlaria.

Recomendação: criar `UNIQUE (id, project_id, environment_id)` em `errors` (como existe em `error_groups`) e migrar a FK em `error_stack_resolutions` para usar a tripla.

### F04 — Telemetria sem `ON DELETE CASCADE` para environments (ALTO)

`0001_initial.sql:51-164`: `events`, `errors`, `llm_calls`, `traces`, `spans` declaram apenas:

```sql
FOREIGN KEY (project_id, environment_id) REFERENCES environments(project_id, id)
```

— sem `ON DELETE`. Já `breadcrumbs` em `0007_breadcrumbs.sql:21` usa `ON DELETE CASCADE`.

Consequência: tentar deletar um environment falha; soft-delete via `archived_at` resolve o caso operacional, mas qualquer fluxo administrativo de "drop env" não funciona sem deletar manualmente as filhas.

### F05 — Índices ausentes para padrões de filtro (ALTO)

Padrões usados em consultas existentes que **não** têm índice dedicado:

- `events(project_id, environment_id, session_id)` — usado em `session-timeline.ts:81-217`
- `errors(project_id, environment_id, session_id)` — idem
- `llm_calls(project_id, environment_id, session_id)` — idem
- `traces(project_id, environment_id, session_id)` — idem
- `spans(project_id, environment_id, timestamp DESC)` — apenas `spans_trace_id_idx` existe; `listTraceSpans` filtra por env+timestamp
- `errors(project_id, environment_id, error_group_id, timestamp DESC)` — `errors_group_time_idx` é `(error_group_id, timestamp DESC)` sem escopo, força scan global do grupo

Recomendação: adicionar índices compostos correspondentes; `breadcrumbs` já tem o índice correto via `breadcrumbs_scope_session_timestamp_idx`.

### F06 — Listagens sem paginação por cursor (ALTO)

Em `telemetry-query.ts`:
- `listEvents` (482-499), `listErrors` (501-521), `listLlmCalls` (523-543), `listTraces` (545-561), `listTraceSpans` (563-579): só `.limit(...)` com default 50 e max 500.
- `error-groups.ts:247-290` `listErrorGroups`: idem.
- `source-maps.ts:119-134` `listSourceMapArtifacts`: lista tudo, sem limit (potencial unbounded).
- `admin.ts:82-91, 156-166, 226-235`: `listProjects`, `listEnvironments`, `listApiKeys` sem limit (OK se baixa cardinalidade, mas sem garantia).

Apenas `users-query.ts` e `entities-query.ts` implementam cursor encoded em base64url (timeline). Investigação de tracks históricos é impossível além de 500 itens.

### F07 — Conversões `Number()` sem checagem de overflow (ALTO)

`telemetry-query.ts:417-422`:

```ts
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return 0;
}
```

Identica em `users-query.ts:143-148` e `entities-query.ts:140-145`. `count(*)` em Postgres é `bigint`. Tenants ativos com > `2^53` eventos: perda silenciosa de precisão (improvável, mas legítimo); somas de `cost_usd` em `numeric(18, 6)` convertidas via `Number(string)` perdem precisão em valores `> 9.007e9`.

`backups.ts:30-37` é o único lugar com `isSafeInteger` check. Inconsistência clara.

### F08 — `getOverview` faz 15+ roundtrips sequenciais (ALTO)

`telemetry-query.ts:707-1085` executa em ordem:

1. KPI CTE
2. usage trend CTE
3. error trend
4. latency trend
5. ai cost trend
6. top events
7. tenants by usage
8. tenants by errors
9. tenants by llm calls
10. tenants by llm cost
11. llm providers
12. llm models
13. llm prompts
14. error severity
15. error status
16. recent errors
17. recent failed traces
18. recent failed LLM calls

Cada uma com seu próprio `await`. Todas filtram pelo mesmo `(project_id, environment_id, timestamp BETWEEN from AND to)`. Latência total ≈ 18 × RTT. **Recomendação**: `Promise.all` para queries independentes; alternativamente, materializar uma CTE única `scoped_*` por tabela e reusá-la com múltiplos selects.

### F09 — Inserts de telemetria não validam escopo ativo (MÉDIO)

`packages/db/src/repositories/telemetry-writes.ts:99-213`. FK garante existência do par `(project_id, environment_id)`, mas não verifica `projects.archived_at IS NULL AND environments.archived_at IS NULL`. Após arquivar um environment, ingestion continua escrevendo. Compare com `createApiKeyRecord` (`admin.ts:193-224`), que verifica escopo ativo.

Esse check normalmente fica na camada de auth (API key valida o escopo), mas defesa em profundidade no DB seria útil (trigger ou check da aplicação no insert).

### F10 — `errors.id` sem unique composto com escopo (MÉDIO)

Como F03, `errors` não tem `UNIQUE (id, project_id, environment_id)` exigido para FKs compostas seguras. `error_groups` tem isso (`0005_error_groups.sql:33-34`), o que é a boa prática.

### F11 — Subqueries `EXISTS` em `listErrorGroups` (MÉDIO)

`error-groups.ts:260-277`:

```ts
if (filters.tenantId) {
  query = query.where(
    sql<boolean>`exists (
      select 1 from errors
      where errors.error_group_id = error_groups.id
        and errors.tenant_id = ${filters.tenantId}
    )`
  );
}
```

Sem índice em `errors(error_group_id, tenant_id)` ou `errors(error_group_id, user_id)`, força scan de errors por grupo. Para listagem de 500 grupos com filtro tenant, pode resultar em 500 sub-scans.

### F12 — Sequência de alerta sem transação no scheduler (MÉDIO)

`alerts.ts:486-545` (`recordAlertEvent`, `recordNotificationDelivery`, `updateAlertRuleEvaluation`) cada um abre statement separado. Se `withAlertEvaluationLock` (`alerts.ts:608-622`) executa uma transação, OK; mas o caller no `apps/worker` precisa garantir que todos os 3 callsites sejam invocados dentro do mesmo `trx`. Não há type-level enforcement.

### F13 — `JsonColumn` é `unknown` sem narrowing ao ler (MÉDIO)

`schema.ts:5-6`:

```ts
type JsonColumn = ColumnType<unknown, unknown | undefined, unknown>;
```

`metadata`, `properties`, `context`, `data` são lidos como `unknown` e retornados como `unknown` em todos os records. Sem validação Zod/Valibot ao ler, mudanças no shape do JSON corrompem responses do console silenciosamente.

### F14 — Geração mista de IDs (app vs DB default) (MÉDIO)

`error_groups.id` default `('egrp_' || encode(gen_random_bytes(12), 'hex'))` (DB); `source_map_artifacts.id` default `('smap_' || ...)` (DB) **mas** `createSourceMapArtifact` em `source-maps.ts:178` explicitamente passa `id: createId("smap")`. O default existe para inserts via SQL direto; o app sempre sobrescreve. Duplicação de regra de geração.

`error_groups`: o INSERT em `upsertErrorGroupForOccurrence` (`error-groups.ts:172-188`) não passa `id`, então confia no default DB. OK, mas inconsistente.

### F15 — `LIKE` com `%${trimmed}%` sem escape de `%`/`_` (MÉDIO)

`users-query.ts:194-197`, `entities-query.ts:191-194`:

```ts
function searchPattern(search: string | undefined): string | undefined {
  const trimmed = search?.trim();
  return trimmed ? `%${trimmed}%` : undefined;
}
```

Search "a%" vira `%a%%` e ainda é parametrizado; sem injection SQL real. Porém:
- `%` no input força matching all (vazamento de cardinalidade).
- `_` matches qualquer char.
- Buscas pesadas tipo `%%%%%` resultam em sequential scans.

Defesa: `ESCAPE '\'` e replace `%` e `_` por `\%` e `\_`.

### F16 — Faltam CHECKs em colunas enum-like (MÉDIO)

`0001_initial.sql:84-86`:
```sql
severity text NOT NULL,
status text NOT NULL DEFAULT 'open',
```
sem CHECK. Apenas `error_groups`, `alert_rules`, `alert_events`, `backup_runs`, `breadcrumbs` validam via CHECK. Por consistência: `errors.status`, `errors.severity`, `traces.status`, `spans.status`, `llm_calls.status`, `events.name` (nome do evento) deveriam ter validação no DB ou serem desenhados como enum.

### F17 — Retention DELETE sem escopo de projeto (MÉDIO)

`system.ts:135-148`:

```sql
delete from ${sql.table(tableName)}
where ctid in (
  select ctid from ${sql.table(tableName)}
  where timestamp < ${cutoff}
  order by timestamp asc
  limit ${batchSize}
)
```

Sem `WHERE project_id = ...`. Política única global por instância. Não há suporte a TTL por projeto/environment (típico em multi-tenant SaaS). Subquery vê o cluster inteiro; o índice `events_project_env_time_idx (project_id, environment_id, timestamp DESC)` não é o ideal — falta um índice em `(timestamp ASC)` puro para apoiar essa varredura.

### F18 — Upsert + refresh stats em N+1 (MÉDIO)

`error-groups.ts:159-245`: `upsertErrorGroupForOccurrence` faz INSERT ON CONFLICT que **não** atualiza `affected_users_count`/`affected_tenants_count` no DO UPDATE. Depois, `refreshErrorGroupStats` (linhas 329-355) faz `update ... set ... from (select count distinct ... from errors where error_group_id = ${groupId})` — full aggregation sobre todas as occurrences do grupo. Chamado para **cada** insert de erro (`telemetry-writes.ts:143`).

Para grupos com milhões de errors, custo cresce O(N) por insert. Recomendação: incremental update inline no DO UPDATE (já feito para occurrence_count) ou job assíncrono de re-stat periódico.

`backfillErrorGroups` (linhas 357-415) usa `forUpdate` para evitar race, OK.

### F19 — Política de retenção é global (MÉDIO)

Como F17 — sem `project_id` no DELETE. Não há tabela `retention_policies` por projeto. Operadores não podem ter SLAs distintos para tenants.

### F20 — `dead_letter_jobs` sem replay (MÉDIO)

`0001_initial.sql:166-173` cria a tabela; `dead-letter.ts` apenas insere. Sem:
- Índice por `queue_name`/`created_at`
- Campo `status` (pending/replayed/discarded)
- Campo `replayed_at`/`replayed_by`
- Repository function `replayDeadLetterJob`/`listDeadLetterJobs`

Operacionalmente é write-only black hole.

### F21 — `DefaultedInteger` permite undefined em INSERT (BAIXO)

`schema.ts:8`: `DefaultedInteger = ColumnType<number, number | undefined, number>`. Em update, exige `number`. Em insert, opcional. OK para defaults; cuidado para não confundir com nulável.

### F22 — `errors.context NOT NULL DEFAULT '{}'` (BAIXO)

`0001_initial.sql:88`. Tornar contexto sempre `{}` impede queries do tipo "errors sem contexto". Cosmético.

### F23 — Boolean interpolado em SQL template (BAIXO)

`error-groups.ts:166-171`: `${reopenResolved}` (boolean da aplicação) parametrizado em sql tag. OK porque `pg` aceita boolean, mas leitura confusa.

### F24 — `toSafeSizeBytes` é exceção, não regra (BAIXO)

`backups.ts:30-37` lança quando bigint estoura `Number`. Outras conversões (count(*)) não.

### F25 — IDs duplicados em SQL default e app code (BAIXO)

`createSourceMapArtifact` passa `id: createId("smap")` mesmo com default `('smap_' || encode(gen_random_bytes(12), 'hex'))` no DB (migration 0006). Fonte única de geração seria mais clara.

### F26 — Idempotência inconsistente entre migrations (BAIXO)

`0007_breadcrumbs.sql` usa `CREATE TABLE IF NOT EXISTS` e `ADD COLUMN IF NOT EXISTS`. As demais migrations não. O `_migrations` checksum gate evita re-execução, então a idempotência interna é parcialmente útil.

### F27 — FK duplicada em events/errors/etc. (INFORMATIVO)

`0001_initial.sql:53`: `project_id text NOT NULL REFERENCES projects(id)` mais a FK composta `(project_id, environment_id) REFERENCES environments(project_id, id)` cobrem `projects(id)` indiretamente.

### F28 — `sql<unknown>` força conversões (INFORMATIVO)

Em `telemetry-query.ts:584`, `590`, etc.: `sql<unknown>` para retornos de `count(*)`/`sum(...)` força `toNumber` espalhado. Tipagem mais estreita (`sql<string>` para bigint, `sql<number>` quando seguro) reduziria conversões.

### F29 — `spans_trace_id_idx` sem escopo (INFORMATIVO)

`0001_initial.sql:179`: `CREATE INDEX spans_trace_id_idx ON spans(trace_id)`. Sem `(project_id, environment_id, trace_id)`. Em multi-tenant, busca por trace pode degradar.

### F30 — `users_active_email_idx` parcial; reativação não documentada (INFORMATIVO)

`0001_initial.sql:14`: `CREATE UNIQUE INDEX users_active_email_idx ON users(lower(email)) WHERE archived_at IS NULL;`. Permite reusar email após arquivar, mas não há repository function `reactivateUser` — só `archiveUser`.

---

## Schema / Migrations

Pontos confirmados:
- **Timestamps**: todos os campos temporais são `timestamptz` (correto para UTC). Sem ambiguidade.
- **PKs**: todas as tabelas têm PK explícita; `system_heartbeats` usa `component text PRIMARY KEY` (correto para single-row-per-component).
- **JSONB**: `metadata`/`properties`/`context`/`data` são `jsonb NOT NULL DEFAULT '{}'`. Bom para queries com operadores `@>`/`->>` no Postgres. Risco em F13 (ler como `unknown`).
- **Defaults**: usam `now()` para `created_at`/`updated_at`. Identidade dos IDs: alguns gerados pelo app (`createId`), outros pelo DB (`gen_random_uuid()` ou `gen_random_bytes`). Inconsistente (F14).
- **Migrations**: idempotência via `_migrations` checksum (`migrate.ts:18-49`); transação por execução com `pg_advisory_xact_lock(927380402913)` previne migrações concorrentes (OK).
- **Riscos**: F02 (sem down), F03 (FK incompleta), F04 (sem cascade), F16 (sem CHECK em status/severity), F26 (idempotência inconsistente).

Tabelas faltando índices críticos: ver F05 e F11.

## SQL Safety

- **Parametrização**: 100% das queries em todos os repositórios usam `${variable}` em tagged templates `sql\`...\`` (parametrizadas pelo driver `pg` em prepared statements) ou builder Kysely (parametrizado por construção).
- **`sql.raw`**: usado apenas em `migrate.ts:45` para arquivos de migration confiáveis. Conteúdo controlado pelo repositório, **não** input do usuário.
- **`sql.table`**: usado em `system.ts:138, 140` com strings hardcoded — seguro hoje, mas vulnerável a regressão (F01).
- **`sql.ref`**: usado em `telemetry-query.ts:473-474` com constante interna `"timestamp"` — seguro.
- **`sql.join`**: usado em `session-timeline.ts:210` com array sanitizado em runtime via `resolveTypes` que casa contra `DEFAULT_TYPES` (literal type union). Seguro.
- **LIKE patterns**: F15 — não escapados, sem ESCAPE clause.
- **Concatenação de strings**: ausente. Boa prática consistente.
- **Operadores/colunas dinâmicas**: nenhuma controlada pelo usuário.

**Conclusão**: superfície de injeção é nula no fluxo atual. Recomendação preventiva é narrowing de `tableName` em `deleteExpiredFromTable` (F01).

## Performance

Achados de alto impacto: F05 (índices), F06 (sem cursor), F08 (overview sequencial), F11 (EXISTS sub-scan), F17 (retention scan sem escopo), F18 (refresh stats por insert).

Pontos positivos:
- DELETE em lotes com `ctid IN (...)` (excelente padrão Postgres) (`system.ts:135-148`).
- Lateral joins para "última entrega" em `listAlertEvents`/`getAlertEvent` (alerts.ts:571-585, 591-602).
- Uso de `Promise.all` em `getBackupStatus` (`backups.ts:106-110`) e `getIngestionFreshness` (`system.ts:244-250`).

## Transações

- `insertError` em `telemetry-writes.ts:110-145` está corretamente em transação (upsert do grupo + insert do erro + refresh stats).
- `backfillErrorGroups` (`error-groups.ts:357-415`) usa `forUpdate()` para evitar race entre workers.
- `deleteSourceMapArtifact` (`source-maps.ts:196-220`) e `replaceErrorStackResolutions` (`source-maps.ts:236-306`) usam `db.transaction().execute(...)` com locks `forUpdate()` nos artefatos.
- `migrate` (`migrate.ts:17-49`) usa advisory xact lock + transação.
- `withRetentionLock` (`system.ts:79-98`), `withBackupLock` (`backups.ts:124-137`), `withAlertEvaluationLock` (`alerts.ts:608-622`) usam advisory locks distintos (913 migration, 914 retenção, 915 alerta, 916 backup). Bom isolamento.

Lacunas: F12 (caller de alerts pode não usar transação), e `getOverview` (sem snapshot consistente: leituras de tabelas diferentes podem refletir momentos distintos — para um overview isso é aceitável, mas vale documentar).

## Multi-tenancy

Todas as queries de telemetria filtram **explicitamente** por `project_id` e `environment_id`. Auditoria das chamadas mostra:

- `telemetry-query.ts:486-487, 504-507, 525-528, 547-550, 565-568` — `listEvents/Errors/LlmCalls/Traces/Spans` exigem ambos como entrada não-opcional em `TelemetryFilters`.
- `users-query.ts`, `entities-query.ts` — todas as CTEs filtram pelo escopo.
- `session-timeline.ts` — sim.
- `error-groups.ts` — sim, em todas as funções.
- `source-maps.ts:119-134, 152-169, 196-220, 222-234, 236-306` — sim.
- `alerts.ts:160-176` `assertActiveAlertRuleScope` confirma combinação ativa antes de criar regra.
- `admin.ts:193-224` `createApiKeyRecord` valida par ativo.

**Riscos remanescentes**:
- F03: `error_stack_resolutions.error_id` pode apontar para `errors` de outro tenant.
- F11: subqueries `EXISTS` em `listErrorGroups` sub-filtram por tenant_id/user_id corretamente, mas leak via cardinalidade pode ocorrer.

## Retention / Dead-letter / Backups

- **Retention**: F17, F19 — global, batched, com lock advisory; sem políticas por projeto.
- **Dead-letter**: F20 — write-only sem replay.
- **Backups**: bem estruturado. `backup_runs` com `s3_bucket`/`s3_key` opcionais; `size_bytes bigint` com checagem `isSafeInteger` em runtime (F24). `withBackupLock` usa `pg_try_advisory_lock` em conexão session-level (não xact), liberado em finally.

---

## Lista de Queries Suspeitas

Pelas categorias acima:

1. `system.ts:135-148` — `deleteExpiredFromTable`: identificador dinâmico via `sql.table(tableName)`; `DELETE` global sem escopo; subquery scan sem índice ideal.
2. `error-groups.ts:329-355` — `refreshErrorGroupStats`: agregado completo por insert.
3. `error-groups.ts:260-277` — `EXISTS (select 1 from errors ...)` sem índice composto.
4. `telemetry-query.ts:707-1085` — `getOverview`: 18 roundtrips sequenciais.
5. `telemetry-query.ts:482-579` — `listEvents/Errors/LlmCalls/Traces/Spans`: sem cursor.
6. `error-groups.ts:247-290` — `listErrorGroups`: sem cursor.
7. `source-maps.ts:119-134` — `listSourceMapArtifacts`: sem `LIMIT` (potencial unbounded).
8. `users-query.ts:203-312`, `entities-query.ts:200-285` — `listUsersActivity`/`listEntityTenants`: CTE union de 4 tabelas escaneadas duas vezes, ordenação em memória após coleta.
9. `session-timeline.ts:81-217` — `getSessionTimeline`: 5 union all scans por session sem índice em `events/errors/llm_calls/traces(session_id)`.
10. `users-query.ts:194-197`, `entities-query.ts:191-194` — `searchPattern`: LIKE com wildcards do usuário não escapados.
11. `telemetry-writes.ts:99-213` — inserts sem verificação de escopo ativo.
12. `alerts.ts:571-585, 591-602` — `listAlertEvents`/`getAlertEvent`: lateral join correto, mas sem índice em `notification_deliveries(alert_event_id, attempted_at DESC)` — `notification_deliveries_event_idx` existe mas é simples; o lateral join faz sort por `attempted_at desc, created_at desc`.
13. `error-groups.ts:172-244` — `upsertErrorGroupForOccurrence`: CASE/severity ordering inline em SQL; legível mas duplicado em update/select; também ignora `affected_*_count` no DO UPDATE.

---

## Recomendações de Prioridade

Sem alterar código, listo prioridade para um próximo PR:

**P0 (segurança / correção)**
- Restringir `tableName` em `deleteExpiredFromTable` a union literal (F01).
- Adicionar `UNIQUE (id, project_id, environment_id)` em `errors`, migrar FK em `error_stack_resolutions` (F03, F10).
- Adicionar `ON DELETE` strategy nas FKs de telemetria (F04).

**P1 (operação)**
- Migrations reversíveis ou pelo menos `down.sql` documentado (F02).
- Replay mechanism para `dead_letter_jobs` (F20).
- Políticas de retenção por projeto (F17, F19).
- Validação JSON ao ler (F13).

**P2 (performance)**
- Índices compostos para `(project_id, environment_id, session_id)` em events/errors/llm_calls/traces (F05).
- Cursor pagination nas listagens (F06).
- Paralelização de `getOverview` (F08).
- Incremental stats no upsert (F18).
- Checagem `isSafeInteger` em todos os conversores (F07, F24).

**P3 (consistência/qualidade)**
- CHECKs nas colunas enum-like (F16).
- Allowlist + ESCAPE em LIKE (F15).
- Unificar geração de IDs (F14, F25).
- Padronizar idempotência das migrations (F26).
- Tipos `sql<bigint>`/`sql<number>` ao invés de `sql<unknown>` (F28).
- Índices com escopo para `spans` (F29).
