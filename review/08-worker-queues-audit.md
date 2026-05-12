# Auditoria 08 — Worker e Filas (BullMQ / Telemetry)

Escopo: `apps/worker/src/*.ts`, `apps/worker/test/*.ts`, `packages/queues/src/telemetry-queue.ts`, repositórios `dead-letter.ts`, `telemetry-writes.ts`, `error-groups.ts`, e `apps/api/src/routes/ingestion.ts`.

Data: 2026-05-12 (fase 5C — Session Timeline & Breadcrumbs).

---

## 1. Sumário

O worker é uma única instância BullMQ que consome a fila `telemetry` e processa seis tipos de payload (`event`, `error`, `llm`, `trace`, `span`, `breadcrumb`), além de orquestrar quatro side-jobs em ticks de timer (`retention`, `alerts`, `backups`, `heartbeat`) e um backfill inicial de `error_groups`. A arquitetura é coerente, com locks advisory por subsistema e schedulers que evitam sobreposição local. No entanto, há lacunas materiais e estruturais:

- **Concurrency padrão (1) implícita** e nenhum `rateLimiter` configurado — sem paralelismo configurável, o throughput máximo é determinado pelo BullMQ default e qualquer pico precisará drenar serialmente. (ALTO)
- **Idempotência ausente** — inserts são puros `INSERT` sem `ON CONFLICT`, e o BullMQ está com `attempts: 5`. Em retries (após falha transiente do banco) o mesmo `job.id` (UUID gerado pela API) pode produzir duplicatas em `events`, `llm_calls`, `traces`, `spans`, `breadcrumbs`. Em `errors`, o `error_group_id` cresce indefinidamente (incremento de occurrence_count, recálculo de stats). (CRÍTICO)
- **Dead Letter Queue grava registros mas não há replay nem leitura** — sem rota administrativa para inspecionar/reprocessar, sem limite de tamanho, e o insert é fire-and-forget (`void`). (ALTO)
- **Sem `jobId` explícito na enfileiragem** — `queue.add(payload.kind, payload)` deixa BullMQ gerar identificador, então deduplicação por job na fila é impossível mesmo que o consumer fosse idempotente. (ALTO)
- **`removeOnFail: false`** mantém jobs falhados em Redis indefinidamente — vetor de exaustão de memória do Redis. (ALTO)
- **Retries fixos com backoff exponencial e sem distinção entre erros transientes e validação Zod** — payload inválido percorre 5 tentativas e só então vai à DLQ; gasto desnecessário de CPU e Redis. (MÉDIO)
- **API rejeita ingestão com 503 em qualquer erro de `enqueue`/`verifyApiKey`**, sem circuit breaker nem fila local, e sem backpressure por tamanho da fila. (MÉDIO)
- **Backup e retention são schedulers separados que podem rodar concorrentemente entre si** — só há lock contra outras instâncias do mesmo subsistema, não entre si. Retenção concorrente com `pg_dump` pode produzir backup parcial. (MÉDIO)
- **Webhook de alerta sem retry** — uma única tentativa de POST; falha 5xx não reentra na fila. (ALTO)
- **`processTelemetryJob` lança em `Zod.parse` e o erro pode ir à DLQ com payload original** — não há "poison-pill detection" rápida. (MÉDIO)
- **`shutdown` chama `worker.close()` em paralelo com schedulers e em seguida `connection.quit()` — não há grace period nem timeout máximo**. Jobs em execução não têm garantia de drain bounded. (ALTO)
- **Conexão Redis compartilhada com schedulers internos sem reuso explícito** — apenas uma instância de `Redis(connection)` que é injetada no Worker; isso é OK, mas heartbeat/retention usam DB e não Redis, então não há contaminação. (INFORMATIVO)
- **`backfillErrorGroupsUntilDrained` é disparado sem `await` na inicialização** — não bloqueia worker start, mas qualquer erro só vai a `console.error`. Se falhar repetidamente em loop hot, pode rodar para sempre. (MÉDIO)

---

## 2. Tabela de Achados

