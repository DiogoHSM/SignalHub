# Design — MCP do SignalMonitor (investigação read-only)

**Data**: 2026-08-22 · **Status**: aprovado em brainstorm, aguardando plano de implementação
**Linear**: PER-477 (epic) · PER-478 (fase 1, read token) · PER-479 (fase 2, pacote MCP)

## Problema

Investigar um problema hoje exige abrir o console, escolher projeto/environment, e navegar entre Overview, Errors, Traces, APM e Users correlacionando na cabeça. Não há caminho para um agente (Claude Code, Claude Desktop, ChatGPT) ler a telemetria e fazer o diagnóstico.

A API já expõe **54 rotas** em `/query/*`, todas documentadas em OpenAPI. Falta credencial não-humana para consumi-las e uma camada de ferramentas que um LLM saiba escolher.

## Decisões tomadas

| Decisão | Escolha | Alternativa rejeitada |
|---|---|---|
| Transporte | stdio local primeiro; HTTP/OAuth remoto como fase 3 | Remoto já na fase 1 — arrasta PER-473 (sessões revogáveis) para dentro do escopo |
| Permissão | Somente leitura | Escrita/triagem/operação — fica para a fase 3 |
| Credencial | Read token novo, escopado e revogável | Reusar cookie de sessão (herda os 7 dias sem revogação do PER-473 e guarda senha de admin em config local); ler direto do Postgres (duplica regra de negócio, nunca vira remoto) |
| Forma das tools | ~9 tools por fluxo de investigação | Espelho 1:1 das 54 rotas (degrada escolha do modelo); genérico verbo+recurso (erro de parâmetro vira lista vazia em vez de erro) |

## Fase 1 — Credencial de leitura

### Tabela

`read_tokens`, migration `0047_read_tokens.sql`, espelhando `source_map_upload_tokens`:

```
id, project_id, environment_id, name, prefix, hash,
created_at, last_used_at, revoked_at
```

Repositório em `packages/db/src/repositories/read-tokens.ts`, cópia estrutural de `source-map-upload-tokens.ts` — inclusive o `hasActiveReadTokenScope` que exclui projeto/environment arquivado, que é o comportamento que a PER-474 pede em toda leitura.

ID prefixado `rdtok`. Segredo prefixado `shread_`, gerado pelo mesmo caminho de `createSourceMapUploadToken()` em `packages/telemetry/src/api-keys.ts`, com `hashApiKey`/`verifyApiKey` e o pepper existente. O segredo é one-time: nunca relido, nunca devolvido em GET.

### Guard

`requireHumanUser` (`apps/api/src/routes/query.ts:1687`) é o chokepoint único das 54 rotas. Vira `requireQueryPrincipal`, devolvendo união:

```ts
type QueryPrincipal =
  | { kind: "user"; user: AuthenticatedUser }
  | { kind: "read-token"; tokenId: string; projectId: string; environmentId: string };
```

Ordem: cookie de sessão primeiro (comportamento atual intacto), `Authorization: Bearer shread_…` como fallback. O parser de bearer já existe em `source-map-uploads.ts:17` e sobe para um módulo compartilhado.

**Duas regras não-negociáveis:**

1. **Principal de token só passa em handler de leitura.** Hoje existem seis mutações dentro de `/query/*`:

   ```
   PATCH /query/feedback/:id
   PATCH /query/error-groups/:id
   POST  /query/incidents/error-groups/:id/notes
   POST  /query/incidents/error-groups/:id/external-issues
   POST  /query/incidents/error-groups/:id/external-issues/draft
   POST  /query/incidents/error-groups/:id/silence
   ```

   Cada handler de mutação rejeita `kind: "read-token"` com `403 read_token_is_read_only` — inclusive `/external-issues/draft`, mesmo que só gere texto: o critério é o verbo, não a suspeita de efeito. A verificação mora no handler, nunca numa allowlist de path: allowlist de string apodrece silenciosamente quando alguém adiciona rota, e o teste que a cobre passa igual.
2. **O escopo do token sobrescreve os parâmetros.** `project_id`/`environment_id` da query string são **ignorados** para principal de token, não validados contra ele. Validar convida a resposta vazia silenciosa; sobrescrever torna o escopo um fato.

`last_used_at` é atualizado no caminho de verificação, como o token de upload.

### Rotas de admin

Quatro rotas espelhando `/admin/source-map-upload-tokens` (`apps/api/src/routes/admin.ts:3814-3912`):

```
GET    /admin/read-tokens
POST   /admin/read-tokens
PATCH  /admin/read-tokens/:id
DELETE /admin/read-tokens/:id
```

Cada uma precisa de entrada em `apps/api/src/openapi.ts` — `openapi-coverage.test.ts` falha nomeando a rota que faltar. Derivar params/respostas do handler.

