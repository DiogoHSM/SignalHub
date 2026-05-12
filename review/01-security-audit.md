# Auditoria de Segurança - SignalHub (Fase 5C)

Auditor: revisão estática, sem alteração de código.
Escopo: `apps/api/src/`, `packages/telemetry/src/`, `packages/db/src/repositories/` (com extensões pontuais para `packages/config/src/index.ts` e `apps/worker/src/alerts.ts`, dado o acoplamento com SSRF e segredos).
Convenções: severidade `CRITICO`/`ALTO`/`MEDIO`/`BAIXO`/`INFORMATIVO`. Caminhos absolutos. Citações no formato `arquivo:linha`.

---

## 1. Sumário Executivo

A base apresenta higiene de segurança claramente acima da média para um projeto self-hosted: queries via Kysely com binding parametrizado, hashes Argon2id para senhas, peppered SHA-256 para API keys, validação Zod nos schemas de ingestão, defesa contra path traversal e symlinks em source-maps, validação de SSRF para webhooks de alerta (com lookup duplo em produção), proteção contra zip bomb e proteção CSRF natural via SameSite=lax + JSON body.

Apesar disso, há um conjunto consistente de problemas que merecem atenção antes de uma exposição mais ampla. Os achados mais críticos:

- **Bypass de SSRF e exposição de metadados em cloud (CRITICO)**: `validateWebhookUrl` em `routes/admin.ts` só rejeita hosts privados quando `NODE_ENV === "production"`. Não-prod permite apontar webhook para `169.254.169.254`, `127.0.0.1`, etc. Mesmo em prod, a validação só ocorre na admin route — não há resolução DNS antes do salvamento, e o `validateWebhookTarget` no worker (que é a única camada com `lookup` validador) é desligado quando `nodeEnv !== "production"`. Há ainda gap envolvendo metadados de cloud em IPv6 (`fd00:ec2::254`) que entra pelo branch ULA mas só em produção, e workloads em ECS/EKS podem expor credenciais via `169.254.170.2`. A regra de bloqueio cobre `169.254.0.0/16` em IPv4 (boa), mas note que esta proteção depende inteiramente de `NODE_ENV`.
- **Falta de autorização por projeto / multi-tenant fraco (ALTO)**: Qualquer usuário autenticado (não-admin) pode consultar qualquer `project_id`/`environment_id` em todas as rotas `/query/*`, `/alerts/events`, `/query/sessions/.../timeline`, `/system/health`. Não há tabela de associação user↔project, então o conceito de "multi-tenant" é apenas para clientes finais (telemetria), não para operadores do console. Isso significa que qualquer usuário com sessão pode ler dados de qualquer projeto.
- **Rate limit global sem dimensão por IP/usuário em rotas críticas (ALTO)**: `rateLimit({ max: 1000, timeWindow: "1 minute" })` é aplicado globalmente, mas: (a) Fastify rate-limit por padrão particiona por IP, mas 1000 req/min por IP é alto demais para `/auth/login` (permite ~16 tentativas/s); (b) não há rate limit dedicado por chave de API para `/v1/*` (uma chave roubada pode envenenar 1000 req/min × N IPs); (c) o login não tem rate limit por email/usuário, permitindo password spray distribuído.
- **Ausência de cabeçalhos de segurança (ALTO)**: nenhum `helmet`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Content-Security-Policy`, `Referrer-Policy` é configurado em `app.ts`. O console é servido pelo mesmo origem, então um XSS no console (eventual) seria amplificado pela falta de CSP/clickjacking protection. `/console/index.html` é servido por `@fastify/static` sem cabeçalhos hardening.
- **Bootstrap de OAuth do Google permite hijack por colisão de email (ALTO)**: Em `apps/api/src/main.ts:258-265`, o fluxo `completeGoogleOAuth` faz `findUserByEmail` quando não encontra por `googleSubject`. Se um usuário foi criado por email/senha e nunca vinculou Google, qualquer usuário que controle aquele endereço de email do lado Google (administrador do tenant Google Workspace, ou alguém que reivindicou um Gmail descartado) pode efetuar takeover, porque o `email_verified` é controlado pelo IdP (Google), mas a base SignalHub não exige confirmação manual de vinculação. Em organizações sem domain restriction (`hd` claim), isto é especialmente perigoso.
- **Logger desabilitado (MEDIO)**: `Fastify({ logger: false })` em `apps/api/src/app.ts:41`. Nenhuma trilha de auditoria, nenhum log de tentativas de login, criação de admin, criação de chave, deleção, etc. Operacionalmente quebra forense de incidentes.

Há também múltiplos pontos médios/baixos detalhados abaixo.

---

## 2. Tabela de Achados

| ID    | Área                | Severidade   | Local                                                            | Resumo |
|-------|---------------------|--------------|------------------------------------------------------------------|--------|
| F-01  | Webhooks/SSRF       | CRITICO      | `apps/api/src/routes/admin.ts:329-346`                           | `validateWebhookUrl` só bloqueia hosts privados em produção; em dev/test/CI aceita `localhost`, `169.254.169.254`, etc. e essa URL é persistida. |
| F-02  | Webhooks/SSRF       | ALTO         | `apps/worker/src/alerts.ts:186-243`                              | Bloqueio de IP privado para webhooks só ocorre em produção; verificação de DNS resolution feita uma vez antes do request abre janela de DNS-rebinding sem o lookup validador. |
| F-03  | Webhooks/SSRF       | MEDIO        | `apps/api/src/routes/admin.ts:439-451`, `apps/worker/src/alerts.ts:565-577` | IPv4 privado não cobre `100.64.0.0/10` (CGNAT), `198.18.0.0/15` (benchmarking), classe E (`240.0.0.0/4`), broadcast (`255.255.255.255`), multicast (`224.0.0.0/4`). Falta também broadcast/multicast IPv6 (`ff00::/8`, ULA `fc00::/7` está coberto mas mal: a máscara `0xfe00 == 0xfc00` cobre `fc00::/7` correto). |
| F-04  | Auth                | ALTO         | `apps/api/src/main.ts:246-272`                                   | Google OAuth vincula automaticamente a conta local por email se conta existe sem `googleSubject` previamente vinculado. Sem confirmação out-of-band permite takeover. |
| F-05  | Authz               | ALTO         | `apps/api/src/routes/query.ts:798-812`, `routes/system.ts:93-110`, `routes/alerts.ts:30-44` | Qualquer usuário autenticado (não-admin) pode consultar qualquer `project_id`/`environment_id`. Não existe tabela de membership user↔project. |
| F-06  | Rate Limiting       | ALTO         | `apps/api/src/app.ts:56`, `routes/auth.ts:76-92`                 | Rate limit global 1000 req/min, mas `/auth/login` não tem rate limit específico por email/IP, permitindo password spray. |
| F-07  | Rate Limiting       | MEDIO        | `apps/api/src/app.ts:56`, `routes/ingestion.ts`                  | Sem rate limit por chave de API. Uma chave roubada pode ser usada de N IPs para escalonar 1000 req/min cada. |
| F-08  | Headers/CSP         | ALTO         | `apps/api/src/app.ts:40-56`                                       | Sem `helmet` ou equivalente. Faltam: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`. |
| F-09  | Logging             | MEDIO        | `apps/api/src/app.ts:41`                                          | `logger: false`. Falta trilha de auditoria das ações administrativas e tentativas de login. |
| F-10  | Auth (sessão)       | MEDIO        | `apps/api/src/main.ts:94-154, 304-306`                            | Sessão é JWT-like sem revogação. `logout` apenas limpa cookie cliente. Sessão exfiltrada permanece válida por até 7 dias (`sessionMaxAgeSeconds`). |
| F-11  | Auth (sessão)       | BAIXO        | `apps/api/src/main.ts:120-154`                                    | Parsing da sessão: `JSON.parse(Buffer.from(encodedPayload, "base64url"))` antes do `timingSafeStringEqual` (ordem está OK), porém não usa AAD/version, então rotação de chaves força invalidação total. |
| F-12  | CORS                | INFORMATIVO  | `apps/api/src/app.ts:43-46`                                       | `origin: false` por padrão, `credentials: true` somente quando origem é fornecida — comportamento conservador correto. Documentar. |
| F-13  | Multipart           | BAIXO        | `apps/api/src/app.ts:48-55`                                       | `parts: 6`, `fields: 4`, `files: 1` — corretos, mas `fileSize` default cai para `50 MB` (quando `maxUploadBytes` é undefined em testes). Aceitável. |
| F-14  | Source Maps         | MEDIO        | `apps/api/src/source-maps/storage.ts:38-52`                       | `validateStoragePath`: chama `lstat` e depois `realpath` — janela TOCTOU. Atacante com escrita no diretório (admin pode chegar lá via upload) poderia trocar arquivo por symlink entre as duas chamadas. Acesso requer admin já + escrita prévia, mas vale endurecer. |
| F-15  | Source Maps         | BAIXO        | `apps/api/src/source-maps/storage.ts:25-28`                       | `safeSegment` aceita `_` e nomes esvaziados viram `"unknown"`. IDs internos têm caracteres seguros, então não há ataque prático, mas se um dia `projectId` for derivado de usuário, o fallback `"unknown"` faz colisão entre projetos diferentes. |
| F-16  | Source Maps (zip)   | MEDIO        | `apps/api/src/source-maps/parser.ts:84-136`                       | `unzipSync` é chamado duas vezes (filter+real), dobra de CPU em uploads grandes; o filtro de tamanho descomprimido (`MAX_SOURCE_MAP_UNZIPPED_BYTES = 100MB`) usa `file.originalSize` reportado no header zip que é controlado pelo atacante. Um zip malicioso pode mentir o originalSize para escapar do filtro; `unzipSync` descomprime de qualquer forma. |
| F-17  | Source Maps (zip)   | BAIXO        | `apps/api/src/source-maps/parser.ts:113-117`                      | ZipSlip não-aplicável porque `normalizeMinifiedFile` resolve para basename antes de gravar, e o `storagePath` é construído a partir de `artifactId` (UUID), não do nome do entry. OK. |
| F-18  | Source Maps         | BAIXO        | `apps/api/src/source-maps/storage.ts:73`                          | `writeFile(... { flag: "wx" })` previne sobrescrever, mas `artifactId` é `randomUUID()` então colisões são teoricamente impossíveis; flag deveria também aplicar `mode: 0o600` para evitar leitura por outros processos do mesmo container. |
| F-19  | Authz/Cross-tenant  | ALTO         | `packages/db/src/repositories/source-maps.ts:236-275`             | `replaceErrorStackResolutions` valida que o errorId pertence ao escopo, mas isto só funciona porque o caller passa scope obtido do próprio errorId. O fluxo geral do `resolveErrorStackWithSourceMaps` em `resolver.ts:117-193` confia que o caller envia o `projectId/environmentId` correto — não há validação cross-tenant que reuse o scope da sessão. Combinado com F-05, qualquer user logado pode resolver source-maps de qualquer projeto. |
| F-20  | Validação Ingestion | MEDIO        | `packages/telemetry/src/ingestion-schemas.ts:12-23`               | `jsonValueSchema` é recursivo via `z.lazy`, sem limite de profundidade. Atacante com chave de API válida pode enviar JSON deeply nested (>10k níveis) causando ReDoS/stack overflow no parser Zod e no JSON.stringify do sanitizer. |
| F-21  | Validação Ingestion | BAIXO        | `packages/telemetry/src/ingestion-schemas.ts:23`                  | `jsonObjectSchema = z.record(z.string(), jsonValueSchema).default({})`. Não há `.strict()` nem limite de total de bytes do payload (50MB no body parser do Fastify). 1000 reqs/min × 1MB JSON cada = 1GB/min DoS efetivo. |
| F-22  | API Key             | BAIXO        | `packages/telemetry/src/api-keys.ts:19-21`                        | Hash de API key é SHA-256 com pepper (não HMAC, não argon2). Para tokens de alta entropia (40 chars `[a-zA-Z0-9]`) é defensável, mas `createHash` não é constant-time — se o atacante puder consultar o DB poderia tentar pré-computar. Recomenda-se HMAC ou argon2 para defesa em profundidade. |
| F-23  | Auth (timing)       | BAIXO        | `apps/api/src/main.ts:275-289`                                    | `login` em `auth.login`: se user não existe (`!user?.passwordHash`), retorna `null` imediatamente sem chamar `verifyPassword`. Cria timing oracle distinguindo email existente de inexistente. Adicionar um `verifyPassword` dummy ou um `hashPassword` calibrado. |
| F-24  | Bearer parsing      | BAIXO        | `apps/api/src/routes/ingestion.ts:40-48`                          | Regex `/^Bearer ([^\s]+)$/` é restritiva (impede tokens com espaço). Mas se uma chave for `null` ou vazia (`''`), o regex falha corretamente. OK na maior parte; apenas note que header `authorization` case-sensitive em "Bearer" — atacante (ou cliente legítimo) pode usar `bearer` minúsculo e ser rejeitado. RFC 7235 diz case-insensitive. |
| F-25  | Erro/Exposição      | INFORMATIVO  | múltiplos                                                          | Rotas devolvem `error: "..."` mensagens estáveis (boa prática), mas alguns `catch` engolem stack trace sem nada — bom para clientes, ruim para forense pois `logger: false` (ver F-09). |
| F-26  | OAuth state cookie  | MEDIO        | `apps/api/src/routes/auth.ts:123-133, 148-163`                    | Cookie de state tem `path: "/auth/google/callback"`. Em standards de browsers, o cookie só é enviado em requisições para esse path exato (ou subpath). Como o callback é exatamente esse path, funciona. Porém `clearCookie` na linha 163 também usa o mesmo path — se outra rota tentar limpar (improvável) falhará silenciosamente. |
| F-27  | OAuth state         | BAIXO        | `apps/api/src/routes/auth.ts:148-151`                             | Comparação `expectedState !== parsed.data.state` usa `!==` (não constant-time). Como o state é unique por sessão e descartado após uso, timing leak é menos crítico, mas é uma trivial melhoria. |
| F-28  | Mass assignment     | BAIXO        | `apps/api/src/routes/admin.ts:141-155`                            | `updateUserSchema` permite `isAdmin: boolean` — apenas admin pode chamar (`requireAdmin`), então OK. Porém *não há check* impedindo um admin de remover seus próprios privilégios e ficar sem nenhum admin no sistema (lockout). |
| F-29  | Multipart           | MEDIO        | `apps/api/src/routes/admin.ts:566-643`                            | `parseSourceMapUploadRequest` não valida `Content-Type` do arquivo enviado. Aceita qualquer mimetype e processa como JSON ou zip. Defesa em profundidade. |
| F-30  | Source Maps         | INFORMATIVO  | `apps/api/src/source-maps/storage.ts:54-80`                       | `storeSourceMapFile`: chama `mkdir(input.localDir, { recursive: true })` e `realpath(input.localDir)` — se `localDir` é manipulável por usuário com FS local, é vetor. Em produção `localDir` vem de env, OK. |
| F-31  | Cookie config       | BAIXO        | `apps/api/src/main.ts:198-205`                                    | Session cookie tem `secure: nodeEnv === "production"` (apropriado), `httpOnly: true`, `sameSite: "lax"`. Aceitável; considerar `__Host-` prefix para hardening. |
| F-32  | Cookie config       | INFORMATIVO  | `apps/api/src/app.ts:47`                                          | `@fastify/cookie` registrado sem `secret` — não é necessário porque a sessão usa assinatura HMAC manual. Documentar. |
| F-33  | Console            | MEDIO        | `apps/api/src/routes/console.ts:14-21`                            | `/console/config` é público (sem auth) e exibe `googleOAuthEnabled` e `apiEndpoint`. Apenas reconhecimento, mas em deploys multi-tenant pode revelar configuração que deveria ser secreta. |
| F-34  | Console            | MEDIO        | `apps/api/src/routes/console.ts:28-41`                            | `fastifyStatic` em `/console/assets/` sem `cacheControl`, `dotfiles: "deny"` explícito, `index: false`. Atacante poderia tentar dotfile traversal se `assetsDir` tiver `.env`, `.DS_Store`, etc. fastify-static por default já bloqueia, mas vale ser explícito. |
| F-35  | DB indexação        | INFORMATIVO  | `packages/db/src/repositories/users-query.ts:228-237`, `entities-query.ts:228`,etc | `ilike '%term%'` com `search` controlado pelo usuário — leading-wildcard, força sequential scan. DoS via search complexo em projeto grande, sem ReDoS porque é SQL. Limit existe. |
| F-36  | DB injection        | INFORMATIVO  | repos `*.ts`                                                       | Revisão exaustiva das queries `sql\`...\`` — todos os valores user-controlled passam por placeholders `${...}` (parametrizados). Não há concatenação de string de SQL. **Sem SQL injection identificada.** Único uso de `sql.table(tableName)` (`packages/db/src/repositories/system.ts:138-148`) recebe strings literais hardcoded (`"events"`, `"errors"`, etc), não input do usuário — OK. |
| F-37  | Prototype pollution | INFORMATIVO  | `apps/api/src/routes/query.ts:589-609`, `709-735`                  | `parseEntityCursor`/`parseUserCursor`: `JSON.parse(Buffer.from(value,"base64url"))` seguido de cast para `Record<string,unknown>` e leitura de propriedades específicas. Não merge nem clone profundo de unknown — não vejo vetor explorável. |
| F-38  | Regex ReDoS         | BAIXO        | `apps/api/src/source-maps/parser.ts:159-160, 176`                  | Regexes do parser de stack frames: `^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$`, etc. `.+?` lazy + `.+` greedy em mesmo regex tem potencial polinomial. Input é `error.stack` (max 20KB via schema), risco baixo, mas atacante com chave de API pode enviar stacks especialmente formados. |
| F-39  | Regex ReDoS         | INFORMATIVO  | `packages/telemetry/src/sanitization.ts:38-45`                      | `PREVIEW_CREDENTIAL_PATTERNS` com `[^\s,;'"})\]]+` linear — sem nested quantifiers, sem alternation problemática. OK. |
| F-40  | Header injection    | BAIXO        | `apps/worker/src/alerts.ts:248-254`                                 | Headers de webhook construídos pelo admin (`secretHeaderName`, `secretHeaderValue`) — `secretHeaderName` validado em `validateSecretHeaderName` (HTTP token regex). Value não é validado contra CRLF. Sob `node:http`, `request.setHeader` faz validação contra CR/LF, mas o objeto passado direto via `headers: { ... }` ao construtor pode lançar `ERR_INVALID_CHAR` (Node 18+). OK na prática, mas vale validar valor para evitar quebra de delivery por config humana. |
| F-41  | Config             | BAIXO        | `packages/config/src/index.ts:9-13, 121-126`                        | Placeholders explícitos para `SESSION_SECRET`/`API_KEY_PEPPER`/`BOOTSTRAP_ADMIN_PASSWORD` rejeitados em produção. `requireStrongSecret` ignora minLen em `test`. Em dev permite < 32 caracteres mas isso é OK para DX. |
| F-42  | Source Maps (zip)   | BAIXO        | `apps/api/src/source-maps/parser.ts:97-117`                          | `unzipSync` chamado duas vezes — dobra de memória pico para zip ≈ 50MB. Não é DoS bomb (limits enforced), mas é ineficiente; um único pass com early throw seria melhor. |
| F-43  | Logout              | MEDIO        | `apps/api/src/main.ts:304-306`                                       | `logout` apenas chama `reply.clearCookie`. Como a sessão é stateless (JWT-like), se o atacante já roubou o cookie, ele continua válido. Sem allowlist/denylist de sessão. |
| F-44  | Source Maps         | INFORMATIVO  | `apps/api/src/source-maps/resolver.ts:117-193`                      | Não exibe conteúdo original (`sourcesContent`) em nenhum response. Apenas posições resolvidas. Aderente à constraint do CLAUDE.md. OK. |

