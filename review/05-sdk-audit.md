# Auditoria do SDK `@signal-hub/sdk`

Auditoria sênior de SDK/biblioteca focada em `packages/sdk/`. Não há modificação de
código. As severidades seguem a escala CRÍTICO / ALTO / MÉDIO / BAIXO / INFORMATIVO.

## Sumário

O SDK do SignalHub é uma biblioteca TypeScript/ESM single-package que expõe um
cliente único (`createSignalHubClient`) para enfileirar eventos, erros, LLM
calls, traces, spans e breadcrumbs, mais helpers de breadcrumbs de browser
(`createBrowserBreadcrumbs`). É bem estruturado, defensivo em vários pontos
(sanitização de chaves sensíveis, redação de padrões em previews, rate limit
de breadcrumbs, idempotência de flush em curso, fail-closed em payloads não
serializáveis, "deep" testes contra os schemas Zod de ingestão). Os testes
cobrem caminhos de retry, fluxo de flush concorrente, sanitização e contrato
com os schemas Zod.

Os principais riscos detectados são, em ordem de severidade:

1. CRÍTICO — Cliente único para Node e browser que aceita `apiKey` em texto
   plano e usa `Authorization: Bearer`. Não há separação de SDK browser/Node
   nem aviso sobre uso do `apiKey` no browser. Vetor para roubo de chave de
   ingestão e abuso direto da API de ingestão.
2. ALTO — Backoff exponencial **sem jitter** dentro de `sendSignal`, com
   `setTimeout` síncrono dentro da função (o flush de fila é sequencial e fica
   bloqueado durante o backoff de cada item). Não há `Retry-After` honrado.
3. ALTO — Retry budget aplicado por item, não globalmente. Combinação com
   `retainedItems` reposicionados no front da fila pode causar "starvation"
   do drain em incidentes parciais (cada novo flush re-tenta o mesmo item
   primeiro com backoff completo).
4. ALTO — Nenhum mecanismo de unload (`sendBeacon` / `fetch keepalive` /
   `pagehide`) — em SPAs, eventos enfileirados são perdidos ao fechar aba.
5. ALTO — `init` (i.e. `createSignalHubClient`) não é idempotente: a cada
   chamada cria-se um novo cliente, mas `createBrowserBreadcrumbs` instala
   patches globais em `console`, `globalThis.fetch` e `history.pushState`
   com escopo de módulo (singleton implícito). Mistura cliente
   factory-per-call com helper singleton-global, abrindo espaço para bugs
   sutis em HMR/dev e em SSR.
6. ALTO — Patches de `globalThis.fetch` e `console.*` em browser não
   detectam outros patches concorrentes (Sentry, Datadog, MSW). Captura
   espelha o que está acima na pilha quando o helper é instalado, mas a
   restauração no `stop()` só restaura se "ainda for o wrapper instalado"
   (good), porém durante a vida útil ocorre dupla observação ou loop de
   reentrância dependendo da ordem.
7. ALTO — Falha silenciosa: erros lançados dentro de listeners de
   breadcrumb (`emit`, `client.breadcrumb`) não estão sob `try/catch`; uma
   exceção em sanitização pode propagar de volta para o caller que disparou
   o fetch/click original do app do usuário.
8. MÉDIO — Não há `flushSize` (batching por tamanho); cada item vira uma
   requisição HTTP independente (1 evento = 1 POST), o que é caro e cria
   pressão na API.
9. MÉDIO — `enforcePayloadSize` usa um limite default de 64 KB que é maior
   que diversos limites server-side comuns; e a validação ocorre em
   `enqueue` mas não há checagem após `requeueFront` (ataque por
   re-enfileiramento é mitigado, mas o limite ainda é alto para browser).
10. MÉDIO — Não há `id` (event id / idempotency key) emitido pelo SDK em
    cada signal. Retries cegos podem duplicar eventos caso o servidor processe
    a primeira requisição mas a resposta seja perdida.

Demais achados (médio/baixo/informativo) estão na tabela.

## Tabela de Achados