### Console

Seção nova em Project Settings, espelhando `ArtifactsSection.tsx`. O segredo one-time **não pode viver em state de tela**: `ConsoleShellV2` remonta a tela via `key={seq}` a cada `ctx.reload`, que é o que acontece depois de toda mutação. Entregar por `ctx.onSecretCreated` e ler de `ctx.createdSecret` (mesma correção da PER-467).

Toda mutação passa por `runMutation()` (PER-454).

## Fase 2 — Pacote `@sigmon/mcp`

### Estrutura

`packages/mcp`, `private: true`, bin `sigmon-mcp`, `@modelcontextprotocol/sdk`.

```
src/
  client.ts      HTTP tipado sobre /query/*, um método por rota usada
  budget.ts      poda e truncamento de payload
  tools/         um arquivo por tool
  server.ts      registro das tools, agnóstico de transporte
  stdio.ts       entrypoint (bin)
```

`server.ts` não conhece transporte. A fase 3 adiciona `http.ts` importando o mesmo registro — nenhuma tool muda.

Configuração por env: `SIGMON_URL`, `SIGMON_READ_TOKEN`.

### As nove tools

| Tool | Rotas compostas |
|---|---|
| `describe_scope` | projeto/environment do token · `/query/events/properties` · `/query/releases` |
| `whats_broken` | `/query/overview` · `/query/operations` · `/query/error-groups` · `/query/apm/web-vitals` |
| `investigate_error` | `/query/incidents/error-groups/:id` · `/query/error-groups/:id/errors` · `/query/errors/:id/source-map-resolution` · `/query/incidents/error-groups/:id/notes` · `/query/incidents/mttr` · `/query/replays` |
| `trace_request` | `/query/traces` · `/query/traces/:id/spans` |
| `slow_endpoints` | `/query/apm/endpoints` · `/query/apm/service-map` |
| `user_journey` | `/query/users` ou `/query/entities/tenants` · `/query/sessions/:sessionId/timeline` |
| `llm_costs` | `/query/llm/summary` · `/query/llm/cost-by-model` · `/query/llm/by-prompt` · `/query/llm/by-tenant` |
| `search_events` | `/query/events` · `/query/events/properties` |
| `query` | `/query/aggregates/{events,errors,llm,traces}` · `/query/analytics/trends` — escape hatch com métrica em enum |

`describe_scope` não é enfeite: sem catálogo de eventos e releases, o agente chuta nome de evento e recebe lista vazia.

### Orçamento de resposta

O modo de falha característico de MCP de telemetria é estourar o contexto com um payload. Contrato de toda tool:

- teto explícito de linhas por seção, com default conservador
- campos podados por default; stack completo, payload bruto de evento e corpo de span só sob parâmetro explícito
- quando podou, o payload carrega `truncated: { section, returned, total, how_to_get_more }` — o agente precisa **saber** que viu um recorte, senão conclui em cima de amostra

### Erros

Sem stack, sem detalhe interno. `401` → "token inválido ou revogado; gere outro em Project Settings → Read tokens". `403` no caminho de escrita → "este token é somente leitura". Escopo divergente é erro nomeado, nunca lista vazia.

## Testes

- Repositório `read-tokens.ts`: criação, escopo arquivado, revogação, `last_used_at`, busca por prefixo — espelhando `source-map-upload-tokens`.
- Guard: sessão continua passando; bearer válido passa em leitura; bearer válido é rejeitado em mutação; parâmetro de escopo divergente é sobrescrito, não obedecido.
- Rotas de admin: cobertura OpenAPI (o teste existente cobra sozinho).
- Console: `ReadTokensSection.test.tsx`, incluindo o segredo sobrevivendo ao `ctx.reload`.
- Tools: contra client falso, verificando composição e poda. Um teste por tool provando que `truncated` aparece quando o teto é atingido.

Nenhum teste asserta forma de plano de query (PER-475).

## Documentação a atualizar

`DECISIONS.md` (ADR do read token: por que credencial nova em vez de sessão, e por que escopo sobrescreve em vez de validar) · `ARCHITECTURE.md` (o MCP como consumidor de `/query/*`) · `SECRETS.md` (`SIGMON_URL`, `SIGMON_READ_TOKEN`) · `CONSTRAINTS.md` (token de leitura nunca passa em mutação; escopo sobrescreve) · `GUARDRAILS.md` (linha para `packages/mcp/**` e para o guard) · `PROJECT-SUMMARY.md` (capacidade nova) · `STACK.md` (pacote novo).

## Fora de escopo

Tools de escrita, transporte HTTP/OAuth, distribuição pública no npm, multi-escopo num token só, e qualquer tool que exponha source original (a restrição de source map continua valendo).