---

## 3. Detalhes por Achado

### F-01 (CRITICO) — `validateWebhookUrl` permite hosts privados em ambientes não-prod

- **Local**: `/home/user/SignalHub/apps/api/src/routes/admin.ts:329-346`
- **Descrição**: `validateWebhookUrl(rawUrl, nodeEnv)` só bloqueia hosts privados (`localhost`, `127/8`, `10/8`, `169.254/16` etc.) quando `nodeEnv === "production"`. Em qualquer outro ambiente — incluindo deploys de staging que usem `NODE_ENV=staging` ou onde alguém esqueceu de configurar — a validação é permissiva.
- **Impacto**: Um admin malicioso (ou alguém que conseguiu comprometer credenciais de admin via F-04) pode criar um Notification Channel apontando para `http://169.254.169.254/latest/meta-data/iam/security-credentials/` ou `http://127.0.0.1:6379` (Redis interno). Quando um alerta dispara, o worker tenta a entrega — também sob `nodeEnv` check em `apps/worker/src/alerts.ts:186`. Conjunto com F-02 fecha o gap de execução, mas a *persistência* da URL maliciosa já é problema (visível em listagens de canais; potencial pivô em produção se NODE_ENV for trocado).
- **Cenário/PoC**:
  ```http
  POST /admin/notification-channels  (NODE_ENV=development)
  { "name": "imds", "type": "webhook",
    "url": "http://169.254.169.254/latest/meta-data/", "enabled": true }
  ```
  Aceito. Em dev/test, o webhook é entregue sem validação DNS adicional.
