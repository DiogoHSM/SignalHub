# Revisão de Backend — Lógica, Tratamento de Erros e Completude

Escopo: `apps/api/src/`, `apps/worker/src/`, `packages/queues/src/`, `packages/telemetry/src/`.
Data: 2026-05-12.

---

## 1. Sumário executivo

O backend está bem estruturado, tipado e usa Zod para validação na fronteira (ingestão, admin, queries). Os principais riscos observados se concentram em três temas:

1. **Erros engolidos sem contexto.** Há um padrão sistemático nas rotas `query`, `alerts`, `system`, `admin` e `source-maps` de capturar qualquer exceção com `} catch {` e responder 503 genérico. Falhas de banco, falhas de programação (TypeError, RangeError), violações de constraint e timeouts ficam todas mascaradas como `query_unavailable`/`source_maps_unavailable`/etc., sem log, sem stack e sem possibilidade de alarme operacional. Como o Fastify está com `logger: false` e não há `setErrorHandler`, essa é a única fonte de visibilidade — e ela está cega.
2. **Operações de I/O sem timeout.** Chamadas a Google OAuth (`fetch`), a `pg_dump` (worker), ao Postgres (Kysely), ao Redis e à leitura de source-maps não têm timeout. Apenas o webhook de alerta tem timeout. Em produção, isso vira backpressure silencioso e travamentos de shutdown.
3. **Erros e race conditions em cenários de borda.** O `app.listen` em `apps/api/src/main.ts:494` não é protegido por try/catch — se a porta estiver ocupada ou faltar permissão de bind, o processo morre com uma rejeição não tratada. Há também problemas concretos no fluxo de OAuth/Google (cookie de state com `Path` muito restritivo, retorno JSON após autenticação OAuth), no resolver de source-maps (TOCTOU em `validateStoragePath`, cache parcial nunca persistido, `try { ... } catch { continue }` mascarando mapas inválidos), no scheduler de retention/backup (única instância do startup timer pode disparar antes do `runOnce` anterior terminar caso o usuário chame `runOnce` manualmente em paralelo), e na promessa de backfill de error-groups disparada com `void` sem retentativa.

Em termos de completude: o pipeline de ingestão → fila → worker → escrita está coerente; a resolução de source-maps existe mas tem fallbacks frágeis; o sistema de alertas é completo com SSRF guards (com bugs específicos comentados); a tela de error-groups, sessões e users tem cursor encoding consistente em base64url. Não há TODO/FIXME no escopo, mas há ramos de código mortos/silenciosos.

---

## 2. Tabela de achados