| # | Severidade | Categoria | Local | Achado |
|---|---|---|---|---|
| 1 | CRÍTICO | Segurança / Browser | `packages/sdk/src/client.ts:48-55`, `packages/sdk/src/retry.ts:51-58` | API key embutida em código client-side via `Authorization: Bearer ${apiKey}`. Não há cliente separado para browser/server e nenhum aviso na API pública. |
| 2 | ALTO | Retry/Backoff | `packages/sdk/src/retry.ts:35-40, 47-91` | Backoff exponencial sem jitter; sem suporte a `Retry-After`; `429` cai no mesmo crescimento que `500`. |
| 3 | ALTO | Retry Budget | `packages/sdk/src/client.ts:162-211` | Retry budget é por-item dentro de `sendSignal`. Em queda parcial, `requeueFront` recoloca todos os itens retidos no front; próximo flush re-tenta cada um do zero, sequencialmente, com backoff completo. |
| 4 | ALTO | UX / Browser | `packages/sdk/src/client.ts:227-323`, `packages/sdk/src/browser-breadcrumbs.ts` | Não há gancho de unload (`sendBeacon`, `fetch keepalive`, `pagehide`, `visibilitychange`). Em SPAs ou push de navegação cross-origin, signals na fila são perdidos. |
| 5 | ALTO | API Pública / Idempotência | `packages/sdk/src/client.ts:39-66`, `packages/sdk/src/browser-breadcrumbs.ts:108-110, 304-499` | `createSignalHubClient` retorna um novo cliente a cada chamada. Já `createBrowserBreadcrumbs` mantém `consolePatch`/`fetchPatch`/`historyPatch` no escopo de módulo. Mistura factory-per-call com singleton global é inconsistente. |
| 6 | ALTO | Compatibilidade / Browser | `packages/sdk/src/browser-breadcrumbs.ts:304-499` | Patches monkey-patch de `console.warn/error`, `globalThis.fetch`, `history.pushState/replaceState` colidem com outros SDKs (Sentry, DataDog, MSW) e não detectam que já foram envelopados externamente. |
| 7 | ALTO | Tratamento de Erros | `packages/sdk/src/browser-breadcrumbs.ts:161-178, 358-409` | `emit` chama `client.breadcrumb(input)` sem try/catch. Wrapper de `fetch` em `addFetchListener` chama `notifyNetworkListeners` que executa listeners sem try/catch — uma exceção em qualquer listener vaza para o caller do `fetch` original do app. |
| 8 | MÉDIO | Performance | `packages/sdk/src/client.ts:162-178`, `packages/sdk/src/retry.ts:42-94` | Não há batching: cada signal vira uma requisição HTTP. Em volume, isso é caro para o consumidor e para a API. |
| 9 | MÉDIO | Compatibilidade | `packages/sdk/package.json:5-15` | Sem dual ESM/CJS, sem `browser` export, sem condições de exports. Consumidores CJS terão problemas. |
| 10 | MÉDIO | Segurança / Idempotência | `packages/sdk/src/retry.ts:42-94`, `packages/sdk/src/mapping.ts:55-197` | Nenhum `event_id` / `idempotency_key` é gerado pelo SDK. Retries podem causar duplicação se a resposta da primeira tentativa for perdida. |
| 11 | MÉDIO | Sanitização | `packages/sdk/src/sanitize.ts:189-205` | `enforcePayloadSize` mede após sanitização (correto), mas não há fallback para "truncar" — apenas drop completo. Sinais legítimos um pouco acima do limite são totalmente perdidos. |
| 12 | MÉDIO | Sanitização | `packages/sdk/src/sanitize.ts:60-99, 138-178` | Lista hardcoded de chaves sensíveis e padrões. Sem option pública para o consumidor adicionar chaves específicas do domínio (ex.: `apikey_legacy`, `customer_secret`). |
| 13 | MÉDIO | Browser breadcrumbs | `packages/sdk/src/browser-breadcrumbs.ts:144-302` | Não há cap de quantidade total de breadcrumbs em memória, apenas rate-per-minute. Em janela aberta por horas, listeners de `console`/`fetch` continuam ativos sem limite de uso de memória pelas closures internas. |
| 14 | MÉDIO | Browser breadcrumbs | `packages/sdk/src/browser-breadcrumbs.ts:144-178` | Quando `maxBreadcrumbsPerMinute` é atingido, breadcrumbs são silenciosamente descartados, sem nenhum sinal de `dropped` ou `onError`. |
| 15 | MÉDIO | Browser breadcrumbs | `packages/sdk/src/browser-breadcrumbs.ts:180-200` | Captura de cliques aceita `aria-label`, `title`, `textContent` de qualquer elemento clicado. Embora exista `sanitizeBreadcrumbText`, é um regex best-effort; campos como `name`/`value` de `<input>` poderiam ser capturados em integrações via `closest("label")`. |
| 16 | MÉDIO | API Pública | `packages/sdk/src/client.ts:39-66`, `packages/sdk/src/types.ts:26-38` | Sem default de `endpoint`. Útil para self-hosted, mas a validação `!options.endpoint` rejeita string vazia mas não rejeita URL inválida (`createSignalHubClient({ endpoint: "not-a-url", ... })` aceita). |
| 17 | MÉDIO | API Pública | `packages/sdk/src/client.ts:294-303` | `identify` faz shallow-merge mas não permite "reset" (logout). Não há `client.reset()` documentado. |
| 18 | MÉDIO | Sanitização | `packages/sdk/src/sanitize.ts:74-99` | A heurística `matchesSensitiveRoot` para a raiz `"secret"` tem uma exceção peculiar (`startsWith("secretary")` → endsWith) — sintoma de regra ad-hoc. Strings legítimas como `"secretaria_municipal"` ficariam redacted; "secretarialId" também. |
| 19 | MÉDIO | Mapping | `packages/sdk/src/mapping.ts:97-117` | `BreadcrumbInput.level` é declarado opcional, mas no schema Zod o default do servidor é `"info"`. SDK não preenche o default — está OK enquanto o schema mantém o default, mas há acoplamento implícito. |
| 20 | MÉDIO | Mapping | `packages/sdk/src/mapping.ts:147-168` | `createTraceSignal` sempre define `started_at` (gera novo `Date()` se omitido). Mas `BreadcrumbInput.timestamp` e `createBreadcrumbSignal` não geram timestamp default — inconsistência entre tipos de signals. |
| 21 | MÉDIO | Contrato | `packages/sdk/src/mapping.ts:152, 175` | Quando `endedAt` é fornecido mas `startedAt` não, o SDK seta `startedAt = new Date()` no momento da serialização, o que pode produzir `duration_ms = 0` ou negativo (clamped a 0). Isso oculta um bug do chamador. |
| 22 | BAIXO | Retry | `packages/sdk/src/retry.ts:3, 116-118` | `MAX_RETRIES = 10` é hard-cap. Configuração do usuário acima de 10 é truncada silenciosamente. Sem warning. |
| 23 | BAIXO | Retry | `packages/sdk/src/retry.ts:80-83` | No catch de fetch, o `error` é capturado e retornado, mas `AbortError` por timeout é tratado igual a erro de rede (ambos retryable). Provavelmente ok; mas se `controller.abort()` for chamado por outra coisa (signal externo, no futuro), seria tratado como retryable. |
| 24 | BAIXO | Cliente | `packages/sdk/src/client.ts:65-68, 227-231` | `flushIntervalMs` cria um `setInterval` que segura referência ao processo (Node). Não há `.unref()` — em scripts CLI curtos o processo não encerra naturalmente. |
| 25 | BAIXO | Cliente | `packages/sdk/src/client.ts:307-322` | `shutdown` aceita `shutdownOptions` mas chama `flush(shutdownOptions)` duas vezes na sequência. Se o segundo flush falhar com retryable e `discardOnFailure` for false, os itens permanecem na fila pós-shutdown. Não há terceira tentativa nem reporte. |
| 26 | BAIXO | Cliente | `packages/sdk/src/client.ts:78-103` | `enqueue` chama `sanitizePayload` mas o `signal.payload` já vem montado por `mergeContext` que faz spread de `defaultContext.metadata`. Se um campo já sensível existia em `defaultContext`, ele será redacted — bom. Porém, o efeito colateral é que `identify({ metadata: { token: "..." } })` resulta em todos os signals subsequentes mostrarem `metadata.token = "[REDACTED]"` no servidor; melhor seria redact no `identify` para feedback imediato. |
| 27 | BAIXO | Browser breadcrumbs | `packages/sdk/src/browser-breadcrumbs.ts:282-289` | Listener de console concatena `args.map(String)`. Para objetos complexos, `String(obj)` produz `"[object Object]"`, perdendo contexto útil sem violar segurança — mas a interface não permite ao consumidor escolher um formatter. |
| 28 | BAIXO | Browser breadcrumbs | `packages/sdk/src/browser-breadcrumbs.ts:362-382` | Wrapper de `fetch` chama `originalFetch.apply(globalThis, args)`. Se outra biblioteca espera `this` bound a um Realm específico ou `window`, o `globalThis` pode não ser equivalente em Web Workers ou frames. |
| 29 | BAIXO | Mapping | `packages/sdk/src/mapping.ts:97-117` | `createBreadcrumbSignal` faz spread `...context` antes de injetar `timestamp: input.timestamp`. Se `context` tiver seu próprio `timestamp`, ele é sobrescrito silenciosamente pelo do `input.timestamp` (mesmo se este for `undefined`). Verificado: como passa via `assignDefined` no `mergeContext`, undefined é descartado — ok, mas a intenção é frágil. |
| 30 | BAIXO | Tipos | `packages/sdk/src/types.ts:36, 122-127` | `SignalHubErrorCode` exporta `"invalid_payload"`, mas esse código nunca é emitido em `client.ts` — código morto / contrato incompleto. |
| 31 | BAIXO | Tipos | `packages/sdk/src/types.ts:111-113` | `FlushOptions.discardOnFailure` aceita `boolean`, mas o efeito é "descarta toda a retentativa pendente neste flush". O nome sugere "drop on first failure"; pode confundir o consumidor. |
| 32 | BAIXO | Build | `packages/sdk/tsconfig.build.json:1-9`, `packages/sdk/package.json:10-15` | `tsc` puro como bundler. Sem minify, sem tree-shake check, sem `types` field de bundler-friendly, sem `sideEffects: false` — ruim para bundle size em browser. |
| 33 | BAIXO | Build | `packages/sdk/package.json:20-22` | `nanoid@5` é ESM-only e atende o target. `nanoid` é usado apenas em `startTrace`; é uma dependência forte (~bytes) para um único uso. Poderia ser injetável. |
| 34 | INFORMATIVO | Source maps | (não existe no SDK) | Não há fluxo de upload de source maps no SDK. Mapping/release está limitado ao envio do campo `release` no envelope. Consistente com `CONSTRAINTS.md` que diz que upload é "local-first" e fora do escopo do SDK; OK. |
| 35 | INFORMATIVO | Sanitização | `packages/sdk/src/sanitize.ts:138-178` | Sanitização é defensiva com `WeakSet` para detectar ciclos. Boa prática. |
| 36 | INFORMATIVO | Cliente | `packages/sdk/src/client.ts:105-160` | A concorrência entre `flush` em curso e itens enfileirados durante o flush é resolvida com `pendingFlushAfterActive` — mecanismo razoável e testado, mas complicado de evoluir. |