- **Recomendação**: Aplicar `isPrivateWebhookHost` em todos os ambientes. Permitir override explícito via env (`ALLOW_PRIVATE_WEBHOOKS=true`) apenas para testes locais. Adicionar à allow-list de bloqueio: `169.254.169.254`, `100.64.0.0/10`, broadcast, multicast.

### F-02 (CRITICO) — DNS rebinding e SSRF gating dependem de NODE_ENV no worker

- **Local**: `/home/user/SignalHub/apps/worker/src/alerts.ts:186-243, 254-272`
- **Descrição**: `deliverWebhook` chama `validateWebhookTarget` que só bloqueia private hosts em production. Em production, faz `resolveHostname` antes do request e usa `createValidatingWebhookLookup` no `http.request`. Mas em não-produção, usa `fetch` direto via `globalThis.fetch` (linha 309-318), sem nenhum lookup validador. Mesmo em produção, há condição de corrida entre o `resolveDns` (que faz uma resolução) e o `httpRequest` (que faz outra) — o `createValidatingWebhookLookup` resolve novamente, mas se o nameserver atacante retornar IP público na primeira e privado na segunda (TTL=0), ainda é mitigado porque o `lookup` callback verifica o endereço final. **Boa defesa em prod**.
- **Impacto**: Em não-prod, SSRF irrestrito a partir do worker. Pode escanear localhost (Redis, Postgres metrics, cloud metadata).
- **Recomendação**: Mover o gate de SSRF para *fora* do check `nodeEnv`. Sempre usar `requestImpl` com lookup validador. Permitir override por env explícita para test/dev local.

