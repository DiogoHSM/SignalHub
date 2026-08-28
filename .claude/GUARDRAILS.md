# Guardrails — SignalMonitor

> **Sempre carregado.** Este arquivo é o único contrato de *lazy loading* do projeto: diz a Claude quais docs ler antes de tocar em cada área. Docs não listados aqui só são lidos quando Claude os abrir explicitamente.

**Última revisão**: 2026-08-28

---

## Antes de editar

Use esta tabela como checklist. Antes de modificar um arquivo que se encaixe numa categoria, **leia o(s) doc(s) correspondente(s)** — mesmo que pareça óbvio.

**Se o doc não existir ainda**: leia `~/.claude/templates/docs/<NOME>.md`, crie `.claude/docs/<NOME>.md` preenchendo com conhecimento real do projeto, e **só depois** prossiga com a edição.

| Ao tocar em… | Leia antes | Por quê |
|---|---|---|
| Deploy/CI (`.github/workflows/**`, `Dockerfile*`, `docker-compose*.yml`, `deploy/**`) | `DEPLOYMENT.md`, `INFRASTRUCTURE.md` | Compose é o caminho de instalação suportado; smoke gate `pnpm smoke:compose`. CI é automático em PR/push desde 2026-08-02, mas **deploy job em workflow é proibido** (ADR) — `scripts/ci-workflow.test.ts` falha se aparecer |
| Migrations, schema, índices, seeds (`**/migrations/**`, `*.sql`) | `DECISIONS.md`, `CONSTRAINTS.md`, `ARCHITECTURE.md` | Postgres é source of truth; mudanças de dados são irreversíveis |
| Novas dependências (`package.json` de qualquer workspace) | `STACK.md`, `DECISIONS.md` | workspace pnpm; alinhar com decisões de stack; commitar lockfile junto |
| Variáveis de ambiente, secrets, `.env*` | `SECRETS.md`, `DEPLOYMENT.md` | `SECRETS.md` do docs é sanitizado e versionado; nunca commitar valores reais |
| Auth, API keys, tokens de upload, scoping projeto/environment | `CONSTRAINTS.md`, `ARCHITECTURE.md` | contratos de ingestão são scoped por API key; tokens de source map são CI-only |
| Console (`apps/console/**`), design system, tokens visuais | `UI-UX.md` | Overview/investigação são read-only por padrão; seguir convenções visuais |
| Mutação nova no console v2 (`apps/console/src/v2/**`) | `apps/console/src/v2/lib/run-mutation.ts` | toda mutação v2 deve reportar falha via `runMutation()` (toast); nunca `void fn()` sem tratamento — ver PER-454 |
| Ingestão, filas, worker (`apps/api`, `apps/worker`, BullMQ/Redis) | `ARCHITECTURE.md`, `CONSTRAINTS.md` | handoff API→queue→worker; não quebrar contratos de ingestão |
| **Rota nova em `apps/api/src/routes/**`** | `apps/api/src/openapi.ts` | toda rota registrada precisa de entrada no spec — `apps/api/test/openapi-coverage.test.ts` falha nomeando a rota. Derive params/respostas do handler, nunca do nome da rota: spec que mente é pior que rota não documentada. As 36 de `/admin/*` estão num baseline temporário (`PENDING_ADMIN_ROUTES`, PER-460) que encolhe, não é isenção |
| Source maps (upload, storage, retenção, resolução) | `ARCHITECTURE.md`, `CONSTRAINTS.md`, `DECISIONS.md` | local-first, matching estrito, retenção worker-owned; console não exibe source original. `minified_file` é gravado como basename — path composto nunca casa com o frame (PER-472) |
| Agregados/KPIs em `telemetry-query.ts` | `CONSTRAINTS.md` | o agregado precisa aplicar **todos** os filtros da lista que ele resume, e só `status = 'error'` conta como falha — `pending` é o default de trace/span (ADR 2026-08-09) |
| Avaliador de alerta novo em `repositories/alerts.ts` | `CONSTRAINTS.md` | honrar `routePattern` na contagem **e** no group atribuído; filtro de rota é `exists` contra `traces`, nunca join (fan-out) |
| Teste que quer provar uso de índice | — | **não asserte a forma do plano** (`EXPLAIN`): a escolha é cost-based e vira com as estatísticas acumuladas da suíte. Verifique catálogo (opclass suporta o operador) + forma da expressão compilada + comportamento. Ver PER-475 |
| Guard de `/query/*` (`requireQueryPrincipal`) | `CONSTRAINTS.md`, `DECISIONS.md` | principal de read token só passa em leitura; escopo do token sobrescreve o da query string, nunca é validado contra ela |
| `packages/mcp/**` (tools do MCP) | `ARCHITECTURE.md` (seção "Non-human read access"), `.claude/plans/2026-08-22-mcp-sigmon-design.md` | toda tool compõe rotas de `/query/*` já existentes — ler a rota antes de mudar composição; campos em lista sempre passam por `budget.ts` (poda + `truncated`), nunca sem poda |
| `packages/loadgen/**` (motor de telemetria sintética) | `DECISIONS.md` (ADR 2026-08-28), `docs/superpowers/specs/2026-08-28-loadgen-synthetic-telemetry-engine-design.md` | envia dado real pra projetos reais via `@sigmon/sdk` público — nunca `retry.ts`/`sendSignal` internos; queda de monitor simulada só age na janela ao vivo (`endMs > nowMs`); janela de incidente mais curta que a duração do incidente trava o processo (PER-499, não corrigido) |
| Mutação nova em `apps/api/src/routes/query.ts` | `CONSTRAINTS.md` | todo handler de mutação precisa recusar read token explicitamente — não existe allowlist de path que faça isso por você |
| Decisão arquitetural relevante | `DECISIONS.md` (ler + adicionar ADR) | rastreabilidade |
| Escopo/objetivos do projeto | `PROJECT-SUMMARY.md` | fase atual: Phase 6G hardening |

---

## Antes de executar ações destrutivas ou irreversíveis

Sempre rode mentalmente o checklist abaixo. Se qualquer item falhar, **pare e confirme com o usuário**.

- [ ] `bash ~/.claude/scripts/check-context.sh` não mostra 🔴 para nenhum provider
- [ ] Se a ação envolve banco, há backup recente e a migration foi testada localmente
- [ ] Se a ação envolve branch protegida ou remoto compartilhado, o usuário autorizou esta operação específica

Ações consideradas destrutivas/irreversíveis: `rm -rf`, `DROP TABLE`, `docker compose down -v`, `git push --force`, `git reset --hard`, apagar branches, amend em commits publicados.

## Verificação padrão (antes de considerar mudança completa)

```sh
pnpm test
pnpm build
pnpm --filter @sigmon/sdk build
docker compose config
```

---

## Atualização contínua

- **A cada doc criado/removido** em `.claude/docs/`: atualize a tabela acima.
- **Sempre que descobrir uma nova área de risco** não coberta aqui: adicione uma linha.
- **Mantenha curto**: este arquivo é carregado em toda sessão.