| # | Área | Severidade | Arquivo:linha |
|---|------|------------|---------------|
| F1 | Ciclo de vida (bootstrap) | CRÍTICO | `apps/api/src/main.ts:494` |
| F2 | Tratamento de erros (query routes) | ALTO | `apps/api/src/routes/query.ts:853,880,909,931,958,980,1003,1025,1048,1070,1094,1120,1152,1180` |
| F3 | Tratamento de erros (admin routes) | ALTO | `apps/api/src/routes/admin.ts:1042,1088,1114,1134,1159,1195,1223,1251,1283,1319,1346` |
| F4 | Tratamento de erros (alerts routes) | ALTO | `apps/api/src/routes/alerts.ts:69,96` |
| F5 | Tratamento de erros (system) | MÉDIO | `apps/api/src/routes/system.ts:107` |
| F6 | Tratamento de erros (ingestion) | MÉDIO | `apps/api/src/routes/ingestion.ts:69,117` |
| F7 | Tratamento de erros (system-health) | MÉDIO | `apps/api/src/system-health.ts:90-92,98-100` |
| F8 | Source maps — `catch { continue }` em frame | ALTO | `apps/api/src/source-maps/resolver.ts:167-169` |
| F9 | Source maps — TOCTOU em `validateStoragePath` | MÉDIO | `apps/api/src/source-maps/storage.ts:38-52` |
| F10 | Source maps — cache parcial nunca persistido | MÉDIO | `apps/api/src/source-maps/resolver.ts:172-184` |
| F11 | Source maps — upload bundle: arquivos órfãos se DB transaction falhar parcialmente | MÉDIO | `apps/api/src/source-maps/storage.ts:188-211` |
| F12 | Source maps — unzipSync duplo e sincrono pode travar event loop | MÉDIO | `apps/api/src/source-maps/parser.ts:97-117` |
| F13 | Source maps — `parseSourceMapJson` invocado em `storeSourceMapFile` write-then-validate | MÉDIO | `apps/api/src/source-maps/storage.ts:120` |
| F14 | Source maps — `deleteSourceMapArtifactAndFile`: arquivo apagado mesmo se delete da DB falhar | MÉDIO | `apps/api/src/source-maps/storage.ts:214-231` |
| F15 | Auth — `fetch` Google OAuth sem timeout | ALTO | `apps/api/src/main.ts:219-244` |
| F16 | Auth — Google callback retorna JSON em vez de redirecionar | BAIXO | `apps/api/src/routes/auth.ts:170` |
| F17 | Auth — cookie de OAuth state com `path` restrito | INFORMATIVO | `apps/api/src/routes/auth.ts:128` |
| F18 | Auth — `decorateRequest` sem inicialização correta para Fastify 4 | INFORMATIVO | `apps/api/src/plugins/request-context.ts:16` |
| F19 | Auth — reuso de `Path=/auth/google/callback` perde cookie em hostnames novos | INFORMATIVO | `apps/api/src/routes/auth.ts:128,163` |
| F20 | Auth — `findUserById` ignora `archivedAt` | MÉDIO | `apps/api/src/main.ts:290-303` |
| F21 | Ingestão — corpo grande não é rate-limited especificamente; rate-limit global por IP, sem por-API-key | MÉDIO | `apps/api/src/app.ts:56`, `apps/api/src/routes/ingestion.ts:90-124` |
| F22 | Ingestão — `slice(0,12)` sem validação de tamanho mínimo do secret | BAIXO | `apps/api/src/main.ts:373` |
| F23 | Shutdown API — ordem incorreta (close servidor + fila + redis + db em paralelo) | ALTO | `apps/api/src/main.ts:504` |
| F24 | Shutdown API — `process.exit(0)` mesmo se shutdown falhou | MÉDIO | `apps/api/src/main.ts:513,517` |
| F25 | Shutdown — handler unico para SIGINT/SIGTERM; SIGINT duplo não força exit | BAIXO | `apps/api/src/main.ts:512-518` |
| F26 | Worker — backfill de error-groups com `void` e sem retry | MÉDIO | `apps/worker/src/main.ts:66-68` |
| F27 | Worker — dead-letter insertion fire-and-forget pode perder o registro se DB cair durante shutdown | MÉDIO | `apps/worker/src/main.ts:175-186` |
| F28 | Worker — `recordBackupRun(failed)` chamado mesmo quando o lock NÃO foi adquirido por outra instância (cenário com `withLock` retornando `{locked:false}` mas tendo lançado por outras razões) | BAIXO | `apps/worker/src/backups.ts:200-252` |
| F29 | Worker — retention `runOnce` lock catch é frágil (depende de string em `Error.message`) | MÉDIO | `apps/worker/src/retention.ts:29-43` |
| F30 | Worker — heartbeat falha não é refletida no health (apenas log) | INFORMATIVO | `apps/worker/src/heartbeat.ts:17-19` |
| F31 | Worker alerts — `evaluateRule` falha cai em fluxo silencioso (apenas console.error e seguir) | MÉDIO | `apps/worker/src/alerts.ts:135-138` |
| F32 | Worker alerts — webhook delivery sem retry; falha permanente após primeira tentativa | MÉDIO | `apps/worker/src/alerts.ts:146-166` |
| F33 | Worker alerts — `recordDelivery` falha não é considerada para reentrega | MÉDIO | `apps/worker/src/alerts.ts:156-165` |
| F34 | Worker alerts — `fetchWebhook` (não-produção) não valida redirect e hostname não é resolvido | MÉDIO | `apps/worker/src/alerts.ts:266-272,302-319` |
| F35 | Worker alerts — `requestHttpWebhook` não consome corpo da resposta antes de resolver | BAIXO | `apps/worker/src/alerts.ts:351-354` |
| F36 | Worker alerts — `Buffer.byteLength(body)` correto, mas Content-Length conflita com timeout abort silencioso quando o socket é destruído pelo cliente | INFORMATIVO | `apps/worker/src/alerts.ts:250-251,358-360,394-396` |
| F37 | Worker alerts — `isPrivateIpv4Host(host)` em `apps/worker/src/alerts.ts:565` aceita `second=undefined` em octets curtos | BAIXO | `apps/worker/src/alerts.ts:565-577` |
| F38 | Worker — concurrency padrão de BullMQ Worker = 1, não há configuração explícita | INFORMATIVO | `apps/worker/src/main.ts:58-64` |
| F39 | Worker — sem idempotência em jobs: `job.id` igual seria descartado pelo BullMQ mas a ingestão sempre gera novo `id` via `createId`, então retries podem inserir duplicadas se o write parcial passou da chave única | ALTO | `apps/worker/src/telemetry-worker.ts:100-198` |
| F40 | Worker — buildDeadLetterJobInput não cobre erros não-Error sintéticos (mas faz `String(input.error)`) | INFORMATIVO | `apps/worker/src/telemetry-worker.ts:60` |
| F41 | Queue — `attempts: 5` com `removeOnFail: false` significa retenção indefinida na fila Redis | MÉDIO | `packages/queues/src/telemetry-queue.ts:24-32` |
| F42 | Sanitization — `sanitizePreviewText(undefined)` retorna undefined; nuances de `null` não cobertas | INFORMATIVO | `packages/telemetry/src/sanitization.ts:93-102` |
| F43 | Schemas — `eventPayloadSchema.properties` sempre default `{}`, escondendo erros do cliente | INFORMATIVO | `packages/telemetry/src/ingestion-schemas.ts:23,38-41` |
| F44 | Casts perigosos — cursor decode `as unknown` sem schema Zod | BAIXO | `apps/api/src/routes/query.ts:590,716` |
| F45 | Casts perigosos — request body em rotas multipart casteado como `MultipartRequest` | BAIXO | `apps/api/src/routes/admin.ts:570` |
| F46 | Query — `parseFilters` aceita `from > to` sem 400 | MÉDIO | `apps/api/src/routes/query.ts:249-343` |
| F47 | Query — paginação limite default 50, máx 500 — sem validação cruzada com cursor | INFORMATIVO | `apps/api/src/routes/query.ts:216-233` |
| F48 | Query — cursor decode não valida que cursor pertence a same project/environment | MÉDIO | `apps/api/src/routes/query.ts:583-610,709-736` |
| F49 | Query — `getEntityTenantDetail`: rejeita `_unassigned` mas pode receber outros sentinels indefinidos | INFORMATIVO | `apps/api/src/routes/query.ts:997` |
| F50 | Query — `parseSessionTimelineFilters` aceita `beforeMs/afterMs` arbitrariamente grandes (sem cap) | MÉDIO | `apps/api/src/routes/query.ts:415-435` |
| F51 | Health — `/ready` retorna 503 mas não distingue se postgres ou redis falhou para o operador | INFORMATIVO | `apps/api/src/routes/health.ts:8-13` |
| F52 | Health — `app.get("/health")` sempre `{ok:true}`; não diferencia liveness x readiness pós-startup | INFORMATIVO | `apps/api/src/routes/health.ts:6` |
| F53 | Console — `apiBasePath` default `"/"` é o único valor possível; opção parece morta | INFORMATIVO | `apps/api/src/app.ts:67` |
| F54 | Console — `/console/*` faz fallthrough para index.html mesmo em rotas API que casem `/console/...` | BAIXO | `apps/api/src/routes/console.ts:34-41` |
| F55 | Admin — `isPrivateIpv4Host` admite octets fora de 0-255 (não valida range) | BAIXO | `apps/api/src/routes/admin.ts:439-451` |
| F56 | Admin — `parseSourceMapUploadRequest` retorna `undefined` quando o stream multipart é abortado, escondendo o motivo | BAIXO | `apps/api/src/routes/admin.ts:566-643` |
| F57 | Admin — `parseSourceMapUploadRequest` não trata um upload sem nenhum part de arquivo (retorna undefined) | INFORMATIVO | `apps/api/src/routes/admin.ts:617-618` |
| F58 | Source-map storage — `writeFile` com flag `wx` lança se UUID colidir; cleanup OK, mas o erro vira `503` | INFORMATIVO | `apps/api/src/source-maps/storage.ts:73,1088` |
| F59 | Source-maps `validateStoragePath` lança ENOENT na leitura de mapa removido por outra request | BAIXO | `apps/api/src/source-maps/storage.ts:43-46` |
| F60 | Sem `setErrorHandler` global do Fastify; erros não-capturados pelas rotas vão como 500 default sem log | ALTO | `apps/api/src/app.ts:41` |
| F61 | `logger: false` desabilita request logging totalmente — perda absoluta de observabilidade | ALTO | `apps/api/src/app.ts:41` |
| F62 | Casts `Parameters<AuthDependencies["findSessionUser"]>[0]` repetidos como guard | INFORMATIVO | `apps/api/src/routes/admin.ts:482`, `routes/query.ts:803`, `routes/system.ts:94`, `routes/alerts.ts:35` |

---

## 3. Detalhes por achado