## Detalhes

### CRÍTICO #1 — API key em código client-side (`client.ts:48-55`, `retry.ts:51-58`)

O construtor exige `apiKey: string` e o `sendSignal` envia
`authorization: Bearer ${input.apiKey}`. Para Node/server, isso é correto.
Para browser (e o SDK declara explicitamente um helper de breadcrumbs de
browser), o consumidor que usa o mesmo cliente está embutindo o secret em
um bundle público — qualquer usuário pode extrair e reabusar a chave para
enviar dados arbitrários para o tenant.

Recomendações (não aplicadas):

- Separar em dois entrypoints publicados: `@signal-hub/sdk/node` e
  `@signal-hub/sdk/browser`. O browser deve usar `publicKey` curto, com
  rate-limit e CORS por origem, idealmente trocado pelo servidor por
  `apiKey` de sessão. Ou então um endpoint `/v1/ingest/public` aceitando
  chaves de envio limitadas em escopo.
- Documentar explicitamente em README que o cliente atual só deve ser
  usado em server. (Não existe README no pacote.)

### CRÍTICO/ALTO #2 — Backoff sem jitter (`retry.ts:35-40`)

```ts
export function createRetryDelay(attempt: number, baseDelayMs: number): number {
  ...
  return Math.min(MAX_RETRY_DELAY_MS, normalizedBaseDelayMs * 2 ** normalizedAttempt);
}
```