| # | Severidade | Área | Local | Resumo |
|---|-----------|------|-------|--------|
| F-01 | CRÍTICO | Idempotência | `packages/db/src/repositories/telemetry-writes.ts:99-145,147-213` | `INSERT` sem `ON CONFLICT (id)` — retries de BullMQ podem inserir o mesmo job 2x |
| F-02 | CRÍTICO | Idempotência | `packages/db/src/repositories/telemetry-writes.ts:110-145` + `error-groups.ts:159-245` | `insertError` retry incrementa `occurrence_count` repetidamente e refaz `refreshErrorGroupStats` |
| F-03 | ALTO | Config BullMQ | `apps/worker/src/main.ts:58-64` | `Worker` criado sem `concurrency`, `lockDuration`, `stalledInterval`, `maxStalledCount` |
| F-04 | ALTO | Config BullMQ | `packages/queues/src/telemetry-queue.ts:30-32` | `removeOnFail: false` — jobs falhados acumulam em Redis indefinidamente |
| F-05 | ALTO | Config BullMQ | `packages/queues/src/telemetry-queue.ts:22-33` | Sem `rateLimiter`, sem `priority`, sem `jobId` explícito |
| F-06 | ALTO | DLQ | `apps/worker/src/main.ts:164-186` | DLQ é fire-and-forget (`void insertDeadLetterJob`), sem retry, sem limite, sem replay |
| F-07 | ALTO | Alertas | `apps/worker/src/alerts.ts:146-166` + `193-292` | Webhook único POST sem retry; 5xx ou timeout = entrega permanentemente perdida |
| F-08 | ALTO | Shutdown | `apps/worker/src/main.ts:194-222` | `shutdown` sem grace timeout; `Promise.allSettled` mistura `worker.close()` com schedulers |
| F-09 | ALTO | Backpressure | `apps/api/src/routes/ingestion.ts:115-119` | API responde 503 binário; sem fila de aceitação, sem circuit breaker, sem métrica de queue depth |
| F-10 | MÉDIO | Idempotência | `packages/queues/src/telemetry-queue.ts:36-38` | `enqueueTelemetryJob` não passa `jobId: payload.id` — sem deduplicação na fila |
| F-11 | MÉDIO | Retries | `packages/queues/src/telemetry-queue.ts:24-29` | `attempts: 5` aplicado a TODO erro, inclusive ZodError não-retriable |
| F-12 | MÉDIO | Retention | `apps/worker/src/retention.ts:24-56` + `packages/db/src/repositories/system.ts:169-187` | Deleta `errors` antes de `error_groups`/`error_stack_resolutions` — risco com `ON DELETE CASCADE`/órfãos |
| F-13 | MÉDIO | Concorrência scheduler | `apps/worker/src/main.ts:74-158` | Retention, alerts, backups, heartbeat compartilham o mesmo `db` pool sem coordenação inter-subsistemas |
| F-14 | MÉDIO | Backfill | `apps/worker/src/main.ts:66-68` | `backfillErrorGroupsUntilDrained` rodando em loop pode ficar preso se `selected == batchSize` perpetuamente |
| F-15 | MÉDIO | Backup | `apps/worker/src/backups.ts:201-253` | `pg_dump` exec dentro do lock session; um lock travado bloqueia toda janela |
| F-16 | MÉDIO | Backup | `apps/worker/src/backups.ts:136` | `throw new Error("pg_dump failed")` esconde stderr do `pg_dump`, dificulta troubleshooting |
| F-17 | MÉDIO | Observabilidade | `apps/worker/src/main.ts:160-190` | Logs com `console.info/error` puros, sem level estruturado, sem job duration, sem métrica |
| F-18 | MÉDIO | Heartbeat | `apps/worker/src/heartbeat.ts:1-33` | Sem TTL/timeout no `beat()`; um insert lento bloqueia heartbeat até concluir |
| F-19 | MÉDIO | Worker resilience | `apps/worker/src/main.ts:188-190` | `worker.on("error")` apenas loga; conexão Redis perdida não recupera nem encerra |
| F-20 | BAIXO | DLQ | `packages/db/src/repositories/dead-letter.ts:35-49` | Falha em `insertDeadLetterJob` apenas logada; job e contexto perdidos |
| F-21 | BAIXO | Alertas | `apps/worker/src/alerts.ts:97-138` | Erro em `recordAlertEvent` é capturado mas `updateRuleEvaluation` ainda é chamado — evento perdido mas cooldown calculado |
| F-22 | BAIXO | Sanitização | `apps/worker/src/telemetry-worker.ts:54-68` | `buildDeadLetterJobInput` sanitiza payload, mas não sanitiza `job.name`/`queueName` |
| F-23 | INFORMATIVO | Config | `packages/queues/src/telemetry-queue.ts:30` | `removeOnComplete: 1000` baixo — limita inspeção pós-execução |
| F-24 | INFORMATIVO | Backups | `apps/worker/src/backups.ts:298-301` | Sanitização de credenciais ok no `sanitizeBackupError`, mas não captura outras URLs com `:password@` em logs paralelos |

---

## 3. Detalhes dos Achados

### F-01 — CRÍTICO — `INSERT` sem cláusula de idempotência

`packages/db/src/repositories/telemetry-writes.ts:99-108` (insertEvent), `147-165` (insertLlmCall), `167-179` (insertTrace), `181-199` (insertSpan), `201-213` (insertBreadcrumb). Todos são `db.insertInto(...).values(...).execute()` simples. O `id` vem do payload do job (gerado em `apps/api/src/routes/ingestion.ts:106` por `createId(prefix)`), mas não há `onConflict` na inserção.

Cenário concreto:
1. Worker pega job `evt_X`, executa `insertEvent`.
2. A inserção comita no Postgres mas a resposta TCP se perde (rede, NIC, oom kill).
3. BullMQ marca o job como `failed` por timeout/lock e enfileira retry (`attempts: 5` em `packages/queues/src/telemetry-queue.ts:25`).
4. Próximo run executa `insertEvent` de novo → PK violation, ou se PK não exigir unicidade total (em tabelas com PK textual) → exceção que vai a DLQ.