### F1 — `app.listen` sem try/catch (CRÍTICO)
- **Arquivo:** `apps/api/src/main.ts:494`
- **Descrição:** `await app.listen({...})` no top-level. Se a porta estiver em uso (EADDRINUSE), permissão negada, ou DNS falho, a rejeição não-tratada terminará o processo com stack feio e sem registro estruturado. Para um operador self-hosted, o sintoma é "API não sobe" sem mensagem útil.
- **Cenário:** Outro processo SignalHub ainda rodando; PORT colidindo; bind em `0.0.0.0` bloqueado por capabilities; Docker reusando porta.
- **Recomendação:** Envolver `app.listen` em `try/catch`, logar `error` com contexto (porta, host), chamar `await db.destroy()` + `await telemetryQueue.close()` + `await redis.quit()` antes de `process.exit(1)`. O mesmo vale para o `await migrate(db)` (`main.ts:175`) que está fora de qualquer guard.

### F2 — `query.ts`: 14 catches silenciosos transformados em 503 (ALTO)
- **Arquivo:** `apps/api/src/routes/query.ts` — várias linhas listadas na tabela.
- **Descrição:** Toda rota de query usa `} catch { return reply.status(503).send({ error: "query_unavailable" }) }`. Não há log, nem propagação de causa, nem diferenciação entre erro temporário (timeout/conexão) e bug (TypeError, RangeError, undefined access). O console e telemetria perdem o motivo da falha.
- **Cenário:** Migração não-rodada faltando coluna; bug em repository que dispara `cannot read properties of undefined`; falha temporária no pool do PG.
- **Recomendação:** Pelo menos `console.error("query route X failed", error)` antes do retorno; ideal: discriminar `error.code` PG (`ECONNREFUSED`/timeout → 503, demais → 500), e registrar via Fastify logger (com `logger: true`).

### F3 — `admin.ts`: 11 catches silenciosos (ALTO)
- **Arquivo:** `apps/api/src/routes/admin.ts:1042, 1088, 1114, 1134, 1159, 1195, 1223, 1251, 1283, 1319, 1346`
- **Descrição:** Mesmo padrão de F2 nas rotas de alertas, notification-channels, source-maps, alert-rules. A rota POST `/admin/alert-rules` (linha 1278-1284) trata `isKnownAdminResourceError` como 404, qualquer outro erro vira 503 — sem log.
- **Cenário:** Tentativa de criar regra com FK inválida (project archivado, environment apagado): a constraint violation no PG ficaria mascarada como 503 e o operador não sabe por que falhou.
- **Recomendação:** Log + diferenciar erros conhecidos (FK violation, unique violation) e mapear para 409/422, devolvendo `details`.

### F4 — `alerts.ts` rotas de leitura: catches silenciosos (ALTO)
- **Arquivo:** `apps/api/src/routes/alerts.ts:69, 96`
- **Descrição:** `try { ... } catch { reply.status(503) }` para `listAlertEvents` e `getAlertEvent`. Idêntico a F2/F3.

### F5 — `system.ts`: catch silencioso em `/system/health` (MÉDIO)
- **Arquivo:** `apps/api/src/routes/system.ts:107-108`
- **Descrição:** A rota chama `options.system.getHealth()` que internamente já isola cada probe com `measure/probe` (`system-health.ts:85-101`). Aquela camada já não lança. Mas se ainda assim lançar (bug em `createSystemHealthSnapshot` ou no derivativo `isoOrNull`), 503 sem log.
- **Recomendação:** Log do erro; nunca deveria lançar por design — testar/validar para garantir.

### F6 — Ingestion: catches silenciosos no enqueue/verifyApiKey (MÉDIO)
- **Arquivo:** `apps/api/src/routes/ingestion.ts:69, 117`
- **Descrição:** Em `requireApiKeyScope`, falha de `verifyApiKey` (que toca PG) cai em 503 silente. Em `enqueue`, falha do Redis cai em 503 silente. Para o telemetry SDK o sintoma é "ingestion_unavailable" sem distinção entre Redis OFF e auth quebrada.
- **Recomendação:** Log com `console.error` para que o operador entenda; possivelmente diferenciar PG vs Redis no error code (`ingestion_db_unavailable` vs `ingestion_queue_unavailable`).

### F7 — system-health: probes com `} catch {`  (MÉDIO)
- **Arquivo:** `apps/api/src/system-health.ts:85-101`
- **Descrição:** As funções `measure` e `probe` engolem completamente o erro. Em `/system/health` o operador vê o status do componente (postgres healthy/degraded/unhealthy) mas não a causa raiz. Para troubleshooting isso é insuficiente.
- **Recomendação:** Logar `error` antes de retornar `{ ok: false }`, ou anexar `errorMessage` (sanitizada) no objeto retornado.

### F8 — Source-maps resolver: `catch { continue }` (ALTO)
- **Arquivo:** `apps/api/src/source-maps/resolver.ts:161-169`
- **Descrição:** Ao ler/parsear um source-map, qualquer erro (mapa corrompido, JSON inválido, ENOENT, permissão negada) é silenciado e o frame só fica "não-resolvido". O operador não tem como descobrir que um mapa específico está quebrado. Pior: o cache "resolved" só é gravado se TODOS os frames forem resolvidos (`fullyResolved` em `resolver.ts:172-184`), então mapas parcialmente quebrados forçam o trabalho a refazer toda hora.
- **Recomendação:** Logar `console.error("source map read/parse failed", { storagePath, error })`; considerar marcar o artifact como "broken" via repositório se for um erro determinístico (JSON inválido).

### F9 — `validateStoragePath` TOCTOU (MÉDIO)
- **Arquivo:** `apps/api/src/source-maps/storage.ts:38-52`
- **Descrição:** `validateStoragePath` faz `realpath(localDir)` + `lstat(storagePath)` + `realpath(storagePath)`. Entre o `lstat` e o uso (`readFile` ou `rm`), um atacante com acesso ao filesystem poderia trocar o arquivo por um symlink (TOCTOU). Como esse FS é compartilhado apenas pelo processo do SignalHub, o risco prático é baixo, mas a sequência checagem→ação não está atomicizada.
- **Cenário:** Container compartilhado, bug em outra rota expondo write em `/var/lib/signalhub/source-maps`.
- **Recomendação:** Abrir o arquivo com `open(... { flag: "r" })` + `fstat` + verificar `nlink == 1` e que o real path da FD continua dentro do localDir; ou usar O_NOFOLLOW.

### F10 — Cache parcial nunca persistido (MÉDIO)
- **Arquivo:** `apps/api/src/source-maps/resolver.ts:172-184`
- **Descrição:** Só persiste cache se `resolvedFrames.length === parsedFrames.length`. Stack traces grandes onde 1 frame não tem mapa fazem o resolver reler/repassar o source-map em CADA request — disco e CPU desperdiçados.
- **Recomendação:** Persistir mesmo o resultado parcial com flag (ex: `partial`), invalidar quando um novo artifact aparecer.