Exponencial puro: na queda parcial de uma API, todos os clientes recuperam
em janelas sincronizadas (thundering herd). Falta jitter (full ou
"decorrelated jitter"). Também não há leitura de `Retry-After` (HTTP 429 /
503) — `retry.ts:67-79` apenas classifica o status, ignorando o header.

### ALTO #3 — Retry budget por-item e head-of-line blocking (`client.ts:162-211`)

`flushQueue` itera `for (const signal of items)` chamando
`await sendSignal(...)` — sequencial. Se o primeiro item é retryable e
demora `baseDelayMs * 2^maxRetries`, os demais ficam atrás.
`requeueFront(retainedItems)` recoloca-os no front; o próximo flush, ao
drenar, os ataca de novo com retry-budget completo. Não há circuit breaker
global ("backoff até hora X") nem "drop after N total failures".

### ALTO #4 — Sem unload em browser

Nenhuma chamada a `navigator.sendBeacon` ou `fetch(..., { keepalive: true })`.
Nenhum listener de `pagehide`/`visibilitychange`. Em uma SPA, um clique em
"Pagar" que dispara `track("checkout_completed")` seguido de `window.location =
"/done"` perde o evento. O `flushIntervalMs` pode ser baixo, mas há sempre
uma janela.

### ALTO #5 — Idempotência de `init` vs singletons globais

`createSignalHubClient` (client.ts:39) é factory pura: cria um novo cliente
a cada chamada. Mas `createBrowserBreadcrumbs` (browser-breadcrumbs.ts:108-110,
304+) mantém `consolePatch`, `fetchPatch`, `historyPatch` em variáveis de
módulo. Chamar duas vezes: o segundo chamada compartilha o patch e
adiciona-se ao Set de listeners — comportamento documentado pelos testes
(linha 120-141, 195-221, 288-308 de `browser-breadcrumbs.test.ts`), mas
não pelo nome da API. Em HMR (dev), múltiplas instâncias se acumulam.
Em SSR/dual-render, `getDocument()` retorna undefined no server e o helper
silenciosamente não captura nada — não há erro ou warning.

