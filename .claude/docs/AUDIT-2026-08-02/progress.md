# Auditoria 2026-08-02 — batch 2026-08-02

## Método

Uma unidade por iteração: subagente de auditoria (sonnet, varredura ampla contra os invariantes do projeto) → validação adversarial (opus, tenta **refutar** cada achado ≥ medium relendo o código real; default = refutado salvo prova clara) → decisão.

**Modo:** (a) pausar em ~400k e pedir `/compact`. Fonte de verdade entre iterações: este arquivo + `findings/`.

**Reabertura no Linear: DESLIGADA** (sem `--reopen`). As três branches ainda não foram publicadas, então achado confirmado vira correção antes do PR, não reabertura de issue. Confirmados ficam marcados 🐛 doc-only.

**A auditoria não altera nada fora de `.claude/docs/AUDIT-2026-08-02/`.**

## Threshold

| Resultado | Ação |
|---|---|
| Confirmado ≥ medium | 🐛 doc-only + correção recomendada antes do PR |
| Confirmado low que é bug funcional/segurança | 🐛 doc-only |
| Confirmado low de qualidade/nitpick | só `findings/` |
| Refutado | só `findings/`, com a nota do porquê |

## Unidades

| # | Unidade | Diff base | Tamanho | Status |
|---|---|---|---|---|
| U1 | `diogohsm/ci-automatico-health-version` (`5ff8500c`) | `main` | 11 arq · +144/-17 | 🐛 doc-only (1 medium) |
| U2 | `diogohsm/per-459-openapi-query-routes` (`b343a528`) | `main` | 2 arq · +1864/-75 | 🐛 doc-only (1 medium, 2 low) |
| U3 | `diogohsm/per-461-openapi-cauda-guard` (`2b8017ee`) | **PER-459** | 3 arq · +522/-1 | ✅ clean (2 low observacionais) |

U3 é diffada contra a PER-459, não contra `main`: as branches são empilhadas e usar `main` faria o diff da 459 ser auditado duas vezes.

Ordem: U1 primeiro (é a única que toca superfície pública em runtime e política de CI/deploy), depois U2/U3 (documentação + teste).

## Invariantes do projeto (extraídos de GUARDRAILS.md, CLAUDE.md e DECISIONS.md)

Os subagentes auditam **contra estes**:

1. **Deploy é manual.** ADR 2026-07-26, emendado em 2026-08-02 só na metade de CI. Nenhum workflow pode ter job de deploy. `scripts/ci-workflow.test.ts` é a trava.
2. **Segredos nunca são relidos.** Webhook URL de Slack/Discord é credencial (PER-452): resposta expõe `hasUrl` + `urlPreview`, nunca a URL. Segredos de API key e source-map upload token são one-time.
3. **`SECRETS.md` do docs é sanitizado e versionado**; o da raiz é gitignored e guarda valores reais. Nunca commitar valor real.
4. **Contratos de ingestão são scoped por API key** projeto/environment. Rotas `/admin/*` e `/query/*` exigem sessão humana.
5. **Console read-only por padrão** em Overview/investigação; mutação v2 passa por `runMutation()` (PER-454).
6. **Source maps local-first**, matching estrito, console nunca exibe source original.
7. **Postgres é source of truth**; migrations são irreversíveis.
8. **Repo é PÚBLICO** — nada de detalhe de operador (IP, painel, webhook, UUID) em arquivo versionado.

## Resultado

**3 unidades auditadas · 2 achados medium confirmados · 0 high · 0 crit · 4 low.** Nenhuma reabertura (modo sem `--reopen`; as branches não foram publicadas, então correção antes do PR substitui reabertura).

| Unidade | Veredito |
|---|---|
| U1 CI + `/health` | 🐛 1 medium |
| U2 PER-459 `/query/*` | 🐛 1 medium, 2 low |
| U3 PER-461 cauda + guard | ✅ limpa, 2 low observacionais |

### Tema sistêmico: verificação que aparenta cobrir mais do que cobre

Os dois medium são o **mesmo defeito em formas diferentes**, e um dos low de U3 é da mesma família:

- **U1** — a trava anti-deploy é blocklist de substring (`EASYPANEL`, `COOLIFY`, `api/v1/deploy`). Pega os vetores de cópia, não pega um job escrito do zero chamado `deploy:`. Reproduzido: 9/9 testes passam com o job rogue presente. Agrava porque `DECISIONS.md` e `GUARDRAILS.md` afirmam que o teste "enforces" a ausência de deploy job — e o `GUARDRAILS.md` é sempre carregado, então engana justamente quem fosse adicionar o job.
- **U2** — `docs.test.ts` lista 22 rotas novas, mas só 12 entradas `/query/*` têm asserção profunda (e 4 delas são pré-existentes). As demais só verificam que o path existe. Lido de relance parece cobertura de contrato; na prática um parâmetro errado passaria.
- **U3 (low)** — `DOCS_INFRA_ROUTES` não tem trava anti-rot, enquanto o `PENDING_ADMIN_ROUTES` ao lado tem. As 9 entradas atuais são legítimas, mas estruturalmente a lista pode crescer para calar um gap real.

O padrão certo já existe no repo: o `PENDING_ADMIN_ROUTES` do U3 falha se uma entrada dele passar a estar documentada. A técnica é conhecida — a aplicação é que é inconsistente.

**Recomendação de guardrail:** ao escrever um teste-trava, exigir a prova de que ele falha (remover o que ele protege e ver o teste vermelho) antes de afirmar em doc que ele "enforces" algo. U3 fez isso e saiu limpa; U1 não fez e é onde está o buraco.

### Correções recomendadas antes do PR

1. **U1 (medium)** — assertion exaustiva de nomes de job, validada empiricamente pelo validador adversarial:
   ```ts
   const jobsSection = content.slice(content.indexOf("\njobs:\n"));
   const jobNames = jobsSection.split("\n")
     .filter((line) => /^  [\w-]+:$/.test(line))
     .map((line) => line.trim().slice(0, -1));
   expect(jobNames).toEqual(["test", "build", "compose-config", "smoke-compose"]);
   ```
   O `slice` a partir de `jobs:` é obrigatório: o mesmo regex casaria `pull_request:`, `push:` e `workflow_dispatch:`. Com o fix, o texto já escrito nos docs vira verdade e não precisa ser suavizado.
2. **U2 (medium)** — estender as asserções profundas às 12 rotas restantes, ou reduzir a promessa. Não é bloqueante: nenhuma mentira de contrato foi encontrada.
3. **U2 (low)** — documentar os caps `limit 10` (llm/by-tenant) e `limit 20` (llm/by-prompt); hoje a resposta pode ser lida como exaustiva.
4. **U2 (low)** — `default: 50` do `limit` anotado em `/query/error-groups` mas ausente em `/query/events/paths` e `/query/error-groups/{id}/errors`, apesar de virem do mesmo `parseLimit()`.
5. **U3 (low)** — trava anti-rot para `DOCS_INFRA_ROUTES`; comentar por que `/console/*` fica fora do inventário do guard.

### O que está sólido (com evidência)

- **U2**: 22/22 rotas novas conferidas contra handlers e repositórios. As cinco afirmações específicas do commit (mttr só 7d/30d, defaults 24h vs 7d, clamp 500→200 do session timeline, cursores atados ao sort, PATCH exigindo ao menos um campo) foram confirmadas de forma independente, não aceitas. **Nenhuma mentira de contrato**: nada inventado, nada omitido, nenhum `required`/enum/default errado, nenhuma rota marcada como pública por engano. As 7 entradas `/query/*` pré-existentes são byte-idênticas — só realocadas, sem regressão.
- **U3**: guard provado mordendo em três experimentos distintos (rota estática não documentada injetada ao lado de uma irmã documentada; path removido do spec; entrada já documentada no baseline). `PENDING_ADMIN_ROUTES` reconstruído do zero — bate exato, 36 entradas, todas `/admin/*`. As 8 rotas da cauda conferidas linha a linha, incluindo o `/auth/google` 302 vs callback 200.
- **U1**: repo confirmado público, então o SHA no `/health` não revela nada novo. `pull_request` (não `_target`) + zero secrets no workflow + `contents: read` = PR de fork não ganha acesso elevado. `doctor.ts`, o cliente do console e o smoke harness não dependem do shape do corpo de `/health` — nada quebra ao adicionar `version`. Mutação de `process.env` nos testes novos está em try/finally.
- **Disclosure**: nenhum secret, hostname de operador, UUID ou identificador de tenant/usuário real em texto versionado nas três unidades.