### F11 — Upload bundle: arquivos órfãos parcialmente protegidos (MÉDIO)
- **Arquivo:** `apps/api/src/source-maps/storage.ts:156-211`
- **Descrição:** O laço grava N arquivos no FS, depois abre transação DB. Se a transação falhar no meio (ex: violation de unique), o `catch` externo limpa TODOS os `writtenStoragePaths`. Bom. Mas se a falha for fora do catch (ex: `cleanupStoredFiles` falha — sem permissão de unlink), erros mudos aparecem (a função `deleteSourceMapFileIfPresent` em 90-99 lança se `code !== ENOENT`). Como `cleanupStoredFiles` em 101-103 usa `Promise.all`, uma rejeição faz outras unlinks ainda concorrerem mas o erro propaga. OK no caminho feliz, falho em FS lotado/EACCES.
- **Recomendação:** `Promise.allSettled` em cleanup; logar individuais.

### F12 — `unzipSync` duplo no event loop (MÉDIO)
- **Arquivo:** `apps/api/src/source-maps/parser.ts:97-117`
- **Descrição:** Para validar tamanho, faz `unzipSync` com filter que conta tudo (mas retorna false). Depois faz `unzipSync` de novo para extrair apenas `.map`. Cada chamada bloqueia o event loop por todo o trabalho de descompressão. Em uploads de 50MB, o servidor fica não-responsivo (cf. CONSTRAINTS).
- **Recomendação:** Mover para Worker Thread ou usar `unzip` assíncrono (`fflate.unzip`).

### F13 — `parseSourceMapJson` validado APÓS write (MÉDIO)
- **Arquivo:** `apps/api/src/source-maps/storage.ts:115-154`
- **Descrição:** `uploadSingleSourceMap` chama `parseSourceMapJson(content)` (linha 120) ANTES de `storeSourceMapFile`, então o write só acontece se o JSON for válido — bom. **MAS** se a INFERÊNCIA do `minifiedFile` falhar (linhas 121-124, `source_map_file_missing`), o conteúdo já foi parseado mas o lançamento ocorre antes do write. OK. Risco real: o file write usa `flag: "wx"` (exclusive); se `randomUUID()` colidir (improvável), erro `EEXIST` ocorre — não está mapeado em `SOURCE_MAP_BAD_REQUEST_ERRORS` e cai em 503 (admin.ts:1088).
- **Recomendação:** Capturar `EEXIST` e devolver 500 com retry, ou retentar com novo UUID dentro do `storeSourceMapFile`.

### F14 — `deleteSourceMapArtifactAndFile`: arquivo apagado mesmo se DB falhar depois (MÉDIO)
- **Arquivo:** `apps/api/src/source-maps/storage.ts:214-231`
- **Descrição:** A ordem é: lê artifact → apaga arquivo (`deleteSourceMapFileIfPresent`) → apaga DB. Se o último `deleteSourceMapArtifact` falhar (transação morre), o registro fica no DB apontando para um arquivo que não existe mais. Tentativas subsequentes de resolver source-maps para esse artifact tentarão ler um path inexistente. O comentário in-code (224) afirma "Keep the DB row active if file deletion fails" — mas o oposto não é tratado.
- **Recomendação:** Inverter a ordem (apagar DB primeiro, depois arquivo) ou apagar arquivo somente após DB commit; tolerar arquivo órfão (mais seguro) em vez de DB órfão.

### F15 — Google OAuth `fetch` sem timeout (ALTO)
- **Arquivo:** `apps/api/src/main.ts:220-243`
- **Descrição:** Ambas as chamadas (`https://oauth2.googleapis.com/token` e `https://openidconnect.googleapis.com/v1/userinfo`) usam `fetch` sem `AbortController` nem timeout. Em falha do Google, a request OAuth fica pendurada até o socket TCP morrer (~2 min em Linux). Multiplicado por requests simultâneos, exaurece capacidade do servidor.
- **Recomendação:** Criar AbortController com timeout configurável (por padrão 10s), envolver os dois fetchs.

### F16 — Google callback retorna JSON em vez de redirecionar (BAIXO)
- **Arquivo:** `apps/api/src/routes/auth.ts:170`
- **Descrição:** Após autenticação bem-sucedida, devolve `reply.send({ user })`. O navegador (que veio do redirect do Google) recebe JSON cru. UX quebrada — o esperado é redirect para `/console` ou para a URL guardada no state.
- **Recomendação:** `reply.redirect("/console")` após `setSessionCookie`.

### F17 — Cookie OAuth state com `Path=/auth/google/callback` (INFORMATIVO)
- **Arquivo:** `apps/api/src/routes/auth.ts:128`
- **Descrição:** O cookie é enviado somente para essa rota — o que é seguro. Mas como o `setCookie` ocorre em GET `/auth/google` (path diferente), `Path=/auth/google/callback` é válido (path do cookie pode ser diferente da request). OK, intencional.

### F18 — `decorateRequest("currentUser", null)` (INFORMATIVO)
- **Arquivo:** `apps/api/src/plugins/request-context.ts:16`
- **Descrição:** No Fastify v4+ é recomendado usar `getter` ou objetos imutáveis quando se decora com valor inicial. `null` é um valor primitivo e funciona, mas se em algum lugar o código fizesse `request.currentUser = { ... }` ANTES da inicialização do hook, criaria shape inconsistente. No código atual está OK pois sempre se atribui pelo `setCurrentUser`.

### F19 — Cookie OAuth: re-uso de path em ambientes multi-tenant (INFORMATIVO)
- Mesma rota: `/auth/google/callback`. Se SignalHub for atrás de proxy reverso reescrevendo path, perde-se o cookie. Documentar.

### F20 — `findUserById` em sessions ignora `archivedAt` (MÉDIO)
- **Arquivo:** `apps/api/src/main.ts:300-302`
- **Descrição:** `findSessionUser` carrega usuário pelo id da sessão. Se um admin arquiva um usuário, a sessão antiga ainda vai funcionar até expirar (7 dias). Não há revogação imediata.
- **Cenário:** Funcionário desligado mantém acesso por dias.
- **Recomendação:** Filtrar `archivedAt is null` no `findUserById`, ou checar isso explicitamente após o `findUserById`.

### F21 — Rate limit global sem dimensão por API key (MÉDIO)
- **Arquivo:** `apps/api/src/app.ts:56`
- **Descrição:** `rateLimit { max: 1000, timeWindow: "1 minute" }` é global por IP. Em produção self-hosted atrás de Cloudflare/proxy, todos os clients vão sair pelo mesmo IP do proxy. Vão se canibalizar até atingirem 1000/min.
- **Recomendação:** `keyGenerator` por API key na rota de ingestão; ou desabilitar rate limit nessa rota e ativar por chave no SDK.