### ALTO #6 — Monkey-patches conflitantes

`addFetchListener` (browser-breadcrumbs.ts:358-410) substitui
`globalThis.fetch` por um wrapper. Se outro SDK fizer o mesmo *depois*,
nosso wrapper passa a ser chamado *pelo* deles. Se *antes*, nosso wrapper
encapsula o deles. O `stop()` só restaura se `globalThis.fetch ===
patch.wrapper`. Se outro SDK encapsulou nosso wrapper, a restauração é
no-op (ok) e o wrapper antigo continua na cadeia — vazamento sutil. Idem
para `console.warn/error` e `history.pushState`.

### ALTO #7 — Exceções podem vazar para o app

`addFetchListener` (browser-breadcrumbs.ts:362-382) chama
`notifyNetworkListeners(result)`. `notifyNetworkListeners` (412-418)
itera `for (const listener of listeners) listener(result)` sem try/catch.
Os listeners chamam `emit(...)`, que chama `client.breadcrumb(input)` —
que internamente chama `sanitizePayload` e `enforcePayloadSize`. Uma
exceção em qualquer ponto pode propagar para *dentro da pilha do
`fetch()` do app do usuário*, podendo quebrar a feature do consumidor.
Para uma biblioteca de observabilidade, isto é inaceitável; o
`try/catch` deveria cercar todos os entry points externos (`emit`,
`client.*`, monkey-patch wrappers).

### MÉDIO #8 — Falta batching

`flushQueue` faz uma requisição por item. Para um console que dispara
20 breadcrumbs em um minuto + 5 errors + 30 events, são 55 POSTs. A API
de ingestão deveria expor um endpoint `/v1/batch` aceitando array,
e o SDK deveria agrupar por `kind` e tamanho até atingir `flushSize` ou
`flushIntervalMs`.

### MÉDIO #9 — Sem dual build

`package.json` declara apenas `default` em `exports."."`. Não há condições
`"browser"`, `"import"`, `"require"`, nem CJS. Apps Vite/Next vão importar
ok, mas projetos CommonJS antigos quebram.

### MÉDIO #10 — Sem `event_id` / idempotency

`createEventSignal` (mapping.ts:56-71) etc. não geram um `id` por signal.
O servidor não pode deduplicar em retries — se a primeira tentativa do
SDK atingir o servidor mas a resposta for cortada, o retry duplica.
Solução padrão: `nanoid()` ou `crypto.randomUUID()` por signal, enviado
em header `Idempotency-Key` ou no body.

### MÉDIO #11 — Drop-only quando excede tamanho

`enforcePayloadSize` (sanitize.ts:189-205) retorna `ok=false` para tudo
acima de `maxBytes`. Não há fallback para truncar `properties`/`context`
ou substituir por `"[truncated]"`. Eventos grandes legítimos são
perdidos sem alternativa.

### MÉDIO #12 — Sanitização não configurável

`SENSITIVE_KEYS`, `PREVIEW_KEYS`, `SHORT_TEXT_KEYS` (sanitize.ts:17-60)
são constantes de módulo. `sanitizePayload` aceita apenas
`maxStringLength`. Não há option pública para acrescentar chaves
sensíveis específicas do domínio do consumidor (ex.: `cnpj`, `iban`,
`customer_id_internal`).

### MÉDIO #13/#14 — Breadcrumbs sem cap global e drop silencioso

`createBrowserBreadcrumbs` aplica `maxBreadcrumbsPerMinute` (padrão 120)
mas:

- Não há limite total de breadcrumbs por client.
- O drop por rate-limit (linha 172-174) não chama `onError` nem aumenta
  contador exposto.

### MÉDIO #15 — Click capture e `closest("label")`

`summarizeClickedElement` (browser-breadcrumbs.ts:129-142) chama
`associatedLabelText(element)` que faz `element.closest("label")`. Em
formulários encapsulados, isso pode capturar texto sensível
("Senha", "CPF do titular"). Há `compactText` mas a redação só remove
padrões explícitos, não nomes de campos. PII potencial em telemetria.

### MÉDIO #16 — Validação fraca de `endpoint`

`createSignalHubClient` (client.ts:40-54) rejeita string vazia mas
aceita qualquer outra string, incluindo `"not-a-url"`. O `replace` de
trailing `/` segue. Erro só aparece em runtime, no primeiro flush.