### F-03 (MEDIO) — Cobertura incompleta de IP privado

- **Local**:
  - `/home/user/SignalHub/apps/api/src/routes/admin.ts:439-451`
  - `/home/user/SignalHub/apps/worker/src/alerts.ts:565-577`
- **Descrição**: As funções `isPrivateIpv4Host` cobrem `0.0.0.0`, `10/8`, `127/8`, `169.254/16`, `172.16-31/12`, `192.168/16`. Não cobrem:
  - `100.64.0.0/10` (CGNAT / shared address space — AWS NAT gateway, mobile carriers).
  - `198.18.0.0/15` (benchmark / RFC2544).
  - `224.0.0.0/4` (multicast).
  - `240.0.0.0/4` (classe E / reserved).
  - `255.255.255.255` (broadcast).
  - IPv6: faltam `ff00::/8` (multicast), `2001:db8::/32` (documentation), `64:ff9b::/96` (NAT64), endereços IPv4-compatible `::ipv4`.
- **Impacto**: Em deploys cloud, `100.64.0.0/10` é especialmente perigoso porque AWS NAT gateways, GKE VPC native, etc. usam essa faixa.
- **Recomendação**: Adicionar ranges acima. Considerar usar lib como `ipaddr.js` que já tem essas faixas tabuladas.

### F-04 (ALTO) — Hijack via Google OAuth por colisão de email

- **Local**: `/home/user/SignalHub/apps/api/src/main.ts:246-272`
- **Descrição**: Em `completeGoogleOAuth`, se não há `userByGoogleSubject(sub)`, o código tenta `findUserByEmail(email)`. Se o usuário existe e *não* tem `googleSubject` ainda, é feito `linkGoogleSubject` automaticamente — qualquer pessoa que consiga login Google com aquele email se torna o dono da conta SignalHub.
- **Impacto**: Considere: empresa cadastra `victim@old-company.com` como admin no SignalHub. Esse email é depois desativado e o domínio expira. Atacante registra o domínio, configura email para receber, faz Google Sign-up usando aquele email (Google considera `email_verified=true` automaticamente para "Sign in with Google" via OAuth quando o IdP do email é o próprio Google). Atacante recebe controle de admin. Mesmo sem expiração de domínio, em organizações Google Workspace onde alguém pode alias temporariamente um email, é vetor real. Não há `hd` claim check (domínio hospedado restrito).
- **Recomendação**: Exigir vinculação manual de Google subject (operador admin clica "vincular Google" estando autenticado por senha), ou pelo menos pedir confirmação out-of-band antes do auto-link. Validar `hd` claim quando configurado.

### F-05 (ALTO) — Sem authz por projeto/ambiente para usuários do console

- **Local**: 
  - `/home/user/SignalHub/apps/api/src/routes/query.ts:798-812` (`requireHumanUser`)
  - `/home/user/SignalHub/apps/api/src/routes/system.ts:93-110`
  - `/home/user/SignalHub/apps/api/src/routes/alerts.ts:30-44`
- **Descrição**: `requireHumanUser` apenas valida que há *qualquer* usuário autenticado. Em seguida, o `projectId`/`environmentId` vêm do query string e são propagados ao repositório sem checar se o usuário tem permissão àquele projeto. Não existe tabela `user_projects` ou `project_members`.
- **Impacto**: Em deployments com mais de um projeto, qualquer usuário não-admin com sessão lê dados de qualquer projeto. O SignalHub é descrito como "self-hosted telemetry core", mas em organizações que abrigam múltiplos times/clientes, isto é vazamento horizontal.
- **Recomendação**: Introduzir `project_members(user_id, project_id, role)`. `requireHumanUser` deve receber `projectId` e validar membership. Admins continuam com acesso global.

### F-06 (ALTO) — Login não tem rate limit por email/IP

- **Local**: `/home/user/SignalHub/apps/api/src/routes/auth.ts:76-92`
- **Descrição**: O rate-limit global é 1000 req/min por IP. Sem limit específico em `/auth/login`, atacante consegue ~16 tentativas/segundo de um único IP, ou distribuído entre IPs sem nenhum lockout por email.
- **Impacto**: Password spray (mesmo password contra muitos emails) factível. Argon2id alenta brute-force, mas em 1000 req/min × 24h × 7 dias = 10M tentativas, senhas fracas caem.
- **Cenário/PoC**: Para um único email com senha 8-char alfanum (62^8 ≈ 218 trilhões), 1000 req/min ainda não é viável. Mas para senhas curtas/comuns, especialmente combinado com vazamentos públicos (`Have I Been Pwned`), é trivial.
- **Recomendação**: Rate limit dedicado em `/auth/login`, ex. 5 tentativas/15min por email + 20 tentativas/15min por IP. Considerar exponential backoff e captcha após N falhas.

### F-07 (MEDIO) — Sem rate limit por chave de API em ingestion