### F22 — Verificação de API key sem tamanho mínimo (BAIXO)
- **Arquivo:** `apps/api/src/main.ts:373`
- **Descrição:** `secret.slice(0,12)` — se o usuário enviar Bearer com menos de 12 chars, `slice` retorna a string truncada sem erro. `findApiKeyByPrefix` simplesmente não encontrará. OK no resultado, mas oculta o motivo (poderia ser 400 em vez de 401).
- **Recomendação:** Validar `secret.length >= 12 && secret.startsWith("sh_")` antes de hash/lookup.

### F23 — Shutdown API em paralelo (ALTO)
- **Arquivo:** `apps/api/src/main.ts:504`
- **Descrição:** `Promise.allSettled([app.close(), telemetryQueue.close(), redis.quit(), db.destroy()])` fecha tudo simultaneamente. Mas `app.close()` precisa drenar requests em voo, e essas requests podem ainda estar enfileirando jobs (precisa do `redis`) ou lendo do db. Fechando tudo em paralelo, requests em voo recebem erros estranhos no meio do shutdown.
- **Recomendação:** Sequenciar: (1) `app.close()` aguarda drenagem; (2) `telemetryQueue.close()`; (3) `redis.quit()`; (4) `db.destroy()`.

### F24 — `process.exit(0)` mesmo em falha (MÉDIO)
- **Arquivo:** `apps/api/src/main.ts:513,517`
- **Descrição:** `void shutdown(signal).finally(() => process.exit(0))`. Mesmo se algum `result.status === "rejected"`, o exit code é 0. Em orquestradores (Compose/K8s), isso quebra detecção de falha.
- **Recomendação:** Rastrear se algum step falhou e `process.exit(failed ? 1 : 0)`.

### F25 — SIGINT duplo (BAIXO)
- **Arquivo:** `apps/api/src/main.ts:512-518`
- **Descrição:** `process.once` — somente uma vez. Se shutdown ficar travado (ex: app.close não responde), `Ctrl+C` segundo não força exit. Não há fallback de "shutdown forçado em N segundos".
- **Recomendação:** `process.on(...)` que após 1ª chamada arma timer (ex: 30s) e força `process.exit(1)`.

### F26 — Backfill com `void` (MÉDIO)
- **Arquivo:** `apps/worker/src/main.ts:66-68`
- **Descrição:** `void backfillErrorGroupsUntilDrained(...).catch(...)`. Loop infinito (linha 42 de `telemetry-worker.ts`) até `selected < batchSize`. Se a função do repositório lançar (ex: timeout transitório), o catch loga e abandona. Não há retry. Em um worker recém-iniciado com muita data legada, falhar uma vez = nunca completar o backfill até reiniciar.
- **Recomendação:** Loop com retentativa exponencial; ou agendar retry após N minutos.

### F27 — Dead-letter fire-and-forget (MÉDIO)
- **Arquivo:** `apps/worker/src/main.ts:175-186`
- **Descrição:** `void insertDeadLetterJob(...).catch(...)`. Se o DB estiver indisponível na hora do dead-letter (e provavelmente está, já que isso indica falha sistêmica), perdemos a evidência do job. Não há fallback (ex: log estruturado para stderr com payload sanitizado).
- **Recomendação:** Em caso de falha do insert, logar payload sanitizado para stderr com JSON.

### F28 — `recordBackupRun(failed)` quando lock não adquirido (BAIXO)
- **Arquivo:** `apps/worker/src/backups.ts:201-252`
- **Descrição:** Se `withLock` lançar (ex: PG indisponível), o catch externo registra `status:"failed"`. Se o lock simplesmente não foi adquirido (concorrência), o caminho de `lockResult.locked === false` corre dentro do try OK; `recordBackupRun` não é chamado nesse caso. Aceitável.
- **Cenário:** Comportamento atual está correto, mas se `withLock` lançar erro "transitório", o "failed" registra ruído.
- **Recomendação:** Diferenciar exceptions de "lock not acquired".

### F29 — Retention lock catch frágil (string-based) (MÉDIO)
- **Arquivo:** `apps/worker/src/retention.ts:29-43`
- **Descrição:** `if (!(error instanceof Error) || !error.message.includes("retention_delete_failed:"))` rethrowa. Depender de string em `Error.message` é frágil e quebra se algum dia o repositório mudar o prefixo. Não é uma `Error` customizada com `name`/`code`.
- **Recomendação:** Usar uma classe de erro (`class RetentionDeleteError extends Error`) com discriminação via `instanceof`.

### F30 — Heartbeat: falha só loga (INFORMATIVO)
- **Arquivo:** `apps/worker/src/heartbeat.ts:17-19`
- **Descrição:** `beat()` falha, loga, segue. O system-health detecta worker stale apenas pelo timestamp do heartbeat — então um worker conectado mas com DB lento aparece como degraded. Comportamento aceitável.

### F31 — Alert: `evaluateRule` falha por regra (MÉDIO)
- **Arquivo:** `apps/worker/src/alerts.ts:135-138`
- **Descrição:** `try { ... } catch (error) { console.error(...); await updateRuleEvaluation({...evaluatedAt: now}) }`. Bom que loga. Mas a regra é marcada como "avaliada" mesmo após erro — e o operador não vê nenhum sinal disso na UI/`/system/health` (a tela só mostra agregados de retention/backup). Regras que sempre falham silenciosamente nunca alertam.
- **Recomendação:** Incrementar contador de falha, expor no health, e/ou desabilitar regra após N falhas consecutivas.

### F32 — Alert webhook delivery sem retry (MÉDIO)
- **Arquivo:** `apps/worker/src/alerts.ts:146-166`
- **Descrição:** `await runtime.deliver(...)`. Se HTTP 502 ou timeout, registra failure e segue. Não há fila de retry de webhook. Em redes flaky, alertas críticos se perdem.
- **Recomendação:** Reagendar para próxima janela ou colocar em fila BullMQ de webhooks com retry exponencial.

### F33 — `recordDelivery` falhar invalida visibilidade (MÉDIO)
- **Arquivo:** `apps/worker/src/alerts.ts:156-165`
- **Descrição:** Se o delivery succeed mas `recordDelivery` falhar (DB), o sistema acha que o alerta nunca foi enviado. Não há `2-phase commit`.
- **Recomendação:** Pelo menos retentar `recordDelivery` em loop curto antes de abandonar.

### F34 — `fetchWebhook` em não-produção não valida DNS/SSRF (MÉDIO)
- **Arquivo:** `apps/worker/src/alerts.ts:266-272, 302-319`
- **Descrição:** Em `nodeEnv !== "production"`, usa `fetch` global com `redirect: "manual"`. Bom o redirect manual. Mas **não há verificação de SSRF** — em dev/test, webhook para `http://localhost:6379` ou `http://169.254.169.254` (instance metadata em AWS) seria permitido. Consistência com produção seria mais segura mesmo em dev (apenas com flag de override para testes E2E).
- **Recomendação:** Mover validação para sempre, com flag explícita para test/dev.