### MÉDIO #17 — Sem `reset()` / logout

`identify` só faz merge. Não há forma de limpar `userId`/`tenantId` —
em apps SaaS, logout deveria invocar `client.reset()` para evitar que
eventos pós-logout sigam atribuídos ao usuário anterior.

### MÉDIO #18 — Heurística "secretary" estranha em `matchesSensitiveRoot`

`sanitize.ts:74-82`:

```ts
function matchesSensitiveRoot(normalizedKey: string): boolean {
  return SENSITIVE_ROOTS.some((root) => {
    if (root === "secret" && normalizedKey.startsWith("secretary")) {
      return normalizedKey.endsWith(root);
    }
    return normalizedKey.startsWith(root) || normalizedKey.endsWith(root);
  });
}
```

Tentativa de evitar falso positivo em "secretary" — mas qualquer chave
começando com `"secret"` (ex.: `"secretariaInterna"`) ainda matches via
`startsWith("secret")`, exceto justamente "secretary". Regra ad-hoc que
acumula complexidade para um caso quase irreal.

### MÉDIO #19/#20/#21 — Mapping inconsistências

- `BreadcrumbInput.level` default é definido apenas pelo schema Zod
  server-side, não pelo SDK (mapping.ts:97-117).
- `createBreadcrumbSignal` não força um `timestamp` default
  (mapping.ts:97-117), enquanto `createTraceSignal` força
  `startedAt = new Date()` (152). Inconsistente.
- `createTraceSignal`/`createSpanSignal` aceitam `endedAt` sem
  `startedAt` e geram `startedAt = new Date()`, escondendo bug do caller.

### Demais detalhes

Ver tabela acima para itens 22-36.

## Compatibilidade (Ambiente)

- **Single bundle**: o SDK não distingue Node vs browser. `client.ts` e
  `retry.ts` usam apenas `globalThis.fetch`, `globalThis.AbortController`
  e `setTimeout` — compatível com Node 18+ e browsers modernos.
- **Detecção runtime**: `browser-breadcrumbs.ts` usa
  `(globalThis as { document?: unknown }).document` e checagens
  defensivas (`isDocumentLike`, `isWindowLike`, etc.) antes de
  instalar handlers de DOM — bom. Mas instala patches em
  `console.warn/error` e `globalThis.fetch` mesmo em Node, o que pode
  ser indesejado.
- **Build target**: `tsconfig.base.json` define `ES2022` + `NodeNext`.
  O `package.json` declara `"type": "module"` (puro ESM). Bom para
  Node 18+ e bundlers modernos; quebra Node CJS legado e diversos
  projetos que ainda dependem de CJS.
- **Exports map**: apenas `"."` com `default`. Sem `"./browser"`,
  sem `"./node"`, sem condições.
- **Bundle**: não há `"sideEffects": false` em `package.json`. Tree
  shaking é prejudicado; o consumidor que só importa `serializeDate`
  acaba arrastando o módulo inteiro (incluindo possivelmente
  `browser-breadcrumbs` se for uma re-export do `index.ts` — e é, na
  linha 47-49).
- **Browser-specific APIs em código compartilhado**: `console`,
  `globalThis.fetch`, `globalThis.history` em `browser-breadcrumbs.ts`.
  Todos protegidos por feature-detection (`isHistoryLike` etc.).
  `URL`/`URLSearchParams` são standard em Node 18+; OK.
- **Node-only APIs em código compartilhado**: nenhuma detectada.

## Segurança

- **PII**: `client.identify` aceita `metadata` arbitrária — qualquer
  campo que o consumidor passar é enviado. A sanitização redacta apenas
  chaves cujo nome bate com padrões sensíveis. Campos como
  `customer_email`, `cpf_holder`, `address_full` passam direto. Não há
  allowlist nem opção para o consumidor declarar campos PII.
- **API key**: ver CRÍTICO #1.
- **Sanitização**: `sanitize.ts` cobre as suspeitas comuns
  (`password`, `token`, `secret`, `apiKey`, `cookie`, `creditcard`,
  `cpf`) e protege com truncamento, redação de padrões em previews,
  e fail-closed em payloads não serializáveis. Boa prática:
  - `enforcePayloadSize` retorna `{ ok: false, bytes: Infinity }` para
    payloads circulares ou com BigInt (sanitize.ts:192-197).
  - `WeakSet` para detectar ciclos sem mutar.
- **Tamanho de payload (DoS)**:
  - Limite default 64 KB por signal (`DEFAULT_MAX_SERIALIZED_PAYLOAD_BYTES`).
  - Queue cap default 1000.
  - Não há controle de taxa de envio.
- **Header `Authorization: Bearer`**: em browser, o pre-flight CORS pode
  vazar a chave em `OPTIONS` se o servidor não estiver bem configurado.