Como `id` é PK textual em todas as tabelas afetadas (`packages/db/migrations/0001_initial.sql:26-30, 39-46, 53-66, 71-89, 94-116, 121-137, 140-163`), a 2ª tentativa irá falhar com violação de unicidade — efeito: job vai à DLQ com `error_message: 'duplicate key value violates unique constraint'`, MESMO TENDO SIDO PROCESSADO COM SUCESSO.

Recomendação (não aplicada): usar `onConflict(oc => oc.column("id").doNothing())` em todos os inserts, ou capturar `unique_violation` (SQLSTATE `23505`) e tratá-lo como sucesso.

---

### F-02 — CRÍTICO — `insertError` não-idempotente: corrompe contadores de `error_groups`

`packages/db/src/repositories/telemetry-writes.ts:110-145` envolve a inserção em transação que:

1. Chama `upsertErrorGroupForOccurrence` (`error-groups.ts:159-245`) que faz `INSERT ... ON CONFLICT ... DO UPDATE SET occurrence_count = error_groups.occurrence_count + 1` (`linha 229`).
2. Insere o `errors` (sem `onConflict`).
3. Chama `refreshErrorGroupStats` que recalcula stats agregados.

Se o passo 2 falhar com `unique_violation` no retry, o passo 1 já incrementou o contador antes — mas porque está em transação, dá rollback e tudo bem.

**Porém**, se o passo 2 tiver sucesso em uma tentativa que termine com falha externa (timeout TCP de resposta), o retry inteiro será replayed: a `transaction` será nova, o `errors.id` existe → `23505` → rollback do retry. Resultado: 1 erro persistido, 1 ocorrência contabilizada, e 4 retries que falham e ainda assim chega à DLQ. Isso polui DLQ com falsos positivos.

Pior cenário: se um operador "replay" da DLQ for adicionado no futuro sem idempotência, o reprocessamento vai inflar `occurrence_count` indefinidamente.

`refreshErrorGroupStats` (`error-groups.ts:329-355`) RECALCULA a partir da tabela `errors`, então neste momento o contador é auto-corrigível — mas isso não cobre o caso de erro entre passos 1 e 3.

---

### F-03 — ALTO — Worker sem `concurrency` nem ajuste de lock

`apps/worker/src/main.ts:58-64`:

```ts
const worker = new Worker<TelemetryJobPayload, void, TelemetryJobPayload["kind"]>(
  "telemetry",
  async (job) => { await processTelemetryJob(job.data, writer); },
  { connection }
);
```

Sem `concurrency`, BullMQ usa default 1 (processamento serial). Em projeto com ingestão moderada (~100 events/s), uma única instância serializada é gargalo. Não há configuração via env nem fanout horizontal documentado.

Adicionalmente, `lockDuration` (default 30s), `stalledInterval` (default 30s), `maxStalledCount` (default 1) ficam implícitos — qualquer `processTelemetryJob` que demore mais de 30s perde lock, é reenfileirado, e após 1 stall vai a `failed`. Como `insertError` envolve transação com upsert + refresh stats, em cenários de erro group com muitas occurrences o tempo pode passar dos 30s.

---

### F-04 — ALTO — `removeOnFail: false` permite Redis OOM

`packages/queues/src/telemetry-queue.ts:31`:

```ts
removeOnFail: false
```

Jobs falhados permanecem em Redis indefinidamente. Em cenário de erro sistêmico (DB indisponível por 1h, ~360k jobs falhados em fila a 100 ev/s), Redis pode estourar memória. Não há TTL nem limite por count.

Mesmo com DLQ Postgres, os jobs failed continuam em Redis (BullMQ não remove ao escrever em DLQ — o DLQ aqui é apenas registro paralelo).

---

### F-05 — ALTO — `defaultJobOptions` incompleto

`packages/queues/src/telemetry-queue.ts:22-33` não configura:

- `rateLimiter` — sem proteção contra burst (ex.: erro flood)
- `priority` — todos os tipos competem igualmente; um burst de breadcrumbs degrada erros críticos
- `jobId` — ver F-10
- `delay` / `lifo` — irrelevante mas vale documentar
- `keepLogs` — sem log de tentativas individuais em Redis

---

### F-06 — ALTO — DLQ é write-only e fire-and-forget

`apps/worker/src/main.ts:175-185`:

```ts
void insertDeadLetterJob(db, buildDeadLetterJobInput({...}))
  .catch((deadLetterError: unknown) => {
    console.error(`Failed to record dead-letter job ${job.id ?? "unknown"}`, deadLetterError);
  });
```

Problemas:
1. **`void` sem await**: o handler `worker.on("failed", ...)` retorna antes da inserção completar; se a aplicação morrer entre `failed` e o `await insertDeadLetterJob`, o registro de DLQ é perdido.
2. **Sem retry da inserção em DLQ**: a falha apenas é logada e o evento sumiu definitivamente.
3. **Sem endpoint admin / console route** para listar `dead_letter_jobs` (verificado: `grep -rn "dead_letter\|listDeadLetter" apps/`, apenas o insert existe).
4. **Sem limite de tabela** — `dead_letter_jobs` pode crescer sem limite (não consta em retention policy de `packages/config/src/index.ts:167-177`).
5. **Sem replay**: não há mecanismo para reenfileirar um DLQ na fila telemetry.