- **Local**: `/home/user/SignalHub/apps/api/src/app.ts:56`, `/home/user/SignalHub/apps/api/src/routes/ingestion.ts:90-124`
- **Descrição**: Endpoints `/v1/events`, `/v1/errors`, `/v1/llm`, `/v1/traces`, `/v1/spans`, `/v1/breadcrumbs` aceitam 1000 req/min por IP. Uma chave vazada pode ser distribuída para flooding a partir de N IPs.
- **Impacto**: Floods de telemetria envenenam métricas e enchem queues/Postgres. Sem mecanismo de revogação automatizada após detecção.
- **Recomendação**: Adicionar `keyGenerator` no `@fastify/rate-limit` que combine IP+API key, com limites diferenciados (ex. 100 req/s por key por IP, 1000 req/s totais por key).

### F-08 (ALTO) — Sem cabeçalhos de segurança

- **Local**: `/home/user/SignalHub/apps/api/src/app.ts:40-56`
- **Descrição**: Nenhum `@fastify/helmet` ou middleware equivalente. Não há `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy`. O console (SPA React/Vue) é servido em `/console/*` sem hardening.
- **Impacto**: 
  - Clickjacking trivial (sem `X-Frame-Options: DENY`).
  - Sem CSP, qualquer XSS no console (eventual) consegue exfiltrar credenciais.
  - MIME sniffing pode promover `text/plain` para executável.
  - Sem HSTS, downgrade attack em produção.
- **Recomendação**: Registrar `@fastify/helmet` com CSP estrita para `/console/*` (sem `unsafe-inline`), `X-Frame-Options: DENY`, `Strict-Transport-Security: max-age=31536000; includeSubDomains` (apenas em prod com HTTPS), `Referrer-Policy: same-origin`.

### F-09 (MEDIO) — Logger desabilitado

- **Local**: `/home/user/SignalHub/apps/api/src/app.ts:41`
- **Descrição**: `Fastify({ logger: false })`. Sem logs estruturados de:
  - Tentativas de login (sucesso/falha).
  - Criação/modificação de admin/projeto/chave.
  - Uploads de source-maps.
  - Acessos a endpoints sensíveis.
  - Erros inesperados.
- **Impacto**: Forense impossível após incidente. Auditoria de compliance (SOC2, ISO 27001) inviável. Detecção de anomalia impossível.
- **Recomendação**: Habilitar pino logger com level `info`, redactar campos sensíveis (`req.headers.authorization`, `req.headers.cookie`, body em rotas auth). Log estruturado JSON. Separar eventos de auditoria em logger dedicado.

### F-10 (MEDIO) — Sessões statelesss sem revogação

- **Local**: `/home/user/SignalHub/apps/api/src/main.ts:94-154, 304-306`
- **Descrição**: Token de sessão é payload base64url + HMAC-SHA256. Sem armazenamento server-side de sessões. `logout` apenas limpa cookie. Sessão exfiltrada (XSS, log de proxy, dump de disco) continua válida até `exp` (7 dias).
- **Impacto**: Roubo de sessão → atacante mantém acesso 7 dias mesmo com mudança de senha do usuário.
- **Recomendação**: Manter token assinado, mas armazenar `session_id` no payload e tabela `sessions(id, user_id, created_at, revoked_at)`. `logout` revoga. `findSessionUser` checa `revoked_at is null`.

### F-11 (BAIXO) — Sessão sem versionamento

- **Local**: `/home/user/SignalHub/apps/api/src/main.ts:120-154`
- **Descrição**: Payload da sessão = `{userId, exp}`. Não há campo `version`/`kid` para rotação de chaves. Rotacionar `SESSION_SECRET` invalida todas as sessões simultaneamente.
- **Recomendação**: Adicionar `kid` ao payload e mantenha mapa `kid → secret`.

### F-12 (INFORMATIVO) — CORS conservador

- **Local**: `/home/user/SignalHub/apps/api/src/app.ts:43-46`
- **Descrição**: `origin: false` por padrão (rejeita CORS), `credentials: true` somente quando origem configurada. Configuração segura por default.
- **Recomendação**: Documentar em `.claude/docs/INFRASTRUCTURE.md` que `corsOrigin` deve ser uma allow-list explícita (string ou string[]).

### F-13 (BAIXO) — Limites de multipart

- **Local**: `/home/user/SignalHub/apps/api/src/app.ts:48-55`
- **Descrição**: Limites adequados: 1 file, 4 fields, 6 parts, ~50MB fileSize. Ok.
- **Recomendação**: Adicionar `headerPairs` limit explícito para evitar HTTP header bombs.

### F-14 (MEDIO) — TOCTOU em validateStoragePath

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/storage.ts:38-52`
- **Descrição**: A função faz:
  ```
  resolvedLocalDir = realpath(localDir)
  resolvedStoragePath = path.resolve(storagePath)
  assertInsideLocalDir(...)
  targetStats = lstat(resolvedStoragePath)
  if (targetStats.isSymbolicLink()) throw
  realStoragePath = realpath(resolvedStoragePath)
  assertInsideLocalDir(resolvedLocalDir, realStoragePath)
  ```
  Entre o `lstat` e o `realpath` há janela TOCTOU. Embora apenas admins criem artefatos, e os caminhos venham do DB (controlados pelo servidor), um admin malicioso com escrita no diretório de armazenamento (via outro vetor) poderia swapar arquivo por symlink entre as duas chamadas para fazer o `readSourceMapFile` ler `/etc/passwd`.
- **Impacto**: Baixo na prática (admins têm muitas formas mais fáceis), mas a função aparenta defesa rigorosa e tem buraco.
- **Recomendação**: Usar `open(path, O_NOFOLLOW)` ou abrir o arquivo *uma vez* com `fs.open` e operar via FD, evitando re-resolução.

### F-15 (BAIXO) — `safeSegment` faz fallback para "unknown"

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/storage.ts:25-28`
- **Descrição**: `safeSegment("...")` retorna `"unknown"` se `segment` virar string vazia ou só pontos. Hoje IDs internos são gerados (`nanoid`/uuid), não controlados por usuário. Defesa em profundidade.
- **Recomendação**: Em vez de fallback silencioso, lançar `source_map_storage_path_invalid` quando segment normalizar para vazio. Garante visibilidade.

### F-16 (MEDIO) — `unzipSync` em duas passadas com filter

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/parser.ts:84-136`
- **Descrição**: O código chama `unzipSync` duas vezes — primeira para "filter" e contar entries/uncompressed bytes (linha 97), depois real (linha 113). O filtro lê `file.originalSize` do header zip, que é *controlado pelo atacante*. Um zip malicioso pode declarar `originalSize=1` mas conter um payload muito maior. `fflate` confiará no header e a descompressão real explodirá memória.
- **Impacto**: Resource exhaustion DoS. Limite `MAX_SOURCE_MAP_UNZIPPED_BYTES = 100MB` pode ser burlado.
- **Cenário/PoC**: Construir um zip com header falsificado (`originalSize=10`) contendo 500MB de dados. Filtro passa, segunda `unzipSync` aloca 500MB.
- **Recomendação**: Em vez de confiar em `originalSize`, decompimir streaming e abortar quando exceder `MAX_SOURCE_MAP_UNZIPPED_BYTES`. `fflate` tem API streaming (`unzip`).

### F-17 (BAIXO) — ZipSlip evitado

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/parser.ts:113-117`
- **Descrição**: `normalizeMinifiedFile` reduz a basename. Storage usa `randomUUID()` para o filename real. Não há ZipSlip.

