# Auditoria do Console Frontend (apps/console)

Auditoria sênior de React/TypeScript do console em `/home/user/SignalHub/apps/console/`.
Referências `path:line` sempre absolutas. Severidades: CRÍTICO / ALTO / MÉDIO / BAIXO / INFORMATIVO.

---

## 1. Sumário executivo

O console é uma SPA Vite + React 19 servida pelo API em `/console` (rota `apps/api/src/routes/console.ts:14`). Não há roteador, toda navegação se baseia em estado local (`activeMode`, `activeTab`). Autenticação usa cookie HttpOnly via `credentials: "include"` (sem tokens no `localStorage`, ponto positivo). API client é fortemente tipado, sem `any`, com `encodeURIComponent` em todos os segmentos de path. Sem `dangerouslySetInnerHTML`, `eval`, `Function()`, `innerHTML` ou `localStorage` em código de produção.

A qualidade geral é alta para um console interno: a maioria dos componentes possui estados de loading/empty/unavailable, retry, race-condition guards (request id refs, `cancelled` flags), e ARIA básico em botões/listas. As principais lacunas estão em:

- **Não há a11y para "drawers"**: `aside.detail-drawer` não tem `role="dialog"`, foco, escape ou label. Não há trapping de foco para modal-like UIs (apesar de serem inline, não overlays).
- **Tratamento de erros UX uniforme**: 401/403/404/500 colapsam em "unavailable" sem diferenciação. O `AuthGate` é a única tela que separa 401.
- **Seleção perdida em re-fetch**: ao aplicar filtros ou recarregar listas, todos os painéis de investigação resetam `selectedX` para `undefined` — quem estava inspecionando um item perde contexto.
- **Recurso "googleOAuthEnabled"**: campo lido do backend e nunca renderizado na UI (`apps/console/src/api/types.ts:792`). Stub/dead config.
- **Sem confirmação para ações destrutivas**: deletar source map, revogar API keys (via cliente), arquivar projetos, etc. — todos os endpoints estão expostos no client mas a UI atual só expõe delete de source map, sem `window.confirm`.
- **Feedback após mutação fraco**: criação de projeto/ambiente/usuário não emite toast/banner; o sinal é apenas o item aparecendo na lista, e a senha do usuário criado é descartada sem confirmação visual.
- **Snippets exibem segredo em texto plano sem botão de cópia**: `ApiKeyPanel.tsx:101` e `SnippetPanel.tsx` mostram chave/curl com a chave embedada e sem `navigator.clipboard`.
- **Filtros não persistem** entre navegações de modo (`setup ↔ investigate ↔ overview`); ao mudar projeto/ambiente, `InvestigationWorkspace` reseta `localInitialFilters` (linha 56).
- **Sem indicação de auto-refresh** em Overview/SystemHealth: dados só atualizam via Retry manual; não há polling, websocket ou indicador de "última atualização há X segundos".

