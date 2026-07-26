# Auditoria — batch 2026-07-25 (11 branches do /executar)

**Método:** uma unidade por iteração. Subagente sonnet audita (diff `git diff main...<branch>` + arquivos em contexto completo: callers, migrations, testes) contra os invariantes abaixo; achados ≥ medium passam por validação adversarial (opus, default = refutado). Detalhes em `findings/<ID>.md`; aqui só status e síntese.

**Threshold de reabertura:** Linear está com token expirado nesta sessão → **tudo doc-only** (`🐛 doc-only` = achado confirmado documentado; reabertura/comentário fica pro /gerenciar). Confirmado ≥ medium ou low funcional/segurança → doc-only com destaque na síntese. Refutado/nitpick → só findings/.

**Invariantes auditados (de CONSTRAINTS.md + DECISIONS.md):**
- Escopo projeto+environment em toda leitura/escrita de telemetria; keys de ingestão com escopo único; escopos arquivados rejeitam escrita (inclusive retries pós-arquivamento).
- Rotas /query exigem sessão humana; rotas /admin exigem admin; API keys só hash+prefixo (pepper ≥32).
- SQL: nada de identificador/operador vindo do cliente concatenado; valores sempre bind (crítico no compilador de segmentos PER-441 e nos SQL crus PER-439/440).
- Webhooks/notificações: SSRF blocklist (local/privado/link-local/multicast/loopback/metadata) em TODO ambiente; timeouts explícitos; retry só p/ falha transitória (PER-444).
- Worker sanitiza antes de persistir; retries idempotentes (job id determinístico) — vale pros rollups PER-440 e replay DLQ PER-443.
- Logs estruturados com redação de segredos; replay/feedback browser-safe (sem screenshot).
- Console: v1 intocado até PER-438; telas Overview/investigação read-only salvo mutação desenhada.

**Ordem (risco primeiro):** 441 (superfície de injeção) → 444 (SSRF/canais) → 439 → 440 (SQL cru + rollup worker) → 443 (ações admin DLQ) → 431 → 434 → 432 → 435 → 436 → 437 (UI).