A DLQ atualmente é apenas um log estruturado de "deu errado", não uma fila recuperável.

---

### F-07 — ALTO — Webhook de alerta sem retry

`apps/worker/src/alerts.ts:146-166`:

```ts
for (const pending of lockResult.result.pendingDeliveries) {
  let delivery: DeliveryResult;
  try {
    delivery = await runtime.deliver(pending.channel, pending.payload);
  } catch (error) {
    console.error(`Alert webhook delivery ${pending.eventId} failed`, error);
    continue;
  }
  // ...
}
```

Uma única tentativa, sem backoff, sem retry. Se o destino retornar 5xx, timeout (`timeoutMs: 5000`), ou DNS falhar, o alerta nunca mais é reenviado — `recordDelivery` apenas registra `status: "failed"`. O ciclo de avaliação seguinte verá o `lastTriggeredAt` recente e entrará em cooldown (`alerts.ts:492-497`), **suprimindo o disparo subsequente que poderia reenviar**.

Combinado com `ALERTS_WEBHOOK_TIMEOUT_MS` default 5000ms e `cooldownMinutes` típico (30min), uma falha transiente do destino significa perda de até 30 minutos de alertas.

---

### F-08 — ALTO — Shutdown sem timeout/grace bounded

`apps/worker/src/main.ts:194-222`:

```ts
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const stopResults = await Promise.allSettled([
    stopBackups(), stopAlerts(), stopRetention(), stopHeartbeat(),
    worker.close()
  ]);
  const resourceResults = await Promise.allSettled([connection.quit(), db.destroy()]);
  // ...
}

process.once("SIGINT", (signal) => {
  void shutdown(signal).finally(() => process.exit(0));
});
```

Problemas:

1. **Sem timeout máximo**: se `worker.close()` ficar pendente (job em loop infinito), o processo fica preso até o orquestrador (Compose/K8s) usar SIGKILL.
2. **`worker.close()` chamado em paralelo com `stopBackups`**: `worker.close(true)` faz drain + close, mas a chamada default não é `force`. Combinado com schedulers fechando, o pool DB pode ser destruído enquanto um job em transação ainda usa.
3. **`db.destroy()` antes do drain final**: ordering frágil. Se `worker.close()` ainda aguarda um job ativo que usa `writer.insertEvent(db, ...)`, o `db.destroy()` em paralelo invalida a conexão.
4. **Sem unref nem `process.exit` guard**: se algum stop rejeitar, o `finally(() => process.exit(0))` ainda força saída — mas a saída pode ocorrer com escrita em curso.

`heartbeat.ts:28-33` aguarda `activeBeat`, ok. Os schedulers em `retention.ts:92-97`, `backups.ts:289-294`, `alerts.ts:484-489` aguardam `activeRun` — ok individualmente. Falta é o orchestration order.

---

### F-09 — ALTO — Backpressure inexistente no API

`apps/api/src/routes/ingestion.ts:115-122`:

```ts
try {
  await ingestion.enqueue(job);
} catch {
  return reply.status(503).send({ error: "ingestion_unavailable" });
}
return reply.status(202).send({ accepted: true, id });
```

Problemas:

1. **Sem circuit breaker**: se Redis cair, cada request espera o timeout completo do BullMQ antes de 503, esgotando connection pool do Fastify.
2. **Sem inspeção de queue depth**: não há rejeição precoce baseada em `queue.getWaitingCount()` para evitar enfileirar quando worker está atrasado horas.
3. **Não diferencia tipos de erro**: timeout Redis vs rejeição de Lua script vs ECONNREFUSED — todos viram 503 genérico.
4. **Sem header `Retry-After`** no 503, dificultando comportamento de SDK cliente.
5. **Sem rate-limit por API key** (escopo F-05 do worker, mas relevante para o handoff).

---

### F-10 — MÉDIO — `enqueueTelemetryJob` não usa `jobId: payload.id`

`packages/queues/src/telemetry-queue.ts:36-38`:

```ts
export async function enqueueTelemetryJob(queue: TelemetryQueue, payload: TelemetryJobPayload) {
  return queue.add(payload.kind, payload);
}
```

Sem terceiro argumento `{ jobId: payload.id }`. Consequências:

1. BullMQ gera ID autoincremental, então a mesma `payload.id` pode entrar 2x se a API enviar duplicado (retry de SDK cliente, por exemplo).
2. Deduplicação em fila (feature nativa BullMQ via `jobId`) é desabilitada.
3. Combinado com F-01, eventos duplicados não são prevenidos nem em Redis nem em DB.

Recomendação não aplicada: `queue.add(payload.kind, payload, { jobId: payload.id })`.

---

### F-11 — MÉDIO — `attempts: 5` aplicado uniformemente

`packages/queues/src/telemetry-queue.ts:24-29`:

```ts
attempts: 5,
backoff: { type: "exponential", delay: 1000 }
```