Resumo de risco: nenhum issue **CRÍTICO** de segurança ou de quebra de fluxo. Lista de issues **ALTO** envolve perda de seleção, ausência de confirmação para ações destrutivas, ausência de feedback de mutação e gaps de acessibilidade nos drawers. Maioria dos issues é **MÉDIO**/**BAIXO**.

---

## 2. Tabela de achados

| ID | Componente | Severidade | Descrição curta |
|----|------------|-----------|-----------------|
| F-01 | App.tsx | MÉDIO | `bootstrapClient` criado em escopo de módulo — não roda fetch em StrictMode-friendly se o módulo for HMR-recarregado, e ignora `credentials` no primeiro fetch (na verdade aplica, ok), mas o singleton dificulta testes. |
| F-02 | App.tsx:53 | BAIXO | Tela "Console unavailable" sem botão Retry (diferente do AuthGate). |
| F-03 | AuthGate.tsx:18 | BAIXO | `isAuthStatus` considera 400 como auth status — mistura erro de validação com 401/403. |
| F-04 | AuthGate.tsx:65 | MÉDIO | `handleSignOut` engole exceção sem feedback ao usuário (silencioso). |
| F-05 | AuthGate.tsx:108 | MÉDIO | Form de login sem `id` em inputs, label envolvente é aceitável mas falta `aria-describedby` para o `loginError`. Mensagens de erro genéricas: invalid credentials vs serviço indisponível. |
| F-06 | AuthGate.tsx | ALTO | Sem CTA para "recuperar senha" / "criar primeira conta admin" / OAuth Google (vide F-26). Usuário travado se único admin esquecer senha. |
| F-07 | AuthGate.tsx:75 | BAIXO | Tela de "denied" não permite re-login com outra conta sem reload; botão "Sign out" volta para login, ok, mas não há indicação clara. |
| F-08 | ConsoleShell.tsx:24 | ALTO | Modo ativo persiste apenas em memória; reload da página sempre cai em `setup`. Sem deep link / history API. |
| F-09 | ConsoleShell.tsx:211-262 | MÉDIO | Toda navegação `Setup/Overview/Investigate/Alerts/Artifacts/System` usa `hidden` + render condicional; mudança de mode reseta estado interno dos painéis. |
| F-10 | ConsoleShell.tsx:179 | BAIXO | `createProject` lança exceção sem tratamento ao chamador — `ProjectSwitcher.submit` não captura, então erro de rede vira "uncaught (in promise)" no console (silencioso, sem alerta). |
| F-11 | ConsoleShell.tsx:174 | MÉDIO | `createEnvironment` idem — falha silenciosa. |
| F-12 | ConsoleModeTabs.tsx:9 | MÉDIO | Botões usam `aria-pressed` mas não `role="tab"`/`tablist`; perde semântica de tabs para leitores de tela. |
| F-13 | ConsoleModeTabs.tsx | BAIXO | Sem suporte a setas (←/→) ou Home/End para navegação por teclado entre tabs. |
| F-14 | ApiKeyPanel.tsx:101 | ALTO | Segredo de API mostrado em `<code>` sem botão de copiar; usuário precisa selecionar manualmente. Risco de "shoulder surfing" — não há toggle hide/show ou "click to reveal". |
| F-15 | ApiKeyPanel.tsx:88 | MÉDIO | Lista de chaves não permite revogar via UI (mesmo que `revokeApiKey` exista no client). Botão de delete ausente. |
| F-16 | ApiKeyPanel.tsx:65 | BAIXO | `await client.createApiKey` sem try/catch — falha vira uncaught promise (form sem feedback de erro). |
| F-17 | UserAdminPanel.tsx:48 | ALTO | Criação de usuário fixa `isAdmin: false` — não há UI para criar admin (só seed). Considerando que console é admin-only (AuthGate.tsx:34), só admin pode criar usuário, mas nunca poderá promover outro admin. |
| F-18 | UserAdminPanel.tsx:9 | ALTO | Lista de usuários não permite edit/archive/reset password (endpoints `updateUser`, `archiveUser` existem no client mas não na UI). |
| F-19 | UserAdminPanel.tsx:84 | MÉDIO | Senha temporária digitada não é exibida após criação — usuário precisa anotar antes de submeter; após `setPassword("")` a string desaparece. |
| F-20 | UserAdminPanel.tsx:55 | MÉDIO | `catch` retorna sempre "Could not create user." independentemente de 409 (e-mail duplicado), 400 (senha fraca), 401/403, 500. |
| F-21 | UserAdminPanel.tsx:80 | BAIXO | Input de email não tem `required`; submit checa `trimmedEmail` mas browser não valida. |
| F-22 | InvestigationWorkspace.tsx:41 | MÉDIO | `localInitialFilters` é reset a cada mudança de projeto/ambiente (linha 56), mas não reset ao mudar a aba — abas mantêm filtros aplicados, ok; porém filtros são perdidos ao trocar de modo (sair do investigate e voltar). |
| F-23 | InvestigationWorkspace.tsx:83 | MÉDIO | Tabs com `aria-pressed` em vez de `role="tab"`. Sem teclado para mudar tab. |
| F-24 | SetupWorkspace.tsx | BAIXO | Sem indicação visual de qual passo do setup falta (criar env, criar key, instalar SDK). Fluxo linear esperado, mas usuário sem contexto pode pular passos. |
| F-25 | SnippetPanel.tsx:16 | MÉDIO | Snippet exibe `latestSecret` em texto puro dentro de `<pre>` quando a chave acabou de ser criada — sem `aria-hidden`, sem botão "copy", sem máscara. |
| F-26 | api/types.ts:792 + console.ts:14 | INFORMATIVO | `googleOAuthEnabled` enviado pelo backend mas nunca renderizado no console. Configuração morta. |
| F-27 | api/client.ts:177 | INFORMATIVO | `credentials: "include"` em todos os requests — coerente com auth por cookie. Confirma decisão correta de não usar localStorage. |
| F-28 | api/client.ts:185 | MÉDIO | Erro HTTP é normalizado em `ApiError(status, code)`, mas a maioria dos componentes só checa `status === 401` no AuthGate; outros ignoram completamente o status (CASCATA: 403, 404, 409, 422 viram "unavailable"). |
| F-29 | api/client.ts:248-270 | BAIXO | `queryPath` faz construção manual de query string com `URLSearchParams` (correto) mas `from`/`to` aceita `Date | string` e usa `.toISOString()` quando Date — string passada não é validada, pode injetar valor não-ISO. |
| F-30 | ArtifactsPanel.tsx:225 | ALTO | `deleteArtifact` deleta source map sem confirmação (`window.confirm` ou modal). Ação destrutiva irreversível. |
| F-31 | ArtifactsPanel.tsx:73 | MÉDIO | `loadArtifacts` re-fetch após delete/upload é manual e não preserva o `releaseFilter` atual de forma explícita (passa default no `useEffect` linha 137, ok, mas `releaseFilter` default é vazio após `setReleaseFilter("")` linha 113). |
| F-32 | ArtifactsPanel.tsx:60 | BAIXO | `visibleArtifacts` filtra novamente por escopo no client, mas a API já retorna escopado — defesa em profundidade ok, mas dobra trabalho. |
| F-33 | ArtifactsPanel.tsx:286 | BAIXO | Bloco de erro usa `status-box unavailable` com `role="alert"`, mas a mensagem é sempre "Source map artifacts unavailable" / "Could not upload source map" sem distinguir 413 (payload too large), 415 (wrong type), 400 (validation). |
| F-34 | ArtifactsPanel.tsx:357 | MÉDIO | Lista de artefatos não tem botão de download, view, ou metadados estendidos (hash exibido só no detalhe? — não há detalhe). Listagem é mais limitada que os campos do tipo `SourceMapArtifact`. |
| F-35 | AlertsPanel.tsx:457 | ALTO | Form "Create rule" e "Create channel" não permitem editar nem arquivar regras/canais existentes — `updateAlertRule`, `archiveAlertRule`, `updateNotificationChannel`, `archiveNotificationChannel` existem no client mas a UI só lista e cria. |
| F-36 | AlertsPanel.tsx:339 | MÉDIO | Único banner de erro substitui mensagens de validação, "create channel" e "create rule" — usuário não sabe qual form falhou se múltiplos abertos. |
| F-37 | AlertsPanel.tsx:166 | MÉDIO | `Promise.all` para rules+channels+events: se um falha, tudo cai em "Alerts unavailable" — usuário perde acesso aos outros painéis. |
| F-38 | AlertsPanel.tsx:401 | BAIXO | Histórico "Recent alerts" não permite expandir um evento (`getAlertEvent` no client) para ver `metadata`/payload. |
| F-39 | SystemHealthPanel.tsx:104 | MÉDIO | Sem auto-refresh; usuário não vê dados ficando velhos. Não há indicação de "atualizado há X segundos". |
| F-40 | SystemHealthPanel.tsx:130 | BAIXO | Sem suporte a `prefers-reduced-motion` ou intervalo manual configurável. |
| F-41 | ConnectionCheck.tsx:35 | MÉDIO | `listEvents` + `listErrors` chamados sem `limit` — backend retorna default (50 cada) só para checar se há algum. Desperdício de payload. |
| F-42 | ConnectionCheck.tsx | BAIXO | Não há botão "Retry" no painel quando estado é `unavailable` (apenas mostra label). |
| F-43 | InvestigationWorkspace.tsx + sub-painéis | ALTO | Cada vez que filtros são aplicados ou ambiente troca, `selectedEvent`/`selectedError`/`selectedTrace`/`selectedCall` é setado para `undefined` (EventInvestigationPanel.tsx:87, ErrorRawOccurrencesPanel.tsx:109, TraceInvestigationPanel.tsx:84, LlmInvestigationPanel.tsx:97). Drawer fica vazio inesperadamente. |
| F-44 | EventDetailDrawer.tsx:7 + outros drawers | MÉDIO | `aside.detail-drawer` sem `role="dialog"`/`aria-label`. Não é modal, mas falta navegação clara. Sem botão "fechar". |
| F-45 | ErrorDetailDrawer.tsx + LlmCallDetailDrawer.tsx + outros | MÉDIO | JSON renderizado via `JSON.stringify` em `<pre><code>` — `metadata`, `properties`, `context`, `input/output` podem conter PII. Não há toggle de "esconder JSON sensível". |
| F-46 | LlmCallDetailDrawer.tsx:88 | MÉDIO | `inputPreview`/`outputPreview` renderizados sem limite visual de tamanho ou scroll; payload grande estoura layout. |
| F-47 | ErrorDetailDrawer.tsx:88 | MÉDIO | `error.stack` exibido como texto puro em `<pre>`; sem destaque das frames resolvidas via source map (vide ErrorSourceMapResolution). |
| F-48 | ErrorSourceMapResolution.tsx:27 | BAIXO | Quando `resolution` é `undefined` mas `isLoading=false`, mostra "Source map resolution unavailable." — porém o cliente pode legitimamente não ter um source map (estado normal). Mensagem confusa. |
| F-49 | ErrorRawOccurrencesPanel.tsx:151 | MÉDIO | `client.getErrorSourceMapResolution` é checada como `undefined` (linha 151) com fallback no-op — silencia falha de descoberta de feature, sem feedback ao usuário. |
| F-50 | ErrorRawOccurrencesPanel.tsx:177 | MÉDIO | Effect de session timeline dispara em todo `selectedError` mesmo se já carregado; sem cache. |
| F-51 | ErrorRawOccurrencesPanel.tsx:177 | BAIXO | Mensagem genérica "Session context unavailable." sem retry button. |
| F-52 | ErrorGroupDetail.tsx:45 | MÉDIO | `saveStatus` sem confirmação para `resolved`/`ignored` — ação que muta dados sem dupla checagem. |
| F-53 | ErrorGroupDetail.tsx:93 | BAIXO | Erro de save é apenas "Status update failed." sem retry inline; usuário precisa clicar "Save status" de novo. |
| F-54 | ErrorGroupsPanel.tsx:84 | MÉDIO | `groupMatchesFilters` re-implementa filtro client-side para preservar item atualizado — duplicação de lógica server vs client (drift risk). |
| F-55 | OverviewDashboard.tsx:82 | MÉDIO | Effect dispara em `[client, environmentId, projectId, reloadToken, window]` — se trocar window mid-load, request anterior pode chegar e setar dados velhos. Usa flag `cancelled`, então ok, mas é a única referência ao `window` global do browser (`useState<OverviewWindow>("24h")` sombreia o global — confuso). |
| F-56 | OverviewDashboard.tsx:77 | BAIXO | Variável chamada `window` colide com `window` global JS (linha 88, 130). Funciona, mas é má prática. |
| F-57 | OverviewMiniTrends.tsx:36 | BAIXO | SVG mini-charts sem `aria-label` ou descrição textual — leitores de tela só ouvem o título e o totalLabel. |
| F-58 | OverviewMiniTrends.tsx:79 | BAIXO | `aria-hidden="true"` no SVG significa zero leitura — totalmente inacessível para visualização de tendências. |
| F-59 | OverviewTopLists.tsx:32 | BAIXO | Botões "Top events"/"Top tenants" etc. usam onDrilldown, ok; mas `row.label` pode ser string vazia (tenant unassigned com ID null) — botão fica vazio sem aria-label. |
| F-60 | OverviewRecentSignals.tsx:18 | BAIXO | Linhas "recent errors/traces/llm" não são clicáveis (não drilldown para o item específico). Diferente das listas top. |
| F-61 | EntitiesInvestigationPanel.tsx:82-87 | MÉDIO | `useEffect` que seta `initialTenantId` tem `[initialTenantId]` como única deps, mas usa `scopeKey` (ESLint exhaustive-deps faria warning, mas sem ESLint configurado). |
| F-62 | EntitiesInvestigationPanel.tsx:131 | BAIXO | Effect de detail tem 10 deps; em produção isso causa renders desnecessários se um único valor flutuar. |
| F-63 | EntitiesTenantList.tsx:99 + UsersUserList.tsx:99 | MÉDIO | Botões `disabled` para tenant `_unassigned`/usuário `_anonymous` mas `aria-disabled="true"` é redundante. Usuário não recebe explicação visual do porquê está disabled. |
| F-64 | UsersInvestigationPanel.tsx:155 | BAIXO | `selectUser` ignora silenciosamente users anônimos — sem feedback se usuário clicar. |
| F-65 | UsersInvestigationPanel.tsx:99 | MÉDIO | Detail é fetched novamente toda vez que `appliedDetailTenantId` ou `signalType` muda — sem debounce. |
| F-66 | UsersInvestigationPanel.tsx:179 | MÉDIO | `loadMoreTimeline` substitui `data.user` mesmo em load-more (linha 190) — pode sobrescrever resumo com dados inconsistentes se aggregates flutuarem. |
| F-67 | EnvironmentSelector.tsx:42 | BAIXO | Input sem `id` e sem `htmlFor` — label envolvente OK mas pode ser problemático para alguns leitores. |
| F-68 | EnvironmentSelector.tsx:15 | MÉDIO | `submit` faz `await onCreate(trimmed)` sem try/catch — erro do servidor cai como uncaught. |
| F-69 | ProjectSwitcher.tsx:15 | MÉDIO | Idem F-68. |
| F-70 | SpanTimeline.tsx:32 | BAIXO | Toda lista de spans é renderizada de uma vez, sem virtualização — trace com 10k spans degrada UI. |
| F-71 | SpanTimeline.tsx:33 | BAIXO | Cada span renderiza 4 blocos `<pre><JSON>` enormes — usabilidade ruim, sem collapse. |
| F-72 | SessionTimeline.tsx:31 | BAIXO | Mensagem de erro `error` mostrada como texto comum, sem `role="alert"`. |
| F-73 | SessionTimeline.tsx:39 | BAIXO | Itens da timeline não são clicáveis — não há drilldown para o item. |
| F-74 | TraceDetailDrawer.tsx:79 | BAIXO | "Loading spans" sem `role="status"`. |
| F-75 | ApiKeyPanel.tsx | INFORMATIVO | Não há indicação de quantas keys ativas vs revogadas, nem botão para revogar. Combinado com F-15. |
| F-76 | api/client.ts | INFORMATIVO | Não há suporte a `AbortSignal` em nenhuma chamada — cancelamento depende exclusivamente de flags `cancelled` no componente. Em re-render rápido o request continua até o end. |
| F-77 | api/client.ts:174 | BAIXO | Não há timeout em `fetch` — request pendurado bloqueia UX até TCP timeout do browser. |
| F-78 | api/client.ts:188 | BAIXO | `await parseJson(response)` chamado duas vezes em alguns paths? Não — só uma. OK. |
| F-79 | api/client.ts:267 | BAIXO | `params.set("from", filters.from instanceof Date ? ... : filters.from)` — se filters.from for objeto não-Date, vira `[object Object]` em URL. |
| F-80 | vite.config.ts:5 | INFORMATIVO | `base: "/console/"` está coerente com `apps/api/src/routes/console.ts:33`. |
| F-81 | vite.config.ts:9 | INFORMATIVO | Proxy de dev cobre `/auth`, `/admin`, `/query`, `/console/config` mas **não** `/system`, `/alerts` — em `vite dev` chamadas `client.getSystemHealth()` (`/system/health`) e `client.listAlertEvents()` (`/alerts/events`) batem direto no Vite e retornam HTML index. |
| F-82 | index.html | INFORMATIVO | Sem favicon, sem meta description, sem theme-color. Aceitável para console interno. |
| F-83 | index.html:6 | INFORMATIVO | `<title>SignalHub Console</title>` estático — não muda baseado em mode ativo (e.g., "SignalHub Console — Alerts"). |
| F-84 | main.tsx:6 | BAIXO | `getElementById("root")!` non-null assertion — se HTML faltar `#root`, runtime crash sem fallback. |
| F-85 | OverviewDashboard.tsx:32 | BAIXO | `isEmptyish` considera 0 em 4 métricas — projeto vazio mostra duplo banner: "No overview activity in this window" + KPIs zerados + listas com `emptyText` cada uma. Ruído visual. |
| F-86 | Geral | MÉDIO | Sem indicador global de loading agregado (top progress bar) — múltiplos painéis carregando simultaneamente ficam silenciosos. |
| F-87 | Geral | MÉDIO | Sem toast/notification system — todos os feedbacks são inline, fáceis de perder. |
| F-88 | Geral | BAIXO | Sem suporte a teclado de atalho global (e.g., "/" para focar busca, "g e" para ir para events). |
| F-89 | Geral | INFORMATIVO | Não há tema dark/light toggle ou respeito a `prefers-color-scheme` aparente no audit de componentes (CSS em `styles.css` não revisado). |
| F-90 | api/client.ts:439 | BAIXO | `createApiClient` retorna union com `SourceMapApiClient` (não-Partial), mas o type exposto é `ApiClient & SessionTimelineApiClient & Partial<SourceMapApiClient>` — assimetria entre tipo e implementação. |

---

## 3. Detalhes por achado

### F-01 — bootstrapClient singleton (MÉDIO)
`apps/console/src/App.tsx:7` cria `bootstrapClient = createApiClient()` em escopo de módulo. Usado apenas para `getConsoleConfig()`. Aceitável, porém em StrictMode (linha 7 de `main.tsx`) o effect roda duas vezes e ambas as chamadas batem em `/console/config`. O cliente real (linha 30) é recriado dentro do effect com `apiBasePath` dinâmico. Para testabilidade, prefira injeção via prop.

### F-02 — "Console unavailable" sem retry
`apps/console/src/App.tsx:53` mostra `<h1>Console unavailable</h1>` sem nenhum botão Retry. Compare com `AuthGate.tsx:99` que oferece Retry. Usuário precisa F5 manualmente.

### F-03 — isAuthStatus inclui 400
`apps/console/src/AuthGate.tsx:18`:
```ts
return error instanceof ApiError && [400, 401, 403].includes(error.status);
```
400 não é auth — é validação. Mensagem "Invalid email or password" exibida para qualquer 400 confunde o usuário.

### F-04 — handleSignOut engole erro
`apps/console/src/components/AuthGate.tsx:65-73`: catch vazio com comentário "Denied users need a local escape hatch". OK como design, mas usuário não sabe que logout falhou no servidor — sessão pode continuar válida do lado do servidor.

### F-05 — Login form a11y
`apps/console/src/components/AuthGate.tsx:114-135`: inputs envolvidos por `<label>` está OK, mas `<p className="form-error">` (linha 136) não é referenciado por `aria-describedby` em nenhum input — leitores não anunciam o erro automaticamente após submit falho.

### F-06 — Sem fluxo de recuperação de senha
Nenhum componente oferece "esqueci minha senha" ou "criar primeiro admin". Combinado com `bcrypt + isAdmin must be true`, único admin que perde senha precisa SQL direto.

### F-08 — Estado de modo perdido em reload
`apps/console/src/components/ConsoleShell.tsx:24` inicializa `activeMode` com `"setup"`. Não persiste em URL, history API, ou localStorage. Reload sempre cai em Setup mesmo se o usuário estava em Investigate. Sem deep link para compartilhar com colegas ("olha esse error group").

### F-09 — Render condicional com `hidden`
`apps/console/src/components/ConsoleShell.tsx:211-262`: cada modo usa `<div hidden={activeMode !== "x"}>{activeMode === "x" ? <Panel /> : null}</div>`. Padrão correto para preservar instância DOM mas custosa: ao alternar modo, painéis "ocultos" deixam de existir (devido ao `condition ? <X /> : null`) — só o `<div hidden>` permanece, mas o conteúdo desmonta. O `hidden=` em si é dispensável.

### F-10 / F-11 / F-68 / F-69 — Erros de mutação silenciosos
`ConsoleShell.createProject` (linha 164) e `createEnvironment` (linha 176) não tratam exceção; `ProjectSwitcher.submit` (linha 15-22) chama `await onCreate(trimmed)` sem try/catch — exceção propaga até React DOM render handler e cai como "uncaught (in promise)" no console do browser. UX: form fica travado sem feedback de erro.

### F-12 / F-23 — tabs com aria-pressed em vez de role="tab"
`apps/console/src/components/ConsoleModeTabs.tsx:10` é `<div className="mode-tabs" aria-label="Console modes">` com botões `<button aria-pressed=...>`. Pattern correto WAI-ARIA seria `role="tablist"` + `role="tab"` + `role="tabpanel"`. O `ErrorInvestigationPanel.tsx:37` faz isso corretamente, então há inconsistência interna.

### F-14 — Segredo exibido sem cópia ou ocultação
`apps/console/src/components/ApiKeyPanel.tsx:98-103`:
```tsx
{scopedLatestSecret ? (
  <div className="secret-callout" role="status">
    <strong>One-time secret</strong>
    <code>{scopedLatestSecret}</code>
  </div>
) : null}
```
Sem `navigator.clipboard.writeText`, sem botão "Copy", sem botão "Reveal" (já revelado). Usuário deve selecionar manualmente. Combinado com F-25 (snippet inclui a chave no curl).

### F-15 — Sem revogação na UI
`ApiKeyPanel.tsx:88-95`: lista exibe key + prefix mas zero botões de ação. Cliente expõe `revokeApiKey` (`api/client.ts:475`) inutilizado pela UI.

### F-17 — Não há promoção a admin
`apps/console/src/components/UserAdminPanel.tsx:48-52`: `isAdmin: false` hardcoded. Form não tem checkbox para criar admin. Para alterar `isAdmin` de um usuário existente, precisa SQL direto (mesmo que o client tenha `updateUser`).

### F-18 — User admin é apenas list+create
`UserAdminPanel.tsx:62-94`: sem edit, sem archive, sem reset password. Endpoints `updateUser`, `archiveUser` no client (linhas 542-544 de `api/client.ts`) sem UI.

### F-19 — Senha temporária some
`UserAdminPanel.tsx:42-44`:
```ts
const temporaryPassword = password;
setPassword("");
```
Após submit, password é limpo do state mas nunca exibido em um callout pós-criação. Operador precisa anotar antes de clicar.

### F-22 — Filtros perdidos em troca de modo
`InvestigationWorkspace.tsx:55-57`:
```ts
useEffect(() => {
  setLocalInitialFilters({});
}, [projectId, environmentId]);
```
Aceitável para mudança de escopo, mas se usuário sai de Investigate para Alerts e volta, `InvestigationWorkspace` desmonta (devido ao render condicional em `ConsoleShell.tsx:236`) e remonta com state vazio. Filtros que estavam aplicados em Errors/Events somem.

### F-25 — Snippets exibem segredo
`apps/console/src/components/SnippetPanel.tsx:18`: quando `latestSecret` é passado pelo `ConsoleShell.scopedLatestSecret`, todos os 3 snippets (SDK, HTTP, Env) renderizam a chave em texto puro dentro de `<pre><code>`. Sem botão de copiar nem warning de "treat as password".

### F-26 — googleOAuthEnabled inutilizado
`apps/console/src/api/types.ts:792` define `googleOAuthEnabled: boolean` no `ConsoleConfig`. Backend (`apps/api/src/routes/console.ts:18`) envia. Frontend nunca lê. Stub.

### F-28 — Cascata de erros não-401
`apps/console/src/api/client.ts:185-197`: cria `ApiError(status, code)` corretamente. Mas componentes só fazem `error instanceof ApiError && error.status === 401` no `AuthGate.tsx:37`. Todos os outros componentes usam `.catch(() => setState("unavailable"))` (e.g., `SystemHealthPanel.tsx:115`, `AlertsPanel.tsx:169`, `OverviewDashboard.tsx:94`, etc.). Resultado: 403 (RBAC), 404 (recurso removido), 409 (conflito), 422 (validação) e 500 (servidor) renderizam "unavailable" idêntico.

### F-30 — Delete sem confirmação
`apps/console/src/components/ArtifactsPanel.tsx:225-254` + render do botão linha 370-377:
```tsx
<button aria-label={`Delete ${artifact.originalFilename}`}
        disabled={deletingArtifactId === artifact.id}
        onClick={() => void deleteArtifact(artifact)}
        type="button">
  Delete
</button>
```
Sem `window.confirm`, sem modal de confirmação. Click acidental destrói artifact.

### F-35 — Alerts read-only após criação
`apps/console/src/components/AlertsPanel.tsx:344-461`: lista rules e channels, formulários de criar. Sem botão edit/archive em cada `alerts-row`. Endpoints `updateAlertRule` (api/client.ts:562), `archiveAlertRule` (567), `updateNotificationChannel` (552), `archiveNotificationChannel` (557) — todos inutilizados.

### F-37 — Promise.all all-or-nothing
`AlertsPanel.tsx:158-168`: se `listNotificationChannels` falhar (e.g., usuário sem permissão), todo o painel cai em "Alerts unavailable" e nem rules nem events são exibidos. Prefer `Promise.allSettled`.

### F-41 — listEvents/listErrors sem limit no ConnectionCheck
`apps/console/src/components/ConnectionCheck.tsx:35-38`:
```ts
void Promise.all([
  client.listEvents({ projectId, environmentId }),
  client.listErrors({ projectId, environmentId })
])
```
Sem `limit: 1`. Backend retorna lista cheia. Para checar "há algum?" basta limit=1.

### F-43 — Seleção perdida em re-fetch
Padrão repetido em todos os panels investigativos:
- `apps/console/src/components/EventInvestigationPanel.tsx:87`: `setSelectedEvent(undefined)` antes de carregar.
- `apps/console/src/components/ErrorRawOccurrencesPanel.tsx:109`: `setSelectedError(undefined)`.
- `apps/console/src/components/TraceInvestigationPanel.tsx:84`: `setSelectedTrace(undefined); setSpans([])`.
- `apps/console/src/components/LlmInvestigationPanel.tsx:97`: `setSelectedCall(undefined)`.
Drawer esvazia ao aplicar filtros. Melhor seria preservar seleção e remover seleção apenas se o item não estiver mais na lista após reload.

### F-44 — Drawers sem semântica de dialog
`EventDetailDrawer.tsx:22`, `ErrorDetailDrawer.tsx:36`, `LlmCallDetailDrawer.tsx:26`, `TraceDetailDrawer.tsx:32`:
```tsx
<aside className="detail-drawer">
```
Sem `role="complementary"` explícito (aside default é landmark, ok), sem `aria-label`, sem botão "Close", sem foco automático. Para drawer modal seria `role="dialog"` + foco trapping.

### F-45 — JSON com PII exposto
`ErrorDetailDrawer.tsx:101-110`: `error.context` e `error.metadata` exibidos em `<pre>` sempre. `EventDetailDrawer.tsx:60-69`: `event.properties` e `event.metadata`. Sem mecanismo de masking/PII redaction. Se o SDK enviar dados sensíveis, console exibe.

### F-46 — Preview LLM sem limite
`LlmCallDetailDrawer.tsx:82-91`: `inputPreview`/`outputPreview` renderizados em `<pre>` sem max-height/scroll. Payload de 100k chars quebra layout.

### F-52 — Status sem confirmação
`apps/console/src/components/ErrorGroupDetail.tsx:45-68`: `saveStatus` chama API sem confirmação para `resolved`/`ignored`. Usuário pode acidentalmente marcar como resolved e perder a visibilidade.

### F-55/F-56 — `window` shadowing
`apps/console/src/components/OverviewDashboard.tsx:77`: `const [window, setWindow] = useState<OverviewWindow>("24h");`. Sombreia o `window` global. Funciona, mas leitores acham confuso.

### F-65/F-66 — Detail re-fetch sem cache
`UsersInvestigationPanel.tsx:98-147`: efeito depende de muitas vars; trocar `signalType` faz refetch completo. Pior: `loadMoreTimeline` (linha 161) usa cursor mas substitui `user` summary (linha 190) com dados recém-carregados — se servidor recalcular impact score entre chamadas, summary muda no meio da timeline.

### F-70/F-71 — SpanTimeline sem virtualização
`apps/console/src/components/SpanTimeline.tsx:27-78`: renderiza todos os spans com 4 blocos JSON cada. Trace grande mata performance e usabilidade. Sem collapse por padrão.

### F-77 — Sem timeout em fetch
`api/client.ts:174-204`: `fetch` chamado sem `AbortController` ou timeout. Se backend pendurar, request fica até TCP timeout do browser (60-120s típico). UI fica em "Loading" indefinidamente.

### F-81 — Proxy dev incompleto
`apps/console/vite.config.ts:9-14`:
```ts
proxy: {
  "/auth": "...",
  "/admin": "...",
  "/query": "...",
  "/console/config": "..."
}
```
Sem `/system`, `/alerts`, `/v1`, `/healthz`. `vite dev` rodando paralelo ao API:
- `client.getSystemHealth()` → `/system/health` → 404 do Vite (retorna index.html, parsing falha).
- `client.listAlertEvents()` → `/alerts/events` → idem.
- `client.listAlertRules()` → `/admin/alert-rules` (passa pelo proxy `/admin`).

### F-90 — Tipo vs implementação divergem
`apps/console/src/api/client.ts:439`: assinatura retorna `ApiClient & SessionTimelineApiClient & SourceMapApiClient` (não-Partial). Mas o type alias na linha 144 declara `Partial<SourceMapApiClient>`. Componentes (ArtifactsPanel.tsx:13-20) fazem `hasSourceMapClient` check baseado em Partial — desnecessário em runtime já que client sempre tem.

---

## 4. Seções temáticas

### 4.1 Navegação

- **F-08 / F-22**: ausência de roteamento (history API, react-router, etc.) significa que reload, deep link e back/forward do browser não funcionam. Crítico para usabilidade de console de telemetria onde links de "olhe esse erro" são esperados.
- **F-09**: padrão `hidden + render condicional` mistura DOM-preserve com unmount; deve ser apenas um dos dois.
- **F-12 / F-13 / F-23**: tabs principais (`ConsoleModeTabs`) e tabs internos (`InvestigationWorkspace`) usam `aria-pressed` em vez de WAI-ARIA tablist; inconsistência com `ErrorInvestigationPanel.tsx:37` que faz corretamente.
- **F-43**: seleção é resetada em re-fetch — drawer esvazia inesperadamente.
- **F-60 / F-73**: itens "Recent" no Overview e itens da SessionTimeline não são clicáveis para drilldown.
- **F-83**: title da página não reflete modo ativo.

### 4.2 Tratamento de Erros

- **F-04**: logout silencioso.
- **F-10 / F-11 / F-16 / F-68 / F-69**: criação de projeto, ambiente, API key, usuário sem try/catch — uncaught promise.
- **F-20**: mensagem "Could not create user." indiferenciada para todos os HTTP status.
- **F-28**: 401 é o único caso especial; 403/404/409/422/500 colapsam em "unavailable".
- **F-33**: upload de source map — mesma mensagem para 413/415/400.
- **F-36**: AlertsPanel — único banner de erro mascara qual form falhou.
- **F-37**: Promise.all all-or-nothing.
- **F-50 / F-51**: session timeline e source map resolution falham silenciosamente sem retry inline.
- **F-77**: sem timeout — request pendurado bloqueia UI.

### 4.3 Estado / Async

- **F-43**: padrão de reset de seleção.
- **F-50 / F-65**: refetches duplicados sem cache.
- **F-54**: lógica de filtro server duplicada client-side em ErrorGroupsPanel.
- **F-55 / F-56**: shadowing de `window`.
- **F-61 / F-62**: useEffect com 10 deps; dependências exhaustivas faltantes (sem eslint-plugin-react-hooks configurado).
- **F-66**: load-more sobrescreve summary.
- **F-76 / F-77**: AbortController ausente; sem timeout.

### 4.4 Acessibilidade

- **F-05**: form de login sem `aria-describedby` para erro.
- **F-12 / F-23**: tablist semantics inconsistente.
- **F-13 / F-88**: sem navegação por teclado (setas em tabs, atalhos globais).
- **F-44**: drawers sem role/label/close button.
- **F-57 / F-58**: SVG mini-charts inacessíveis (`aria-hidden="true"`).
- **F-59**: botões com label vazio (tenant unassigned).
- **F-63**: `aria-disabled` redundante; sem explicação visual do disabled.
- **F-67**: input sem `id`/`for` explícito.
- **F-72 / F-74**: mensagens de erro/loading sem `role="alert"`/`role="status"` consistente.

### 4.5 Segurança

- **POSITIVO**: nenhum `dangerouslySetInnerHTML`, `eval`, `Function()`, `innerHTML`, `localStorage` para tokens; cookies HttpOnly via `credentials: "include"` (api/client.ts:177).
- **POSITIVO**: `encodeURIComponent` em todos os segmentos de path (api/client.ts:237-239) — sem URL injection.
- **POSITIVO**: validação de webhook URL em AlertsPanel.tsx:87-104 rejeita non-http(s) e credenciais embutidas.
- **POSITIVO**: validação de secret header name (AlertsPanel.tsx:106-114) restringe charset e prefixo.
- **F-14 / F-25**: segredo de API exibido em plain text em `<code>`/`<pre>` sem mascaramento ou opção de copiar; risco de exposição em screenshots, screen-share.
- **F-45**: JSON com possível PII exibido sempre, sem masking.
- **F-79**: filters.from/to aceita string arbitrária — se UI ou drilldown injetar string não-ISO, vai como-está no query param (server precisa validar).

### 4.6 Componentes

- **ConsoleShell**: estado complexo (8 useState + 3 useRef + 5 useEffect). Difícil seguir, mas funcional.
- **AuthGate**: bom contrato, mas F-03, F-04, F-05, F-06.
- **ApiKeyPanel**: incompleto (F-14, F-15, F-16).
- **UserAdminPanel**: muito incompleto (F-17, F-18, F-19, F-20, F-21).
- **InvestigationWorkspace + sub-panels**: padrão consistente, mas F-22, F-43, F-44, F-45.
- **Drawers**: F-44, F-45, F-46, F-47.
- **SessionTimeline**: F-72, F-73.
- **SpanTimeline**: F-70, F-71.
- **SetupWorkspace**: F-24.
- **AlertsPanel**: F-35, F-36, F-37, F-38.
- **ArtifactsPanel**: F-30, F-31, F-32, F-33, F-34.
- **SystemHealthPanel**: F-39, F-40.
- **ConnectionCheck**: F-41, F-42.
- **OverviewDashboard + sub-panels**: F-55, F-56, F-57, F-58, F-59, F-60, F-85.

### 4.7 Build / Dev

- `vite.config.ts:5` — `base: "/console/"` coerente com API serving.
- `vite.config.ts:9` — proxy incompleto (F-81).
- `package.json` lint = `tsc --noEmit` apenas; **sem ESLint** — possíveis hooks com deps incorretas (F-61) e shadowing (F-55/F-56) não são pegos.
- `index.html` mínimo (F-82, F-83).
- `main.tsx:6` — `getElementById("root")!` (F-84).
- API serve build em `/console` (`apps/api/src/routes/console.ts:33-41`) com SPA fallback.

---

## 5. Lista de elementos sem handler / stubs / "coming soon"

### Stubs (recurso existe no backend, UI inexistente)
- **`googleOAuthEnabled`** — config recebida mas sem botão "Sign in with Google" no AuthGate. (`apps/console/src/api/types.ts:792`)
- **`updateProject` / `archiveProject`** — clients (`api/client.ts:447-453`) sem UI no ProjectSwitcher. Não há edit/archive de projetos.
- **`updateEnvironment` / `archiveEnvironment`** — clients (`api/client.ts:461-467`) sem UI no EnvironmentSelector. Não há rename/archive de ambientes.
- **`revokeApiKey`** — client (`api/client.ts:475`) sem botão no ApiKeyPanel.tsx (F-15).
- **`updateUser` / `archiveUser`** — clients (`api/client.ts:542-544`) sem UI no UserAdminPanel. (F-18)
- **`updateAlertRule` / `archiveAlertRule`** — clients (`api/client.ts:562-568`) sem UI no AlertsPanel.tsx (F-35).
- **`updateNotificationChannel` / `archiveNotificationChannel`** — clients (`api/client.ts:552-558`) sem UI (F-35).
- **`getAlertEvent`** — client (`api/client.ts:571`) sem UI; histórico em AlertsPanel não tem expand para detalhe (F-38).

### Sem call-to-action útil
- **ConnectionCheck** estado `unavailable` (`apps/console/src/components/ConnectionCheck.tsx:58`) não oferece Retry button.
- **App.tsx "Console unavailable"** (linha 53) sem Retry (F-02).
- **ErrorSourceMapResolution `undefined`** (`apps/console/src/components/ErrorSourceMapResolution.tsx:33`) — mensagem "Source map resolution unavailable" mas pode ser estado normal (sem source map upload). Sem CTA "Upload source maps" (que deveria linkar para o tab Artifacts).
- **SessionTimeline timeline error** (`apps/console/src/components/SessionTimeline.tsx:32`) — sem retry button.

### "Coming soon" / Empty states pouco úteis
- **EventDetailDrawer/ErrorDetailDrawer/LlmCallDetailDrawer/TraceDetailDrawer**: ao não haver seleção, mostram apenas `<p>Select an X to inspect its details.</p>` (linhas EventDetailDrawer.tsx:23, ErrorDetailDrawer.tsx:37, LlmCallDetailDrawer.tsx:27, TraceDetailDrawer.tsx:33). Sem indicação de quantos itens estão na lista ou sugestão de filtro.
- **InvestigationWorkspace empty project** (linha 67-76): "Select a project and environment in Setup to investigate telemetry." — sem botão direto "Go to Setup".
- **OverviewDashboard empty project** (linha 110-118): idem — sem botão para Setup.
- **AlertsPanel empty project** (linha 311-321): idem.
- **ArtifactsPanel empty project** (linha 264-274): idem.
- **OverviewDashboard `isEmptyish`** (linha 153-156): "No overview activity in this window" sobreposto a KPIs zerados e listas com `emptyText` — duplicação de feedback (F-85).

### Itens não-clicáveis que deveriam ser
- **OverviewRecentSignals** (linhas 17-42) — recent errors/traces/llm calls são apenas `<div>`, não navegam para o item específico.
- **SessionTimeline items** (linha 39-54) — `<li>` sem onClick, sem drilldown para o evento/erro/trace específico.
- **AlertsPanel "Recent alerts"** (linha 401-416) — `<article>` sem expand/click; não há jeito de ver `metadata` ou tentar redelivery.

### Faltam botões "fechar drawer"
- Todos os `*DetailDrawer` ficam abertos até nova seleção; nenhum tem "X" para fechar. Para fechar é preciso clicar fora ou clicar no mesmo item de novo (que provavelmente abre de novo).

### Sem confirmação de ações destrutivas
- **ArtifactsPanel.deleteArtifact** (linha 225) — sem `window.confirm` (F-30).
- **ErrorGroupDetail.saveStatus** para `resolved`/`ignored` (linha 45) — sem confirm (F-52).

### Sem feedback positivo após mutação
- Criar projeto (`ConsoleShell.createProject`) — apenas aparece na lista, sem toast.
- Criar ambiente — idem.
- Criar API key — só aparece o secret callout; nenhuma notificação.
- Criar usuário — `setEmail("")` e a senha some sem confirmação visível.
- Criar alert rule/channel — só limpa form; sem toast.
- Salvar status de error group — botão volta a "Save status" sem mensagem de sucesso.

### Sem botão de copiar
- `ApiKeyPanel.tsx:101` — `<code>{scopedLatestSecret}</code>` sem copy.
- `SnippetPanel.tsx` — 3 snippets em `<pre>` sem copy buttons.
- IDs em drawers (`ErrorDetailDrawer.tsx:50`, etc.) — `<code>{error.id}</code>` sem copy.

---

## 6. Pontos Positivos (Informativo)

- Nenhum `dangerouslySetInnerHTML`, `eval`, `localStorage` para tokens.
- `credentials: "include"` consistente (api/client.ts:177).
- `encodeURIComponent` em path segments (api/client.ts:237).
- Tipos TypeScript fortes; zero `any` em código de produção (apenas em testes — `api/client.test.ts:900,931`).
- Race-condition guards via `cancelled` flags e `requestId` refs presentes em quase todos os fetches.
- StrictMode habilitado (`main.tsx:7`).
- Validação de webhook URL e secret header em AlertsPanel.
- `useMemo` em listas grandes ordenadas (UsersUserList, EntitiesTenantList) e em queries derivadas.