### F35 — `requestHttpWebhook` não drena response (BAIXO)
- **Arquivo:** `apps/worker/src/alerts.ts:351-354`
- **Descrição:** `response.resume()` é chamado, ok — drena. Mas se houver erro durante a leitura do response body (após `resume`), não é tratado. Comportamento aceitável já que só importa o status.

### F36 — Timeout abort em socket destroyed (INFORMATIVO)
- **Arquivo:** `apps/worker/src/alerts.ts:358-360, 394-396`
- **Descrição:** Timeout chama `request.destroy(new Error("Webhook delivery timed out"))`. O listener `error` da promessa rejeita com esse erro. OK.

### F37 — `isPrivateIpv4Host` com octet undefined (BAIXO)
- **Arquivo:** `apps/worker/src/alerts.ts:565-577`
- **Descrição:** `octets = host.split(".").map(Number)`; `[first, second] = octets`. Se host = "10" (IP inválido mas que passe `isIP` retornando 0 e cair em código que assume v4 mesmo), `second` é undefined. As comparações `(first === 172 && second >= 16 && second <= 31)` com second=undefined dão `NaN >= 16` = false, ok. Mas a função é chamada após `isIP` confirmar v4, então o input tem 4 octets sempre. Risco baixo.

### F38 — BullMQ Worker sem `concurrency` explícita (INFORMATIVO)
- **Arquivo:** `apps/worker/src/main.ts:58-64`
- **Descrição:** Default é 1 (serial). Para throughput sério, configurar `{ connection, concurrency: 4-8 }`. Documentar.

### F39 — Idempotência: re-execução do mesmo job pode duplicar inserts (ALTO)
- **Arquivo:** `apps/worker/src/telemetry-worker.ts:100-198`
- **Descrição:** Job carrega `id` (gerado em `routes/ingestion.ts:106`, `createId`). O worker chama `writer.insertEvent({ id, ... })`. Se o write conclui e o ACK do job falha (Redis network blip), BullMQ retentará — e o INSERT vai falhar com unique violation (assumindo PK), o `failed` event handler vai gravar dead-letter. **MAS** se o insert é via `INSERT ... ON CONFLICT DO NOTHING` ou similar, perde-se a info; se for `INSERT` puro, retry vai sempre falhar e ir pro DLQ. **Pior**: se ingestão acidentalmente enfileira dois jobs com o mesmo `id` (programmer error), os dois retornarão 202 e o segundo writer falhará no segundo insert. Sem ver `telemetry-writes.ts` é incerto.
- **Recomendação:** Confirmar que repositório usa `ON CONFLICT DO NOTHING` ou idempotent upserts; testar duplicidade de id.

### F40 — `buildDeadLetterJobInput` cobre não-Error (INFORMATIVO)
- **Arquivo:** `apps/worker/src/telemetry-worker.ts:60`
- **Descrição:** `String(input.error)` cobre `null`/`undefined`/objetos sem `message`. OK.

### F41 — `removeOnFail: false` (MÉDIO)
- **Arquivo:** `packages/queues/src/telemetry-queue.ts:24-32`
- **Descrição:** Jobs falhados ficam no Redis indefinidamente, somando memória. Em produção isso vira "Redis cheio em 30 dias".
- **Recomendação:** `removeOnFail: { count: 5000, age: 7*24*3600 }`.

### F42 — `sanitizePreviewText(undefined)` retorna undefined (INFORMATIVO)
- **Arquivo:** `packages/telemetry/src/sanitization.ts:93-102`
- **Descrição:** Aceita string|undefined. Não aceita null. Em `telemetry-worker.ts:140-142` chamam com `payload.error` que é `string|undefined` per schema — OK.

### F43 — Schemas com defaults silenciosos (INFORMATIVO)
- **Arquivo:** `packages/telemetry/src/ingestion-schemas.ts:23,38-41`
- **Descrição:** `metadata`/`properties`/`context`/`data` defaultam para `{}` se ausentes. Aceitável. Mas `eventPayloadSchema` aceita um event sem `properties` (default `{}`). Se um cliente enviar `properties: null`, o `z.record(...)` falha — bom.

### F44 — Cursor decode sem schema Zod (BAIXO)
- **Arquivo:** `apps/api/src/routes/query.ts:583-610, 709-736`
- **Descrição:** O cursor decodifica JSON base64url e faz checks manuais. Funciona, mas usar Zod tornaria o código mais defendável.

### F45 — Multipart cast (BAIXO)
- **Arquivo:** `apps/api/src/routes/admin.ts:570`
- **Descrição:** `request as MultipartRequest` — cast manual. Aceitável dado o plugin `@fastify/multipart` decorar a request.

### F46 — `from > to` aceito (MÉDIO)
- **Arquivo:** `apps/api/src/routes/query.ts:249-343`
- **Descrição:** `parseFilters` valida que `from`/`to` são datas válidas, mas não rejeita `from > to`. O repositório provavelmente retorna lista vazia — comportamento confuso para o cliente que esperava 400.
- **Recomendação:** Retornar 400 se `from > to`.

### F47 — Paginação sem validação cruzada (INFORMATIVO)
- **Arquivo:** `apps/api/src/routes/query.ts:216-233`
- **Descrição:** `limit` é capado em 500. Bom. Mas se o cliente envia `cursor=...&limit=500` em conjunto com `from`/`to`, a consulta pode ser pesada — confiamos no DB.

### F48 — Cursor não-validado vs projeto/ambiente (MÉDIO)
- **Arquivo:** `apps/api/src/routes/query.ts:583-610, 709-736`
- **Descrição:** Cursor codifica `timestamp/type/id` apenas. Se um operador colar um cursor de outro projeto, o repositório precisa filtrar por `projectId/environmentId` no SQL (esperamos), mas o cursor em si não carrega esses dados. Caminho frágil se algum repositório esquecer o filter.
- **Recomendação:** Encoded cursor incluir hash/checksum + projectId; ou validar `id` pertence ao scope na repository.

### F49 — Sentinels `_unassigned`/`_anonymous` ad hoc (INFORMATIVO)
- **Arquivo:** `apps/api/src/routes/query.ts:997, 1042`
- **Descrição:** Strings hardcoded como sentinels de "não atribuído"/"anônimo" em path params. Não documentado em código.

### F50 — `beforeMs/afterMs` sem teto (MÉDIO)
- **Arquivo:** `apps/api/src/routes/query.ts:415-435`
- **Descrição:** `parseNonnegativeSeconds` aceita qualquer número positivo. Cliente poderia pedir 999999999 segundos antes/depois → consulta enorme.
- **Recomendação:** Cap em ex. 7 dias.

### F51 — `/ready` não diferencia componente (INFORMATIVO)
- **Arquivo:** `apps/api/src/routes/health.ts:8-13`
- **Descrição:** Retorna `{ ok, checks: { postgres, redis } }`. Bom, retorna detalhe. OK.