`processTelemetryJob` em `apps/worker/src/telemetry-worker.ts:100-198` chama `*.parse(job.payload)` (Zod). Se o payload for inválido (corrupção de SDK, evolução de schema sem retro-compat), o erro NÃO é transiente — mas BullMQ tentará 5 vezes (com backoff 1s, 2s, 4s, 8s, 16s = 31s) antes de DLQ. Isso desperdiça CPU, Redis I/O, e atrasa a observação real do problema.

Não há distinção entre `ZodError` (não-retriable) e `DatabaseError` (retriable).

---

### F-12 — MÉDIO — Retention pode quebrar referência `errors → error_groups`

`packages/db/src/repositories/system.ts:169-187` deleta de `events`, `errors`, `traces`, `spans`, `llm_calls`, `breadcrumbs` por `timestamp`. Mas:

- `errors.error_group_id` (FK em `0005_error_groups.sql:42-47`) referencia `error_groups(id, project_id, environment_id)` sem `ON DELETE CASCADE`. A deleção de `errors` é OK (não viola FK pois é o errors que aponta), porém:
- `error_groups` continuam existindo após todos seus `errors` serem removidos por retenção, com `occurrence_count` desatualizado e `latest_error_id` apontando para PK órfã (não FK formal mas valor inválido).
- `error_stack_resolutions` (`0006_source_maps.sql:29`) tem `error_id text NOT NULL REFERENCES errors(id) ON DELETE CASCADE` — funcional mas a `CASCADE` opera por linha, o que com `batch_size = 1000` por loop x 25 batches = 25.000 linhas por tabela por ciclo pode ser pesado.

Não há cleanup de `error_groups` órfãos no retention scheduler.

---

### F-13 — MÉDIO — Schedulers concorrentes podem se atrapalhar

`apps/worker/src/main.ts:74-158` inicializa 4 schedulers (retention, alerts, backups, heartbeat). Cada um tem seu próprio advisory lock (`packages/db/src/repositories/system.ts:9`, `alerts.ts:22`, `backups.ts:8`), garantindo que múltiplas instâncias de worker não rodem o MESMO subsistema simultaneamente.

**Porém**: dentro de uma mesma instância, nada impede:
- Retention rodando `deleteExpiredTelemetry` (com 25 batches x 6 tabelas = potencialmente longo) ao mesmo tempo que backup `pg_dump`. O `pg_dump` faz snapshot consistente mas concorrente com DELETE pode causar bloat ou WAL inchado.
- Heartbeat (a cada 30s) durante retention longa: rouba uma conexão do pool — não problema sério mas válido.

Não há ordering/lock cross-subsystem.

---

### F-14 — MÉDIO — Backfill pode loopar

`apps/worker/src/telemetry-worker.ts:34-52`:

```ts
while (true) {
  const result = await backfill({ batchSize });
  // ...
  if (result.selected < result.batchSize) {
    return { processed, selected, batches };
  }
}
```

Saída acontece quando `selected < batchSize`. Mas `result.selected` é "quantos foram pegos do SELECT", e `processed` é "quantos foram realmente atualizados (sem race)". Em cenário onde duas instâncias de worker startam simultaneamente e cada uma processa metade dos rows do batch, AMBAS observam `selected == batchSize` indefinidamente até esgotar a fila de `errors` com `error_group_id is null`.

Em prática, isso vai eventualmente parar quando os rows acabarem, mas não há limite máximo de iterações, e em loop hot a workload no DB é constante. Sem `console.info` de progresso (apenas `console.error` em falha — `main.ts:67`).

---

### F-15 — MÉDIO — Backup mantém lock durante `pg_dump`

`apps/worker/src/backups.ts:201-233` faz tudo (mkdir, dumpDatabase, stat, upload S3, prune local, recordBackupRun) dentro de `runtime.withLock`. O `withBackupLock` em `packages/db/src/repositories/backups.ts:124-137` usa `pg_advisory_lock` session-level (não transaction) e mantém uma conexão Postgres ocupada durante TODO o ciclo — incluindo o `pg_dump` que dura minutos/horas.

Problemas:

1. Uma conexão do pool fica reservada durante todo o backup.
2. Se o processo morrer durante `pg_dump`, o lock só será liberado quando o backend Postgres detectar que a sessão caiu (timeout TCP, varia entre minutos).
3. Outras tentativas de backup ficam bloqueadas em `pg_try_advisory_lock`, mas isto é desejado.

Aceitável mas vale documentar o trade-off (lock session vs xact).

---

### F-16 — MÉDIO — `pg_dump failed` esconde causa

`apps/worker/src/backups.ts:133-137`:

```ts
try {
  await execFileFn("pg_dump", args, options);
} catch {
  throw new Error("pg_dump failed");
}
```

O stderr/stdout do `pg_dump` é capturado por `promisify(execFile)` mas o catch descarta tudo. Operadores em troubleshooting vão ver apenas `backup failed` em `backup_runs.error_message`. Bom para sanitização (não vaza senhas, embora `sanitizeBackupError` em `backups.ts:297-301` já cubra isso) mas péssimo para debug.

---

### F-17 — MÉDIO — Observabilidade limitada

`apps/worker/src/main.ts:160-190`:

```ts
worker.on("completed", (job) => { console.info(`Processed telemetry job ${job.id ?? "unknown"} (${job.name})`); });
worker.on("failed", (job, error) => { console.error(`Telemetry job ${job?.id ?? "unknown"} failed`, error); ... });
worker.on("error", (error) => { console.error("Telemetry worker error", error); });
```

Problemas:

1. `console.info/error` sem estrutura — não é JSON, não inclui `timestamp`, `level`, `service`, `traceId`.
2. Sem job duration (`processedOn - timestamp`).
3. Sem métrica/contador de jobs por kind, sucessos, falhas.
4. Sem export para Prometheus / OpenTelemetry.
5. Heartbeat apenas grava em DB (`upsertHeartbeat`), nada exposto via HTTP.

---

### F-18 — MÉDIO — Heartbeat sem timeout próprio

`apps/worker/src/heartbeat.ts:13-23`:

```ts
const send = () => {
  if (stopped || activeBeat) return;
  activeBeat = input.beat()
    .catch((error) => { console.error("Worker heartbeat failed", error); })
    .finally(() => { activeBeat = null; });
};
```

`beat()` resolve para `upsertHeartbeat(db, ...)` (`main.ts:71`). Se Postgres ficar lento (60s+), o `activeBeat` fica pendente, `send` é skipped a cada 30s, e o heartbeat efetivamente para — mas `getHeartbeat` (consumido em `system.ts:122-133` por health checks externos) vai ler timestamps stale e julgar o worker morto, podendo desencadear alertas falsos.

Recomendação não aplicada: timeout interno em `beat()` (ex.: `Promise.race` com `setTimeout`).

---

### F-19 — MÉDIO — Erro de Worker apenas logado

`apps/worker/src/main.ts:188-190`:

```ts
worker.on("error", (error) => {
  console.error("Telemetry worker error", error);
});
```

`worker.on("error")` é emitido em falhas de Redis (perda de conexão, auth fail, script Lua corrompido). Apenas logar não recupera nem encerra. O `Redis(connection)` em `main.ts:45-47` tem `maxRetriesPerRequest: null` (bom para BullMQ), mas se a conexão cair indefinidamente, o worker fica zumbi — heartbeat continua mas processamento para.

Não há health-check interno que valide "consigo processar?" antes de declarar saúde via heartbeat.

---

### F-20 — BAIXO — Falha de insertDeadLetterJob silenciosa

Ver F-06. `apps/worker/src/main.ts:182-185` apenas loga `Failed to record dead-letter job ${job.id}` e descarta o payload. Não há fallback (escrita em disco, push para Redis com TTL, retry).

---

### F-21 — BAIXO — Alerta perdido mas cooldown atualizado

`apps/worker/src/alerts.ts:135-138`:

```ts
} catch (error) {
  console.error(`Alert rule ${rule.id} evaluation failed`, error);
  await runtime.updateRuleEvaluation({ ruleId: rule.id, evaluatedAt: now });
}
```

Se `recordAlertEvent` (passo `linha 112`) falhar APÓS `evaluateRule` retornar `observedValue >= threshold`, o catch acima atualiza `evaluatedAt` SEM `triggeredAt`. Boa — não entra cooldown. Mas se a falha for em `updateRuleEvaluation` (linha 122), o evento foi gravado, mas o `lastTriggeredAt` da rule não foi atualizado — próximo tick verá a mesma janela e pode disparar de novo. Combinado com F-07, gera potencial duplicação de webhook.

---

### F-22 — BAIXO — `buildDeadLetterJobInput` não sanitiza nomes

`apps/worker/src/telemetry-worker.ts:54-68`:

```ts
return {
  queueName: input.queueName,
  jobName: input.jobName,
  payload: sanitizeValue(input.payload),
  errorMessage: sanitizePreviewText(errorMessage) ?? "unknown_error"
};
```

`queueName` e `jobName` vêm de `job.queueName` e `job.name` (BullMQ), que são strings controladas pela aplicação. Não é vetor sério, mas se um operador puder definir nomes dinâmicos no futuro, vale sanitizar.

---

### F-23 — INFORMATIVO — `removeOnComplete: 1000`

`packages/queues/src/telemetry-queue.ts:30`. Mantém últimos 1000 jobs completos em Redis. Para volumes altos (10k/s) isso some em ~100ms — não dá tempo de inspecionar manualmente. Ajustar conforme observability strategy.

---

### F-24 — INFORMATIVO — Sanitização de URL parcial

`apps/worker/src/backups.ts:297-301`:

```ts
function sanitizeBackupError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const withoutUrlCredentials = message.replace(/([a-z][a-z0-9+.-]*:\/\/)([^:\s/@]+):([^@\s/]+)@/gi, "$1$2:[REDACTED]@");
  return sanitizePreviewText(withoutUrlCredentials) ?? "backup failed";
}
```

Cobre `proto://user:pass@host`, mas não cobre token em query string (`?api_key=...`) nem padrões customizados. `sanitizePreviewText` provavelmente cuida disso via regex de senhas — não verificado neste audit.

---

## 4. Seções por Tópico

### 4.1 Config BullMQ