| Unidade | Branch | Status | Resultado |
|---|---|---|---|
| PER-441 segmentos/compilador | diogohsm/per-441-… | 🐛 doc-only | **F1 high CONFIRMADO** (trait eq com containment text-only — traits number/boolean nunca casam; provado em PG16 real); F2 IDOR→low (sem fronteira de privilégio: admin é booleano global, pré-existente em main); F3→low (semântica "ativos na janela" defensável, pré-existente; gap de doc); F4→low (inalcançável via API; 503 é convenção de query.ts). 3 lows de teste/doc no findings. |
| PER-444 canais slack/discord/email | diogohsm/per-444-… | 🐛 doc-only | **F1 CONFIRMADO rebaixado a medium**: URL de webhook slack/discord (que É a credencial) devolvida sem máscara pela API e renderizada no console — mas só sessão admin lê, não vaza em logs/errorMessage, e a redação é idêntica a main (padrão herdado do webhook genérico; fix = tratar url como write-only nos tipos slack/discord). +3 lows no findings. Sólido: SSRF sem bypass, retry/timeout, e-mail escapado e não-injetável. |
| PER-439 funil SQL | diogohsm/per-439-… | 🐛 doc-only | **F1 high CONFIRMADO** (reproduzido em PG real: ator com 2 valores de breakdown infla entrants/completed — 3/2 onde o correto é 2/1; sampleActors duplica actorId); **F2 high CONFIRMADO** (sem statement_timeout no pool nem LIMIT na matched; benchmark O(n²): 10k atores=8,6s, 30k=101s, 300k >10min — claim "stays cheap" da doc refutado empiricamente); F3→low (escopo vem de um único ponto, risco de regressão baixo). Unidade mais crítica do lote. |
| PER-440 retenção SQL + rollup | diogohsm/per-440-… | 🐛 doc-only | F1→**medium confirmado** (rollup subconta o bucket corrente, sem flag; mitigado: só com range_days>90 explícito, console nunca envia); F2 REFUTADO (semântica documentada em 4 lugares); F3→low (escopo correto, só dívida de teste); **V1 high NOVO do red-team**: entryEligibility sempre lê de `events` mesmo em modo rollup — com purge de events (>90d), `range_days=200`+`entry_event` colapsa coortes antigas; fix local (event_actor_daily já tem event_name na PK). Sólido: UTC ponta a ponta, rollup idempotente, advisory lock. |
| PER-443 DLQ console | diogohsm/per-443-… | ✅ clean | Nenhum ≥ medium sobreviveu: F1→low (COUNT total visível na tela + limite fixo é padrão do v2 + fila drenável), F2 confirmado mas low (rótulo "Replaying…"/"Deleting…" trocado por <2s, impacto funcional nulo), F3 REFUTADO (fake timers já existem no teste do ConfirmButton; suíte 2× verde — flake do batch segue sem causa identificada, não é o timer). Sólido: auth+auditoria transacional, schema check no replay, escopo arquivado re-checado. |
| PER-431 triage v2 | diogohsm/per-431-… | 🐛 doc-only | F1→**medium confirmado** (void setStatus/setPriority sem catch — falha é MUDA, não enganosa: sem estado otimista, reload só no sucesso; mesmo padrão já existe em main pra resolve/reassign/silence — tema sistêmico); F2→low (premissa falsa: v1 já expõe triage sem gate, AC era paridade, backend intocado); F3→low (reopen é upsert atômico guardado por timestamp, documentado; falta só ADR). |
| PER-434 Users + nav-filtros | diogohsm/per-434-… | 🐛 doc-only | **F1 medium CONFIRMADO** (probe: após "Clear filters" a query LLM ainda leva provider/model/promptName, chip some e lista fica filtrada sem indicador nem caminho de remoção — não é paridade v1, seed/chip são novos); F2→low (filtros persistem na troca de usuário mas ficam visíveis/removíveis; paridade v1); F3→low (corte top-50 sem aviso é paridade literal v1, dívida da PER-446). Sólido: one-shot correto, escopo ok, zero XSS via traits. |
| PER-432 Tenants | diogohsm/per-432-… | 🐛 doc-only | **F1 high CONFIRMADO**: `entities` ausente do array NAV na branch E na integração pós-merge (irmãs 434/436/437 adicionaram as suas nos próprios commits) — Entities é a única seção top-level sem ícone na sidebar, alcançável só por aba do Investigate/palette. Fix trivial (1 entrada no NAV). +low: teste da NavRail tautológico não pegaria. Sólido: read-only, race-guard, testes reais, escopo ok. |
| PER-435 Feedback Setup | diogohsm/per-435-… | ✅ clean | F1→low REFUTADO em parte (paginação não existe em NENHUMA camada e o plano autorizou manter 25; itens triados visíveis é desenho v1 portado; sobra só o filtro de status — fora do AC, paridade deliberada, precedente PER-443). Nenhum ≥ medium. Sólido: sem screenshot, sem XSS, escopo ok, testes executados (30/30). |
| PER-436 Events/Analytics | diogohsm/per-436-… | 🐛 doc-only | **F1 high CONFIRMADO e ampliado**: opacity de grupo no .sh-heat funde texto+fundo — com os tokens reais o contraste é 1.05:1 a ≤8% e só 1.51:1 a 100%: NENHUM valor passa WCAG AA, heatmap inteiro ilegível (pior que o descrito). Nota: bug "coluna Events deslocada" do E2E NÃO existe no código — branch e integração idênticas byte a byte, mapeamento 1:1 correto; E2E viu dado (tenantId nulo → "—" / name parecido com tenant) ou bundle obsoleto → corrigir o texto da issue P3 antes de criar no Linear. +4 lows (NaN%, erro genérico ao salvar segmento, corte silencioso em 12 steps, gap de teste célula-por-coluna). |
| PER-437 Experiments | diogohsm/per-437-… | ✅ clean | Ambos meds rebaixados a low: F1 gap de teste de toast é classe já normalizada como low no lote (mas nota: 3 testes "returns false" asserem true em branch inalcançável — teatro pontual); F2 falta de auditoria em experiments/betas é lacuna de backend intocada pelo diff, herdada (mesmo critério PER-431 F2). Sólido: requireAdmin, dry-run read-only, role=button acessível, AC integral. |

**Watch-items herdados do batch:** PER-439 EXPLAIN do índice 0041 + guard-rail funnel_scope_too_large ausente; PER-440 breaking semântico de coortes (documentado — conferir docs); PER-443 flake da suíte console; PER-444 colisão de numeração 0041 (renumerada p/ 0045 na integração); achados do E2E 2026-07-26 (cold-start v2, higiene visual) já registrados no batch.

---

## Síntese final (2026-07-26)

**11/11 auditadas** (sonnet) **e validadas adversarialmente** (opus, default=refutado). **3 ✅ clean** (443, 435, 437) · **8 🐛 doc-only** · 0 reabertas (Linear com token expirado — reabertura/issues ficam pro /gerenciar ou próximo /iniciar).

### Achados confirmados ≥ medium (10), por prioridade de correção