### F52 — `/health` sempre ok (INFORMATIVO)
- **Arquivo:** `apps/api/src/routes/health.ts:6`
- **Descrição:** Liveness probe vacuosamente true. Aceitável para Kubernetes liveness.

### F53 — `apiBasePath` morto (INFORMATIVO)
- **Arquivo:** `apps/api/src/app.ts:67`
- **Descrição:** Sempre "/" — opção parece presente para flexibilidade futura, não utilizada.

### F54 — `/console/*` fallthrough (BAIXO)
- **Arquivo:** `apps/api/src/routes/console.ts:34-41`
- **Descrição:** Qualquer URL `/console/whatever` retorna o index.html (SPA fallback). Se houver uma rota API que case `/console/api`, o handler atual filtra apenas `assets/`. Risco baixo dado os prefixos atuais.

### F55 — `isPrivateIpv4Host` em admin.ts (BAIXO)
- **Arquivo:** `apps/api/src/routes/admin.ts:439-451`
- **Descrição:** Mesmo bug potencial que F37 mas chamado apenas após `isIP` retornar 4. OK.

### F56 — Multipart abort obscuro (BAIXO)
- **Arquivo:** `apps/api/src/routes/admin.ts:566-643`
- **Descrição:** Vários paths retornam `undefined` na função, e o caller (linha 1057-1067) responde 400 genérico. Quebra de UX para o admin.

### F57 — Upload sem arquivo (INFORMATIVO)
- **Arquivo:** `apps/api/src/routes/admin.ts:617-618`
- **Descrição:** Se nenhum part `file`/`bundle` foi enviado, `file` fica undefined e a função retorna undefined. 400 genérico, OK.

### F58 — `EEXIST` em write `wx` (INFORMATIVO)
- **Arquivo:** `apps/api/src/source-maps/storage.ts:73`
- **Descrição:** Colisão UUID virá como erro 503. Improvável.

### F59 — ENOENT em validateStoragePath (BAIXO)
- **Arquivo:** `apps/api/src/source-maps/storage.ts:43-46`
- **Descrição:** Se um source-map foi deletado entre o lookup do artifact e a leitura (race), `lstat` lança ENOENT — e o caller já trata via `deleteSourceMapFileIfPresent`/`continue` na resolver, OK.

### F60 — Sem `setErrorHandler` global (ALTO)
- **Arquivo:** `apps/api/src/app.ts:41`
- **Descrição:** Não há `app.setErrorHandler(...)`. Qualquer erro lançado em handler que não esteja em try/catch é convertido pelo Fastify em 500 default com body `{ statusCode: 500, error: "Internal Server Error" }` SEM LOG (já que `logger: false`). Isso esconde bugs em produção.
- **Recomendação:** Ativar logger e registrar `setErrorHandler` para padronizar resposta + logar.

### F61 — `logger: false` (ALTO)
- **Arquivo:** `apps/api/src/app.ts:41`
- **Descrição:** Desabilita request logging do Fastify. Para um produto de observabilidade self-hosted, isso é irônico. Sem trail de requests, troubleshoot fica impossível.
- **Recomendação:** `logger: { level: nodeEnv === "production" ? "info" : "debug" }`.

### F62 — Casts repetidos como guard (INFORMATIVO)
- **Arquivo:** vários (`admin.ts:482`, `query.ts:803`, `system.ts:94`, `alerts.ts:35`).
- **Descrição:** `request as Parameters<AuthDependencies["findSessionUser"]>[0]` em vários lugares. Aceitável mas verboso; um helper `getSessionUser(request, auth)` reduziria duplicação.

---

## 4. Detalhes por seção

### 4.1 API — Rotas

#### `/v1/*` (ingestão)
- F6, F21, F22.
- A divisão 401 (auth) vs 503 (queue down) vs 400 (payload inválido) está correta.
- Tamanho do corpo de ingestão é controlado pelo multipart (`maxUploadBytes`), mas as rotas v1 são JSON. O `@fastify/multipart` está configurado em `app.ts:48-55` apenas para `/admin/source-maps`. Confirmar que o body parser default do Fastify (~1MB) é suficiente para payloads de erro com stack longa (até `LONG_TEXT_MAX = 20_000`).

#### `/admin/*`
- F3, F55-F58. Lógica de SSRF em webhooks (admin) é robusta mas duplica a do worker (`alerts.ts:518-590`). Há divergência sutil: `admin.ts:444` aceita `host === "0.0.0.0"` mas `alerts.ts:570` aceita o mesmo — paridade OK.
- `PATCH /admin/users/:id` permite o admin se promover a `isAdmin: false` (lockout potencial; rota não verifica se o último admin sumiu). MÉDIO.
- `DELETE /admin/users/:id` arquiva sem revogar sessões existentes (cf. F20).
- `POST /admin/projects/:projectId/environments` (linha 849-883) — único onde há mapping específico de erro conhecido (`active_project_not_found` → 404). Convenção não aplicada nas outras rotas similares.

#### `/auth/*`
- F15, F16, F17, F18, F19.
- `POST /auth/logout` chama `auth.logout?.(...)` opcional; se a dependência não existe, ainda retorna 200 OK — semanticamente OK.
- Não há rate-limit específico para login (cobertura é global por IP). Em prod self-hosted, brute force é possível dentro de 1000 req/min.

#### `/query/*`
- F2, F44-F50.
- Padrão de `sendListResult` (linha 814-824) sempre retorna `{ data: [...] }` ou `{ data, cursor }`. Consistente. ✔️
- `PATCH /query/error-groups/:id` (linha 1197): aceita body `{status}` mas o método para mutação está correto (PATCH). ✔️

#### `/alerts/*`
- F4. Apenas leitura. Filtros validados por Zod. ✔️

#### `/system/health`
- F5. Requer sessão (não admin). OK.

#### `/console/*` e `/console/config`
- F53, F54.

#### `/health` e `/ready`
- F51, F52.

### 4.2 Worker

- **Schedulers** (retention, backups, alerts): padrão consistente — `startupTimer` + `setInterval`, `tick` evita reentrância via `activeRun`. Bom. **MAS** o `startupTimer` chama `tick` 1s após init; se o usuário ou um teste chamar `runOnce` externamente nesse 1s, ainda há reentrância porque os schedulers expõem `runOnce` mas a verificação `activeRun` é interna do scheduler — quem chamar `runOnce()` diretamente bypassa.
- **Telemetry worker**: F39 (idempotência), F38 (concurrency=1).
- **Backups**: F28, dump de Postgres via `pg_dump` (`apps/worker/src/backups.ts:96-138`) — não tem timeout! Se o `pg_dump` travar (deadlock, FS lento), o backup fica pendurado indefinidamente, segurando o lock e bloqueando os próximos. (ALTO se considerar separado, ALTO em conjunto com F15.) **NOVO ACHADO F63 — `pg_dump` sem timeout.**
- **Backups S3**: `uploadBackupToS3` sem timeout. **F64 — S3 upload sem timeout.**
- **Backups pruneLocalBackups**: `Promise.all` (linha 179-189). Se um `unlink` falhar (EACCES), Promise.all rejeita imediatamente sem aguardar outros — mas eventualmente todos terminam. O erro propaga, vai para `runBackupOnce` catch, registra failure. OK.
- **Alerts evaluation**: F31, F32, F33. SSRF defenses em F34. Note bem: `evaluateRule` é chamado dentro do lock (`runtime.withLock`), bloqueando outras avaliações. Se uma regra de SQL lenta levar 30s, todas as regras esperam.