- **Filename**: `packages/queues/src/telemetry-queue.ts`
- **Connection**: `maxRetriesPerRequest: null` — correto para BullMQ.
- **defaultJobOptions**:
  - `attempts: 5` — OK em magnitude, mas aplicado sem distinção de tipo de erro (F-11).
  - `backoff: exponential, delay: 1000ms` — razoável (1s, 2s, 4s, 8s, 16s).
  - `removeOnComplete: 1000` — INFORMATIVO (F-23).
  - `removeOnFail: false` — ALTO (F-04).
  - **Faltam**: `rateLimiter`, `priority`, `jobId`, `keepLogs` (F-05, F-10).
- **Worker** (`apps/worker/src/main.ts:58-64`): sem `concurrency`, `lockDuration`, `stalledInterval`, `maxStalledCount` (F-03).
- **Job ID / Deduplicação**: `enqueueTelemetryJob` ignora `payload.id` (F-10).

### 4.2 Idempotência

- **Telemetry writes**: F-01 (CRÍTICO) — TODOS os inserts (`events`, `llm_calls`, `traces`, `spans`, `breadcrumbs`) sem `ON CONFLICT`. PK textual `id` provoca `23505` em retry.
- **Errors + Error groups**: F-02 (CRÍTICO) — `upsertErrorGroupForOccurrence` é idempotente individualmente, mas a transação completa não é. Refresh stats (`error-groups.ts:329-355`) recalcula via SELECT real, então a tabela `error_groups` se auto-corrige; perigo está no retry que vê PK colidida.
- **Alert events / deliveries**: F-21 — Alert sem dedupe por janela. Cooldown protege parcialmente mas evento duplicado é possível em caso de falha mid-flight.
- **Job IDs em fila**: F-10 — sem `jobId: payload.id`.

### 4.3 Dead Letter Queue

- **Schema**: `packages/db/src/schema.ts:210-217` e migração `0001_initial.sql:166-173`.
- **Insert path**: `apps/worker/src/main.ts:164-186` — fire-and-forget, F-06 (ALTO).
- **Reading / Replay**: NÃO EXISTE. Verificado em `apps/api/src/routes/` e `apps/console/src/`.
- **Limite de tamanho**: NÃO EXISTE. `dead_letter_jobs` não consta em `RETENTION_*` envs (`packages/config/src/index.ts:68-79`).
- **Sanitização**: F-22 (BAIXO).
- **Falha do próprio DLQ**: F-20 (BAIXO).

### 4.4 Backpressure

- **API → fila**: F-09 (ALTO) — sem circuit breaker, sem queue-depth check, sem `Retry-After`.
- **Redis lotando**: F-04 (ALTO) — `removeOnFail: false` pode estourar memória.
- **Worker → DB**: sem pool size override, depende do `createDb` default. Não testado neste audit, mas heartbeat (30s), retention (60min), alerts (1min), backups (24h) compartilham pool.
- **Rejeição em pico**: API só rejeita em erro de `enqueue()` (F-09), não em pressão.

### 4.5 Retention

- **Cron**: timer `setInterval` (não cron real). `apps/worker/src/retention.ts:88-90` — 1s startup + `intervalMinutes * 60 * 1000` período.
- **Sem overlap interno**: `activeRun` flag (`retention.ts:74-87`) garante sem dupla execução local.
- **Sem overlap entre instâncias**: `withRetentionLock` usa `pg_try_advisory_xact_lock` (`system.ts:79-98`).
- **DELETE em batch**: `system.ts:135-167`, `batch_size` configurável (default 1000), `maxBatches` 25. Bom.
- **FK considerada**: F-12 (MÉDIO) — `error_groups` não é limpo; `error_stack_resolutions` cascateia OK.
- **Tabela ausente**: `dead_letter_jobs` não é retencionada — risco a longo prazo.
- **Recording**: `recordRetentionRun` em `system.ts:189-224` registra successo/falha; ordem em `retention.ts:30-43` garante recording mesmo em erro.
- **Erro em audit recording**: tratado em test (`telemetry-worker.test.ts:568-604`), mas no path real, falha de `recordRetentionRun` em sucesso propaga e não há fallback.

### 4.6 Backups

- **Schedule**: `apps/worker/src/backups.ts:286-287` — `setInterval(intervalHours * 3600 * 1000)`, default 24h. Não há fast-forward para horário fixo do dia.
- **Lock**: F-15 (MÉDIO) — `pg_advisory_lock` session-level mantida durante `pg_dump`.
- **`pg_dump`**: shell exec, F-16 (MÉDIO) — stderr descartado.
- **Upload S3**: read stream + PutObject; `body.destroy()` no `finally` (`backups.ts:163-165`) — OK.
- **Prune local**: `pruneLocalBackups` em `backups.ts:170-190` apaga arquivos antigos por mtime + pattern matching. Bom.
- **Concorrência com retention**: F-13 (MÉDIO) — possível simultânea com retention.
- **Falha → recordBackupRun**: `backups.ts:237-252` registra failed com `sanitizeBackupError`. F-24 (INFORMATIVO).
- **Trigger manual**: `BackupTrigger = "scheduled" | "manual"` — caminho manual existe (não testado neste audit).