**Corretude de dados (corrigir antes de considerar analytics confiável):**
1. **PER-439 F1 (high)** — funil com `breakdown_property` conta o mesmo ator 2x+ (reproduzido em PG real: 3/2 onde o correto é 2/1). `telemetry-query.ts:2049-2170`.
2. **PER-441 F1 (high)** — trait `eq` compila containment com valor forçado a texto; traits number/boolean nunca casam (provado em PG16; ingestão preserva tipos nativos). `analytics-segment-compiler.ts:193-196,258-260`.
3. **PER-440 V1 (high, achado do red-team)** — `entryEligibility` sempre lê de `events` mesmo em modo rollup; com purge >90d, `range_days` longo + `entry_event` colapsa coortes antigas. Fix local: `event_actor_daily` já tem `event_name` na PK. `telemetry-query.ts:2119-2128`.
4. **PER-440 F1 (med)** — modo rollup subconta o bucket corrente (rollup para em `< today`), sem flag de parcialidade; mitigado por só ativar com `range_days>90` explícito.

**Custo/resiliência:**
5. **PER-439 F2 (high)** — sem `statement_timeout` no pool nem cota no funil; O(n²) medido (10k atores=8,6s; 30k=101s). Claim "stays cheap" da doc refutado. Recomendação: `statement_timeout` no pool (protege TODAS as queries) + guard `funnel_scope_too_large`.

**Segredos:**
6. **PER-444 F1 (med)** — URL de webhook slack/discord (a credencial) devolvida sem máscara pela API/console; admin-only e sem vazamento em logs; padrão herdado do webhook genérico. Fix: url write-only nos tipos slack/discord.

**UX/paridade v2:**
7. **PER-436 F1 (high)** — heatmap de retenção ilegível: opacity de grupo funde texto+fundo; contraste 1.05–1.51:1, nenhum valor passa WCAG AA. Fix: opacity só no fundo (ex.: `color-mix` no background).
8. **PER-432 F1 (high)** — seção Entities ausente do array NAV (branch E integração): única seção top-level sem ícone na sidebar. Fix trivial.
9. **PER-434 F1 (med)** — "Clear filters" do LLM não limpa provider/model/promptName vindos de seed; lista fica filtrada sem indicador nem caminho de remoção.
10. **PER-431 F1 (med)** — `void setStatus/setPriority` sem catch: falha de triage é muda (não enganosa — sem estado otimista). Mesmo padrão já existe em main (resolve/reassign/silence/addNote) → tema sistêmico.

### Temas sistêmicos (1 recomendação vale o codebase)
- **Mutações do console v2 sem tratamento de erro padronizado**: confirmado na 431 (med), gaps low equivalentes na 435/437, padrão idêntico pré-existente em main. Recomendação: helper único de mutação (run → toast de falha) + teste de contrato; vale linha no GUARDRAILS.md.
- **Knobs de analytics do cliente sem guard de custo**: funil (439) é o pior caso; nenhum `statement_timeout` no pool protege o resto. Uma config no pool resolve a classe inteira.
- **"Paridade com v1" carrega dívidas junto**: top-50 + sort client-side sem aviso (432/434, PER-446), triage sem gate/auditoria (431), feedback sem filtro/paginação (435), corte silencioso de 12 steps (436). Decisão consciente da fase — mas concentrar em issue-mãe de UX quando o v2 virar default (PER-438).
- **Teatro de teste pontual**: teste tautológico da NavRail (432), 3 asserts "returns false" em branch inalcançável (437), sem assert célula-por-coluna (436). Baixo volume, mas foi exatamente onde os bugs high passaram (432 F1, 436 F1).
- **Valor do passe adversarial**: dos 14 achados ≥ medium originais, 6 confirmados, 7 rebaixados, 1 refutado — e 1 high NOVO encontrado (440 V1). Falso-positivo alto justifica manter a validação obrigatória.

### Correções ao registro do E2E (antes de criar as issues no Linear)
- Item (c) da issue P3 ("colunas Events deslocadas") **não é bug de código**: mapeamento 1:1 correto, branch=integração byte a byte. O E2E viu `tenantId` nulo ("—") ou bundle obsoleto. Remover ou reclassificar como "verificar dado".
- Flake da suíte console (batch 443): **não** é o timer do ConfirmButton (fake timers já existem; suíte 2× verde na validação). Causa segue desconhecida; manter observação.

### Handoff pro /gerenciar
- Criar issues Linear: (a) os 10 achados acima (agrupar por unidade ou 1 issue-mãe "Audit 2026-07-26" + filhas); (b) as 2 issues do E2E (P2 cold-start v2 bloqueando PER-438; P3 higiene visual COM a correção do item c); (c) avaliar fix inline no merge para os triviais (432 F1 = 1 linha no NAV).
- Ordem de merge e renumeração da migration 0041→0045 já documentadas no batch 2026-07-25.
- **Política nova do usuário (2026-07-26, memória global)**: proibido GitHub Actions exceto release de produção; todo teste 100% local. Os workflows atuais do repo (tests/build/smoke em PR) violam a política — /gerenciar deve restringir triggers a release e atualizar CLAUDE.md/DEPLOYMENT.md do projeto.