### F-18 (BAIXO) — Permissões de arquivo padrão

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/storage.ts:73`
- **Descrição**: `writeFile(..., { flag: "wx" })` mas sem `mode`. Default 0o666 & umask. Permissões podem permitir leitura por outros usuários do mesmo container.
- **Recomendação**: `{ flag: "wx", mode: 0o600 }`.

### F-19 (ALTO) — Resolução de source-map cross-tenant

- **Local**: 
  - `/home/user/SignalHub/apps/api/src/source-maps/resolver.ts:117-193`
  - `/home/user/SignalHub/apps/api/src/routes/query.ts:1125-1155`
- **Descrição**: A rota `/query/errors/:id/source-map-resolution` recebe `project_id`/`environment_id` do query string e passa direto para o resolver. Combinada com F-05 (sem authz por projeto), qualquer usuário autenticado escapa do escopo e resolve source-maps de qualquer projeto. O resolver internamente verifica scope via `getErrorForSourceMapResolution`, mas só com base no `errorId` *e* no `projectId/environmentId` informados pelo cliente.
- **Recomendação**: Após F-05, exigir que o usuário tenha membership no projeto antes de fazer a query.

### F-20 (MEDIO) — JSON recursivo sem limite de profundidade na ingestion

- **Local**: `/home/user/SignalHub/packages/telemetry/src/ingestion-schemas.ts:12-23`
- **Descrição**:
  ```ts
  const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
    z.union([..., z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
  );
  ```
  Não há limite de profundidade. Atacante envia `metadata: { a: { a: { a: { ...10000 levels } } } }`. Zod recursivamente parseia, JSON.parse alocou já a árvore, sanitizer recorre também.
- **Impacto**: Stack overflow em Node, DoS por chave de API válida.
- **Cenário/PoC**:
  ```js
  let obj = {};
  let cursor = obj;
  for (let i = 0; i < 20000; i++) { cursor.a = {}; cursor = cursor.a; }
  // POST /v1/events { name: "x", properties: obj, metadata: {} } 
  ```
- **Recomendação**: Limite explícito de profundidade. Verificar antes do Zod parse (`JSON.stringify` com replacer que conta níveis, ou usar `safe-stable-stringify` com depth limit).

### F-21 (BAIXO) — Sem limite de bytes de payload por rota

- **Local**: `/home/user/SignalHub/apps/api/src/app.ts`, `/home/user/SignalHub/packages/telemetry/src/ingestion-schemas.ts`
- **Descrição**: Schemas Zod limitam strings (`LONG_TEXT_MAX = 20_000`), mas não limitam total de bytes. Body parser do Fastify default = 1MB. Combinado com 1000 req/min/IP gera DoS de ~1GB/min.
- **Recomendação**: Definir `bodyLimit` explícito por rota (ex. 256KB para `/v1/*`).

### F-22 (BAIXO) — Hash de API key é SHA-256 com pepper

- **Local**: `/home/user/SignalHub/packages/telemetry/src/api-keys.ts:19-21`
- **Descrição**:
  ```ts
  export async function hashApiKey(secret, pepper) {
    return createHash("sha256").update(`${pepper}:${secret}`).digest("hex");
  }
  ```
  Para tokens de 40 caracteres `[a-zA-Z0-9]` (~238 bits), SHA-256 é suficiente em termos de pré-imagem. Porém: (a) `createHash` é pseudo-HMAC-NSI — concatenar pepper e segredo permite length-extension em alguns contextos. (b) Não constant-time. (c) Comparação em `verifyApiKey` é `timingSafeEqual` — OK.
- **Recomendação**: Usar `createHmac("sha256", pepper).update(secret)` em vez de `createHash`. Length-extension não é aplicável a SHA-256 com prefix mas é boa prática usar HMAC para "hash with key".

### F-23 (BAIXO) — Timing oracle no login

- **Local**: `/home/user/SignalHub/apps/api/src/main.ts:275-284`
- **Descrição**: Se `findUserByEmail` retorna `undefined` (ou usuário sem `passwordHash`, ex. Google-only user), `auth.login` retorna `null` imediatamente — sem chamar `verifyPassword`. `argon2.verify` leva ~200-500ms; sem ele, resposta vem em ~5ms.
- **Impacto**: Atacante distingue contas existentes de inexistentes via timing.
- **Recomendação**: Em vez de retornar cedo, computar um `verifyPassword` dummy (cache de um hash conhecido) para igualar latência.

### F-24 (BAIXO) — Bearer parsing case-sensitive

- **Local**: `/home/user/SignalHub/apps/api/src/routes/ingestion.ts:46`
- **Descrição**: Regex `/^Bearer ([^\s]+)$/` — RFC 7235 permite `bearer` em qualquer case.
- **Recomendação**: `/^Bearer\s+([^\s]+)$/i`. Não é vulnerabilidade, é interop.

### F-25 (INFORMATIVO) — Mensagens de erro estáveis

- **Local**: múltiplos
- **Descrição**: Padrões `{ error: "invalid_credentials" }` etc. evitam vazamento de stack trace. Bom.

### F-26 (MEDIO) — Cookie de OAuth state com path restrito

- **Local**: `/home/user/SignalHub/apps/api/src/routes/auth.ts:124-130, 163`
- **Descrição**: Cookie definido com `path: "/auth/google/callback"`. Em browsers (RFC 6265), cookies só são enviados em requests com caminho que prefixe o cookie's path. O callback é exatamente esse path, então funciona. Porém alguns browsers/contextos podem normalizar diferente, e proxies/CDNs podem reescrever path. Mais robusto setar `path: "/"` (e expirar em 10min via maxAge), aceitar a expansão de scope mas reduzir bugs.
- **Recomendação**: Mudar para `path: "/"` ou validar fluxo end-to-end em proxies comuns.

### F-27 (BAIXO) — Comparação de OAuth state não constant-time

- **Local**: `/home/user/SignalHub/apps/api/src/routes/auth.ts:149`
- **Descrição**: `expectedState !== parsed.data.state`. State é single-use e armazenado em cookie httpOnly, então timing leak não revela segredo a atacantes externos. Defesa em profundidade.
- **Recomendação**: `timingSafeEqual`.

### F-28 (BAIXO) — Lockout admin

- **Local**: `/home/user/SignalHub/apps/api/src/routes/admin.ts:679-705`
- **Descrição**: Admin pode `PATCH /admin/users/<self>` com `isAdmin: false` e ficar sem nenhum admin. Sistema fica permanentemente sem acesso administrativo.
- **Recomendação**: Validar antes do update: "se este é o último admin, recusar mudança". Idem `DELETE /admin/users/:id`.

### F-29 (MEDIO) — Multipart sem validação de Content-Type

- **Local**: `/home/user/SignalHub/apps/api/src/routes/admin.ts:604-642`
- **Descrição**: `parseSourceMapUploadRequest` aceita qualquer `mimetype`. Para `file` espera JSON, para `bundle` espera zip. Se admin malicioso (ou cliente confuso) enviar arquivo com mimetype enganoso, processador tenta JSON.parse ou unzipSync e pode quebrar de forma inesperada.
- **Recomendação**: Validar `mimetype` esperado e rejeitar com 415 antes de bufferizar.

### F-30 (INFORMATIVO) — `localDir` configurável

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/storage.ts:54-80`
- **Descrição**: `localDir` vem de env. Em produção, env é trusted. OK.

### F-31 (BAIXO) — `__Host-` prefix ausente

- **Local**: `/home/user/SignalHub/apps/api/src/main.ts:198-205`
- **Descrição**: Cookie name `signalhub_session`. Considerar prefixar com `__Host-` (`secure`, `path=/`, sem `domain`) para defesa contra subdomain takeover.

### F-32 (INFORMATIVO) — `@fastify/cookie` sem `secret`

- **Local**: `/home/user/SignalHub/apps/api/src/app.ts:47`
- **Descrição**: Registrado sem `secret`. Sessão usa HMAC manual em `main.ts`. OK.

### F-33 (MEDIO) — `/console/config` exposto sem auth

- **Local**: `/home/user/SignalHub/apps/api/src/routes/console.ts:14-21`
- **Descrição**: Endpoint público retorna `apiBasePath`, `apiEndpoint`, `googleOAuthEnabled`. Reconhecimento que pode ajudar atacante a mapear estrutura.
- **Recomendação**: Avaliar se é necessário expor antes do login. Se o console carrega config no boot (provavelmente), aceitar mas remover dados sensíveis adicionais.

### F-34 (MEDIO) — `fastifyStatic` sem hardening explícito

- **Local**: `/home/user/SignalHub/apps/api/src/routes/console.ts:28-31`
- **Descrição**: Sem `dotfiles: "deny"`, `index: false`, `cacheControl`, `maxAge`. Default do plugin é razoável, mas explicitar reduz risco em mudanças futuras.
- **Recomendação**:
  ```ts
  await app.register(fastifyStatic, {
    root, prefix, decorateReply: false,
    dotfiles: "deny", index: false,
    cacheControl: true, maxAge: "1h",
    immutable: true
  });
  ```

### F-35 (INFORMATIVO) — `ilike '%term%'` performance

- **Local**: `packages/db/src/repositories/users-query.ts`, `entities-query.ts`
- **Descrição**: Search com leading-wildcard força seq scan. Sem timeout de query no Postgres, search lento em projeto grande pode segurar conexões. Limit existe, mas em tabela de 100M rows com pattern incomum, seq scan é lento.
- **Recomendação**: Adicionar `statement_timeout` no pool de conexão (ex. `SET statement_timeout = 5s` para query endpoints).

### F-36 (INFORMATIVO) — Sem SQL injection

- **Local**: todos repos
- **Descrição**: Auditei cada `sql\`...\`` template e cada `where(...)` Kysely. Todos os valores user-controlled vão via placeholder `${value}` (parametrizado). `sql.table(tableName)` em `system.ts:138-148` recebe nome literal hardcoded. **Sem SQL injection identificada**.

### F-37 (INFORMATIVO) — Prototype pollution

- **Local**: `apps/api/src/routes/query.ts:589-609, 709-735`
- **Descrição**: Cursors decodificados via `JSON.parse(base64url)`. Acesso por propriedade nomeada explícita (`cursor.timestamp`, `cursor.type`, `cursor.id`). Sem deep merge / Object.assign / spread em proto. OK.

### F-38 (BAIXO) — ReDoS no parser de stack frames

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/parser.ts:159-160, 176`
- **Descrição**: 
  ```
  /^\s*at\s+(.+?)\s+\((.+):(\d+):(\d+)\)\s*$/
  /^\s*at\s+(.+):(\d+):(\d+)\s*$/
  /^\s*(.*?)@(.+):(\d+):(\d+)\s*$/
  ```
  Combinação `.+?` + `\s+` + `\(` cria potential catastrophic backtracking para inputs malformados mas no formato `at xxx xxx xxx xxx xxx ... (foo:1:1)` com muitos espaços. Stack limit Zod = 20KB; risco baixo, mas medível.
- **Recomendação**: Tentar regex possessivo (não suportado em JS) ou substituir por parser linear simples. Limitar tamanho de cada linha (max 1000 chars).

### F-39 (INFORMATIVO) — Sanitization patterns

- **Local**: `/home/user/SignalHub/packages/telemetry/src/sanitization.ts:38-45`
- **Descrição**: Patterns lineares, classe de caracteres negativa. Sem nested quantifiers. OK.

### F-40 (BAIXO) — Header CRLF injection no webhook

- **Local**: `/home/user/SignalHub/apps/worker/src/alerts.ts:248-254`
- **Descrição**: `headers[secretHeaderName] = secretHeaderValue`. Valor não validado contra CRLF; `node:http` Node 18+ rejeita `\r\n` no valor. Em browsers/proxies/middleware antigos pode ser problema. Apenas admin pode setar.
- **Recomendação**: Validar value contra `[\r\n]` antes de salvar.

### F-41 (BAIXO) — Strong secret enforcement

- **Local**: `/home/user/SignalHub/packages/config/src/index.ts:9-13, 121-126`
- **Descrição**: Em produção, exige ≥32 chars e proíbe placeholders. Em dev/test permite curto.
- **Recomendação**: Manter; documentar que `BOOTSTRAP_ADMIN_PASSWORD` deve ser high-entropy mesmo em dev.

### F-42 (BAIXO) — Dupla descompressão de zip

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/parser.ts:97-117`
- **Descrição**: Performance overhead. Não é vulnerabilidade per se mas amplifica F-16.
- **Recomendação**: Streaming `unzip` single-pass.

### F-43 (MEDIO) — Logout não revoga sessão

- Mesmo problema de F-10. Mantido como achado separado para visibilidade.

### F-44 (INFORMATIVO) — Source-map não expõe conteúdo original

- **Local**: `/home/user/SignalHub/apps/api/src/source-maps/resolver.ts:103-115`
- **Descrição**: Resposta inclui `originalSource` (caminho do arquivo, ex. `webpack:///src/foo.ts`), `originalLine`, `originalColumn`, `originalName` — mas *não* `sourcesContent`. Aderente à constraint do CLAUDE.md ("a console must not display original source content"). OK.

---

## 4. Análise por Área

### 4.1 Autenticação e Sessão

**Forças**:
- Argon2id em senhas (`packages/telemetry/src/auth.ts:1-13`).
- HMAC-SHA256 em sessão com `timingSafeEqual` (`apps/api/src/main.ts:106-118`).
- Validação de expiração antes de aceitar o payload (linha 146).
- Cookie `httpOnly`, `sameSite=lax`, `secure` em prod, `path=/` (linha 198-204).
- OAuth state via cookie httpOnly + comparação no callback.
- Bootstrap admin password tem requisito ≥32 chars em prod.

**Fraquezas**:
- F-04 (hijack via OAuth email collision) — ALTO.
- F-06 (sem rate limit em login) — ALTO.
- F-10/F-43 (sessão stateless sem revogação) — MEDIO.
- F-23 (timing oracle no login) — BAIXO.
- F-27 (compare de state OAuth não constant-time) — BAIXO.
- F-28 (lockout admin possível) — BAIXO.
- F-31 (sem `__Host-` prefix) — BAIXO.

### 4.2 Ingestion e Validação

**Forças**:
- Bearer token via regex restritiva (`routes/ingestion.ts:46`).
- API keys com prefix lookup + verify SHA-256 com pepper (`packages/telemetry/src/api-keys.ts`).
- `timingSafeEqual` no verify de API key.
- Zod schemas em todos os 6 endpoints de ingestion (`packages/telemetry/src/ingestion-schemas.ts`).
- Sanitização recursiva de campos sensíveis no worker (`sanitization.ts`).
- Limites de tamanho de string (`SHORT_TEXT_MAX`, `MEDIUM_TEXT_MAX`, `LONG_TEXT_MAX`).

**Fraquezas**:
- F-07 (rate limit insuficiente por chave) — MEDIO.
- F-20 (recursão JSON sem profundidade) — MEDIO.
- F-21 (sem body limit por rota) — BAIXO.
- F-22 (hash não-HMAC) — BAIXO.
- F-24 (bearer case-sensitive) — BAIXO.

### 4.3 Admin

**Forças**:
- `requireAdmin` em todas as rotas (`routes/admin.ts:477-496`).
- Zod schemas para todos os bodies.
- API key hash nunca devolvido (`redactApiKeyHash`).
- Secret header value redactado em listagens (`redactNotificationChannel`).
- Webhook URL validation com IP privado em prod.
- Notification channel `secretHeaderName` validado regex + obrigado prefixo `x-` ou `signalhub-`.

**Fraquezas**:
- F-01 (SSRF gating só em prod) — CRITICO.
- F-28 (lockout admin) — BAIXO.
- F-29 (multipart sem content-type check) — MEDIO.

### 4.4 Source Maps

**Forças**:
- `safeSegment` para nomes de arquivo (`storage.ts:25`).
- `realpath` + `lstat` para validar (storage.ts:38-52).
- `path.relative` check para evitar escape do diretório.
- Limites de zip (entries, uncompressed bytes).
- Cleanup em falha (`cleanupStoredFiles`).
- `flag: "wx"` impede overwrite.
- Resolver não devolve `sourcesContent`.

**Fraquezas**:
- F-14 (TOCTOU lstat/realpath) — MEDIO.
- F-15 (`safeSegment` fallback "unknown") — BAIXO.
- F-16 (zip filter confia em `originalSize`) — MEDIO.
- F-18 (sem mode 0o600) — BAIXO.
- F-19 (cross-tenant resolve dado F-05) — ALTO.

### 4.5 Webhooks / SSRF

**Forças**:
- `validateWebhookTarget` com lista de IP privado.
- `createValidatingWebhookLookup` em produção — defesa contra DNS rebinding.
- DNS resolve + check antes do request em produção.
- `redirect: "manual"` no fetch.
- Timeout via AbortController/setTimeout (5s padrão).
- Headers user-controlled limitados a `x-`/`signalhub-` prefix.

**Fraquezas**:
- F-01/F-02 (SSRF gating só em prod) — CRITICO.
- F-03 (cobertura incompleta de ranges privados) — MEDIO.
- F-40 (CRLF em valor de header) — BAIXO.

### 4.6 Logging e Exposição de Dados

**Forças**:
- `redactBackupErrorMessage` esconde caminhos locais em respostas (`system-health.ts:146-153`).
- `sanitizeValue` em telemetria recursiva.
- API key hash nunca devolvido.

**Fraquezas**:
- F-09 (logger desabilitado) — MEDIO.
- F-33 (`/console/config` público) — MEDIO.

### 4.7 Headers de Segurança

- F-08 (sem helmet/CSP/HSTS) — ALTO.
- F-34 (fastify-static sem hardening explícito) — MEDIO.

### 4.8 Query / Multi-tenant

- F-05 (sem authz por projeto) — ALTO.
- F-19 (source-map resolution cross-tenant) — ALTO.
- F-35 (search ilike performance) — INFORMATIVO.
- F-36 (sem SQL injection) — INFORMATIVO.

---

## 5. Conclusão e Top-Priority List

O codebase tem fundações sólidas — uso correto de Kysely (sem injeção SQL), Argon2id, sanitização de PII, validação Zod, SameSite cookies — mas alguns gaps importantes podem ser explorados:

### Top 5 a Endereçar Imediatamente (CRITICO/ALTO)

1. **F-01/F-02 — SSRF gated por NODE_ENV** (CRITICO). Remover o check `nodeEnv === "production"` da validação de IP privado tanto na criação do canal quanto no delivery do worker. Adicionar resolução DNS antes do salvamento. Cobrir `100.64.0.0/10`, multicast, IPv6 multicast.
2. **F-04 — Hijack por colisão de email no OAuth** (ALTO). Exigir vinculação manual de Google subject por usuário autenticado, não auto-link.
3. **F-05/F-19 — Autorização por projeto** (ALTO). Introduzir `project_members` e exigir membership em todas as rotas de query/console.
4. **F-06 — Rate limit no login** (ALTO). Limit por email + por IP, com backoff.
5. **F-08 — Headers de segurança / helmet** (ALTO). Configurar CSP, HSTS, XFO, XCTO, Referrer-Policy.

### Próximo Lote (MEDIO)

6. F-07 — rate limit por API key.
7. F-09 — logger estruturado + audit log.
8. F-10/F-43 — sessão com revogação server-side.
9. F-14 — TOCTOU em validateStoragePath.
10. F-16 — zip uncompressed size confiando no header.
11. F-20 — limitar profundidade JSON no schema de ingestion.
12. F-26 — OAuth state cookie path.
13. F-29 — validar Content-Type em uploads.
14. F-33 — `/console/config` exposto.
15. F-34 — fastify-static com `dotfiles: "deny"`.

### Hardening (BAIXO)

F-03, F-11, F-13, F-15, F-18, F-21, F-22, F-23, F-24, F-27, F-28, F-31, F-38, F-40, F-42.

### Decisões Conscientes a Documentar

- F-12 (CORS default deny) — ótimo, documentar.
- F-36 (sem SQL injection) — manter padrão Kysely.
- F-44 (source-map sem `sourcesContent`) — aderente ao CLAUDE.md.

---

**Notas de auditoria**:
- Cobertura de SQL injection foi exaustiva (todos os repositories revisados linha-a-linha): nenhum problema encontrado.
- Cobertura de path traversal em source-maps revisada: defesas presentes e razoáveis, com um TOCTOU residual (F-14).
- Cobertura de XSS server-side: API serve JSON; o console (SPA) é responsabilidade separada e não foi auditado nesta passagem.
- Cobertura de SSRF: encontrei os gaps acima (F-01, F-02, F-03).
- Cobertura de Authn/Authz: gaps significativos em authz por projeto (F-05) e OAuth (F-04).