### 4.7 Heartbeat

- **Cadência**: `workerHeartbeatIntervalMs = 30_000` (`heartbeat.ts:1`).
- **Persistência**: `upsertHeartbeat` em `system.ts:100-120` — `INSERT ... ON CONFLICT (component) DO UPDATE`. OK.
- **TTL**: NÃO HÁ TTL DEFINIDO — consumidor (`getHeartbeat`, `system.ts:122-133`) lê o último timestamp; cabe ao consumer julgar staleness. Recomendação: documentar threshold (ex.: > 90s = unhealthy).
- **Sem timeout próprio**: F-18 (MÉDIO).
- **Sem overlap**: `activeBeat` flag (`heartbeat.ts:11`) — OK.
- **Drain on shutdown**: `await activeBeat` (`heartbeat.ts:31`) — OK.

### 4.8 Alerts

- **Schedule**: `alerts.ts:481-482` — `setInterval(intervalMinutes * 60_000)`, default 1min.
- **Lock**: `withAlertEvaluationLock` em `packages/db/src/repositories/alerts.ts:608-622` — `pg_try_advisory_xact_lock`. Bom.
- **Cooldown**: `isInCooldown` (`alerts.ts:492-497`) — calcula `lastTriggeredAt + cooldownMinutes * 60_000`.
- **Dedup**: por rule + cooldown. Janela duplicada gera evento se cooldown estourou — não há dedupe por payload.
- **Canais**: webhook único; F-07 (ALTO).
- **SSRF protection**: extensiva em `alerts.ts:176-191, 224-243, 406-437, 518-590` — boa cobertura de IPs privados (IPv4, IPv6, mapped IPv4 sobre IPv6). Testes em `telemetry-worker.test.ts:911-944, 1072-1175`.
- **Timeout**: `ALERTS_WEBHOOK_TIMEOUT_MS` (default 5000), aplicado via `AbortController` + `setTimeout` (`alerts.ts:245-246`) e em `requestHttpWebhook`/`requestHttpsWebhook` via `request.destroy` (`alerts.ts:358-360, 394-396`).
- **Retries**: NÃO HÁ (F-07 ALTO).
- **Redirect handling**: `redirect: "manual"` (`alerts.ts:316`) — bom, evita SSRF via 302.
- **Recording**: `recordDelivery` em `alerts.ts:156-165` — graceful, log em falha.
- **Reservoir de credentials**: `validateWebhookTarget` rejeita URL com user:pass (`alerts.ts:182-184`).

### 4.9 Graceful Shutdown

- **Signal handlers**: `apps/worker/src/main.ts:216-222` — `process.once("SIGINT")` e `process.once("SIGTERM")`.
- **Shutdown function**: F-08 (ALTO) — sem timeout, ordering frágil.
- **Worker close**: `worker.close()` sem `force` — drains in-flight jobs, OK em comportamento.
- **Schedulers stop**: cada `stop*()` aguarda `activeRun` — OK.
- **DB/Redis close**: `connection.quit()` e `db.destroy()` em segundo `Promise.allSettled` (`main.ts:207`). Ordem está OK localmente (após `worker.close`) mas o paralelismo com schedulers é problemático.
- **Idempotência**: `shuttingDown` flag previne re-entrancy. OK.

### 4.10 Observabilidade

- **Logs**: F-17 (MÉDIO) — `console.*` sem estrutura.
- **Métricas**: NÃO HÁ.
- **Tracing**: NÃO HÁ.
- **Health endpoint do worker**: NÃO HÁ. Apenas heartbeat em DB.
- **Job duration**: NÃO REGISTRADO.
- **Queue depth**: NÃO EXPOSTO.

---

## 5. Conclusão e Priorização

**Risco imediato (CRÍTICO)**:
- F-01 e F-02 (idempotência ausente) — duplicatas em retry e DLQ envenenada.

**Risco material (ALTO)**:
- F-03, F-04, F-05 (config BullMQ) — capacidade e Redis OOM.
- F-06 (DLQ não recuperável) — recovery operacional comprometida.
- F-07 (webhook sem retry) — alertas perdidos em janela longa.
- F-08 (shutdown) — perda de dados em deploy/restart.
- F-09 (backpressure API) — degradação não-graciosa.

**Recomendações estratégicas** (não aplicadas, apenas registradas):
1. Adicionar `ON CONFLICT (id) DO NOTHING` em todos os inserts de telemetria.
2. Configurar `concurrency` via env var no worker.
3. Configurar `removeOnFail: { age: 7 * 24 * 3600, count: 10_000 }`.
4. Passar `jobId: payload.id` no `queue.add`.
5. Implementar retry exponencial para webhook de alerta (3 tentativas com backoff).
6. Adicionar rota admin para listar/replay DLQ.
7. Incluir `dead_letter_jobs` no retention scheduler.
8. Adicionar shutdown timeout (ex.: 30s) com `Promise.race`.
9. Adicionar circuit breaker no enqueue da API.
10. Estruturar logs (pino/winston) + métricas (prom-client).