#### F63 — `pg_dump` sem timeout (ALTO)
- **Arquivo:** `apps/worker/src/backups.ts:96-138`
- **Descrição:** `execFileAsync("pg_dump", args, options)`. Sem timeout, sem maxBuffer customizado. Em dumps grandes ou DB lento, fica pendurado.
- **Recomendação:** `execFile(... , { timeout: 30*60*1000 })` (timeout configurable). Em timeout, processo é terminado por SIGTERM.

#### F64 — S3 upload sem timeout (ALTO)
- **Arquivo:** `apps/worker/src/backups.ts:140-168`
- **Descrição:** `S3Client.send(PutObjectCommand)` sem `requestHandler` configurado com timeouts. Default do AWS SDK v3 é 5min, mas em redes lentas pode estourar configuração esperada do scheduler.
- **Recomendação:** Configurar `requestHandler` com timeouts explícitos.

### 4.3 Queues

- F41 (`removeOnFail: false`).
- `defaultJobOptions.attempts: 5` com backoff exponencial 1s base — agressivo o suficiente.
- Nome do job é `payload.kind` (`enqueueTelemetryJob`). BullMQ usa esse nome como discriminador; OK.

### 4.4 Telemetry package

- `sanitization.ts`: F42, F43. `matchesSensitiveRoot` em sanitization.ts:51-59 tem heurística específica para "secretary" (evitar matching com "secret"). Outras palavras similares ("secreted"?) não cobertas. Aceitável dado o universo de keys reais.
- `api-keys.ts`: `verifyApiKey` usa `timingSafeEqual` corretamente. `createApiKey` usa `customAlphabet` com 40 chars — entropia ~238 bits, ótimo. **Mas** `prefix` = primeiros 12 chars do secret, então o prefix em si é parte do secret — qualquer leak do prefix em log é leak parcial do secret. O lookup faz `findApiKeyByPrefix(secret.slice(0,12))`, o que é necessário, mas o operador deve estar ciente de que prefixes em log = secret parcial.
- `auth.ts`: Argon2id correto. `verify` swallow exception é aceitável (argon2 lança em hash inválido — tratar como "senha não confere" é correto).
- `ids.ts`: 24 chars alfanuméricos lowercase, ~123 bits — adequado.
- `ingestion-schemas.ts`: jsonValueSchema recursivo com cap em LONG_TEXT_MAX para strings. Em payloads aninhados profundos, Zod pode estourar stack — não há cap de profundidade.

### 4.5 Source maps

- F8, F9, F10, F11, F12, F13, F14, F59.
- `resolver.ts` é decentemente compacto. Falta tratamento de path absolutos com query strings/hashes no `normalizeMinifiedFile` (`parser.ts:64-71`). Caso o stack vier com `https://app.example.com/main.js?v=abc123#frag`, `URL` parse OK → `basename(pathname)` = `main.js`. OK. Mas se o stack tiver path relativo `./main.js?v=abc` (sem schema), o catch em 68-70 entra, e `path.posix.basename("./main.js?v=abc")` = `main.js?v=abc` — minified file inclui query string. Vai falhar no lookup do artifact. **F65 — `normalizeMinifiedFile` não strip query/hash em paths não-URL.**

#### F65 — `normalizeMinifiedFile` mantém query strings em paths não-URL (MÉDIO)
- **Arquivo:** `apps/api/src/source-maps/parser.ts:64-71`
- **Descrição:** Se valor não parsea como URL, retorna `basename` sem strip de `?...` ou `#...`.
- **Recomendação:** Após basename, strip explicitamente `query` e `hash` (`name.split(/[?#]/)[0]`).

---

## 5. Stubs / TODOs / placeholders

- **Não foram encontrados comentários** `TODO`, `FIXME`, `XXX`, `HACK` no escopo. Bom.
- **Branches deliberadamente vazios** que parecem placeholders:
  - `apps/worker/src/main.ts:104`, `:135`, `:158`: schedulers desabilitados retornam `async () => {}` em vez de `undefined`. Funcional, mas o `Promise.allSettled` no shutdown vai sempre receber um stub vazio. OK.
  - `apps/api/src/routes/auth.ts:58-63`: `authUnavailable()` retorna `login: async () => null`. Não é um stub, é uma fallback dependency. OK.
- **Funções nomeadas mas nunca chamadas externamente**: nenhuma significativa detectada (todas as funções exportadas têm uso interno ou em tests).
- **Features mencionadas mas parcialmente implementadas**:
  - Cache parcial de resolução de source-maps existe em DB (`replaceErrorStackResolutions`) mas só é gravado quando completo — semi-feature (cf. F10).
  - Rate-limit por API key não implementado (cf. F21).
  - Idempotência forte de jobs (cf. F39) parece não-confirmada sem ver `telemetry-writes.ts`.
  - Retry de webhook de alerta (cf. F32).
  - Documentação ou mensagens de erro discrimináveis pelo cliente (cf. F2-F7).

---

## 6. Resumo de severidade

- **CRÍTICO:** 1 (F1)
- **ALTO:** 12 (F2, F3, F4, F8, F15, F23, F39, F60, F61, F63, F64)
- **MÉDIO:** ~25
- **BAIXO:** ~15
- **INFORMATIVO:** ~15

## 7. Recomendações prioritárias

1. **Ativar logger Fastify e `setErrorHandler` global** (F60, F61) — pré-requisito para todo o resto.
2. **Adicionar `console.error` / log estruturado antes de cada `} catch { return 503 }`** (F2-F7).
3. **Envolver `app.listen` em try/catch com shutdown gracioso** (F1).
4. **Adicionar timeouts** em: Google OAuth (F15), `pg_dump` (F63), S3 upload (F64), Postgres pool (verificar), Redis (verificar).
5. **Sequenciar shutdown da API** (F23) e usar exit code != 0 em falhas (F24).
6. **Validar idempotência** dos inserts no `telemetry-worker` (F39).
7. **Configurar `removeOnFail`** com limite (F41).
8. **Validar `archivedAt`** em `findUserById` para sessões (F20).
9. **Adicionar retry de webhook** com backoff (F32) e rate-limit por API key (F21).
10. **Persistir cache parcial de source-map** (F10) e logar erros de leitura (F8).