- **Verificação de TLS / pinning**: confiança total no `fetch` do host.
  OK para SDK; documente que `endpoint` deve ser HTTPS.
- **Logs locais**: nenhum — bom, não loga `apiKey` em console.

## Retry / Queue

- **Backoff**: exponencial puro, cap 30 s, sem jitter, sem
  `Retry-After`. Ver ALTO #2.
- **Cap de retentativas**: hard cap interno 10 (`MAX_RETRIES`) sobreposto
  ao input do usuário. `retry.ts:116-118`.
- **Classificação de status**: `200-299` sucesso, `408/429/5xx`
  retryable, demais permanentes. `retry.ts:23-33`. Boa cobertura.
- **Idempotência**: ausente. Ver MÉDIO #10.
- **Fila in-memory**: array simples com FIFO drop-oldest em overflow
  (`queue.ts:24-41`). `consumeDropped` reseta o contador — alinhado
  com o pattern do `flush`.
- **Persistência offline**: nenhuma. Não há localStorage/IndexedDB.
  Em browser, recarregar a página perde a fila. Para um SDK self-hosted
  de telemetria, isso é uma falha de UX importante.
- **Replay em reconexão**: não existe. Não há listener de
  `online`/`offline`. Quando a rede volta, só o próximo `flush`
  (interval ou manual) tenta de novo, e cada item paga seu próprio
  backoff de novo (ver ALTO #3).
- **`requeueFront`**: bom para preservar ordem em retentativa, mas
  trim back pode descartar itens mais recentes em favor de itens
  retidos — o oposto do drop-oldest normal. Comportamento documentado
  no teste `queue.test.ts:54-65`, mas é uma decisão de design
  (preferência por retentativa vs. dados frescos) que merece doc.

## API Pública

- **`createSignalHubClient`**: factory clara, valida `endpoint` e
  `apiKey`. Aceita injeção de `fetch` (bom para teste). Retorna um
  cliente sólido tipado.
- **Tipos exportados**: `index.ts` re-exporta `BrowserBreadcrumbOptions`,
  `StopBrowserBreadcrumbs` e a maioria dos tipos relevantes de `types.ts`.
  Falta export de `EnvelopePayload` (mapping.ts:15) e
  `PayloadSizeResult` / `SanitizeOptions` (sanitize.ts:1-8) — provavelmente
  intencional, mas extensões customizadas ficam restritas.
- **`SignalHubErrorCode` morto**: `"invalid_payload"` é declarado mas
  nunca emitido.
- **`init` idempotente**: não — ver ALTO #5.
- **Default endpoint**: nenhum. OK para self-hosted.
- **`reset()`**: ausente — ver MÉDIO #17.
- **API consistente**: `track`/`captureError`/`breadcrumb`/`llm`/`trace`/`span`
  seguem padrão. `startTrace` retorna `ActiveTrace`. Boa simetria.
- **`shutdown`**: aceita `FlushOptions`. Faz duplo flush mas não há
  terceiro fallback (ver BAIXO #25).
- **`flush` concorrente**: bem resolvido com `inFlightFlush` +
  `pendingFlushAfterActive`. Coberto por testes.

## Breadcrumbs (Browser)

- **Quantidade**: rate-limit padrão 120/minuto (DEFAULT_MAX_BREADCRUMBS_PER_MINUTE).
  Sem cap absoluto. Ver MÉDIO #13.
- **Drop silencioso** ao exceder rate-limit. Ver MÉDIO #14.
- **Sanitização de URLs**: `sanitizeBreadcrumbUrl` (browser-breadcrumbs.ts:112)
  faz redact de query strings inteiras, mantendo apenas as chaves.
  Exemplo: `"https://app.example.com/checkout?token=secret&page=2#card"` →
  `"/checkout?token=[REDACTED]&page=[REDACTED]"`. Bom — mas note que
  *qualquer* valor de query é redacted, mesmo não-sensíveis (pode
  reduzir utilidade da telemetria).
- **Captura de cliques**: opcional (default `false`). `summarizeClickedElement`
  evita capturar `value` de inputs (browser-breadcrumbs.ts:139) e
  redacta padrões em labels/textos via `sanitizeBreadcrumbText`.
  Risco residual em formulários com labels descritivas (ver MÉDIO #15).
- **Captura de inputs**: não implementada — bom.
- **Console**: opcional (default `false`). Captura `warn` e `error`,
  truncamento a 2000 chars, redação de bearer/email/password.
  Não captura `console.log`/`info` — alinhado com convenção de outros
  SDKs.
- **Network**: opcional. Captura método, URL sanitizada, status,
  duração. Não captura body nem headers — bom.

## Contrato SDK ↔ Ingestion API

- Tests `contract.test.ts` validam cada payload contra os schemas Zod
  de `@signal-hub/telemetry/ingestion-schemas`. Cobre event, error,
  llm, trace, span. **Não cobre breadcrumb** — ver lacunas de teste.
- Schemas Zod e mapping concordam em snake_case e nas chaves
  esperadas. `tenant_id`, `user_id`, `session_id`, `trace_id`,
  `source`, `release`, `metadata`, `properties`, `started_at`,
  `ended_at`, `duration_ms`, `prompt_name`, `input_tokens`,
  `output_tokens`, `cost_usd`, `latency_ms`, `input_preview`,
  `output_preview` — todos batem.
- **Versionamento**: endpoint path é `/v1/*` mas não há header
  `X-SignalHub-SDK-Version` ou similar. Servidor não consegue
  distinguir SDKs em rolagens de mudança de schema.
- **`event_id` / idempotency**: ausente em SDK e em schema — alinhado,
  mas é uma lacuna em ambos. Ver MÉDIO #10.
- **Limites de string**: SDK respeita os limites declarados em
  `ingestion-schemas.ts` (`SHORT_TEXT_MAX=256`,
  `MEDIUM_TEXT_MAX=2000`, `LONG_TEXT_MAX=20000`). Teste em
  `sanitize.test.ts:51-71`.
- **Severity / level enums**: SDK aceita `BreadcrumbLevel = "debug" |
  "info" | "warning" | "error" | "fatal"`. Schema aceita os mesmos —
  ok. `ErrorSeverity` idem.

## Lacunas de Teste

1. **Idempotência de `createSignalHubClient`**: não há teste que
   instale o cliente duas vezes e verifique comportamento dos patches
   globais via `createBrowserBreadcrumbs`. Há testes de "out of order
   stop" (overlapping helpers) mas não de chamada duplicada de
   `createBrowserBreadcrumbs` com mesma opção em mesma página.
2. **Sem teste de unload** (`pagehide`/`beforeunload`/`visibilitychange`)
   — porque o SDK não implementa. Documentar e adicionar quando
   `sendBeacon`/`keepalive` for introduzido.
3. **Sem teste de retry com `Retry-After` header**.
4. **Sem teste de jitter** (porque não existe jitter).
5. **Sem teste de duplicação por retry** (porque não existe idempotency
   key). Adicionar quando idempotency for adicionada.
6. **Contrato de breadcrumb**: `contract.test.ts` não exercita
   `breadcrumbPayloadSchema`. O `createBreadcrumbSignal` não é testado
   contra o schema Zod.
7. **Contrato de schemas com defaults**: testes passam payloads
   completos; não testam que o SDK *não* preenche `level` em
   breadcrumb e que o schema aplica o default `"info"`.
8. **Concorrência em `identify`**: não testa identify chamado durante
   um flush em curso.
9. **Falhas em listeners de console/fetch**: nenhum teste exercita
   listener que lança — para validar que o app do consumidor não
   quebra (ver ALTO #7).
10. **Cap de memória de breadcrumbs**: sem teste para uso de memória
    em runtime longo.
11. **Localização/timezone**: `serializeDate` usa `toISOString`; sem
    teste com `Date` em fuso não-UTC para confirmar invariância.
12. **`enforcePayloadSize` em strings com unicode multibyte**:
    `TextEncoder` é usado, então deveria estar correto. Sem teste
    explícito.
13. **`flushQueue` quando `discardOnFailure=true` e o item é permanente**:
    coberto. Mas `discardOnFailure=true` com mix (alguns retryable,
    alguns permanentes) — não há teste.
14. **`startTrace.end` sem `endInput` em janela com `vi.setSystemTime`
    invariante** (já coberto). Mas `startTrace` chamado dentro de
    interval-flush não é testado.
15. **DOM sem `CSS.escape`**: `cssEscape` (browser-breadcrumbs.ts:574)
    tem fallback para regex simples. Sem teste explícito.
16. **Patch concorrente externo**: nenhum teste simula outro código
    encapsulando `console.error` ou `globalThis.fetch` entre a
    instalação e o `stop()` do SDK.
17. **`requeueFront` com fila cheia + dropped count + onError de
    `queue_overflow`**: o teste cobre o caso simples. Combinação de
    requeue + enqueue subsequente que estoura — não testada.
18. **Sem teste para `flushIntervalMs` interagindo com falha de
    rede recorrente** (verificar que `setInterval` não dispara
    re-entrante quando `flush` anterior ainda está em curso —
    o código atual reutiliza `inFlightFlush`, então não dispara, mas
    não há teste).

---

Fim do relatório.
