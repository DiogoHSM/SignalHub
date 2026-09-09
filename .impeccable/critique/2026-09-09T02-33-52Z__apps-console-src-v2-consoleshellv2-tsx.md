---
target: Revisão UI/UX do console Sigmon
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-09-09T02-33-52Z
slug: apps-console-src-v2-consoleshellv2-tsx
---
# Revisão de UI/UX — Sigmon
Revisão com duas avaliações independentes de código e inspeção visual desktop de Operations, Monitors, Settings e System. Recomendações, sem alterações de UI.
## Direção
Preservar a densidade das tabelas e a identidade escura. Organizar a leitura em: confiança nos dados → situação → impacto → evidências → ação → confirmação da recuperação.
O produto já possui identidade de observabilidade e uma boa estrutura de Operations com prioridades antes das métricas. Foco visível, alvos de interação e navegação de retorno são bases a preservar.
## Prioridades
- P1: distinguir sem telemetria, dados insuficientes, desatualizados, saudável e incidente. Na inspeção, Settings informa nenhum sinal recebido enquanto Operations afirma faixa esperada, ausência de anomalias e risco 5% com 0/0 amostras. Não apresentar probabilidades sem suporte. Exibir cobertura e última ingestão antes do estado de saúde.
- P1: corrigir escopo do badge de Incidents. ConsoleShellV2.tsx usa fleet.rollup.counts.critical, repassado ao NavRail. Mostrar somente incidentes ativos do projeto/ambiente selecionado; zero sem badge e indisponível como estado desconhecido. Problemas globais pertencem ao radar.
- P1: separar configuração de projeto, instalação do SDK e administração da instância. Settings abre Setup com lista de projetos, SDK, chaves, source maps e widget. Um seletor global de projeto/ambiente é suficiente; lista de projetos deve existir na administração deles. System já explica self-monitoring no subtítulo, mas o topo ainda sugere escopo de projeto. Usar “Saúde do Sigmon”, escopo “Instância”, sem seletor ativo que sugira filtrar esses dados.
- P1: navegação expandida e agrupada com três preferências: fixada aberta, fixada compacta, automática. Padrão aberto no desktop; automática abre por foco/ponteiro como sobreposição; mudanças não deslocam as tabelas durante hover. Persistência independente do radar. Controle explícito e teclado; mobile usa gaveta.
- P2: narrativa por tela com frase factual, impacto e próximo passo, preservando tabelas e filtros. Detalhes técnicos, método e payload em expansão. Estados vazios orientam primeira ação e não simulam saúde.
## Taxonomia proposta
Visão geral fora dos grupos.
Operar: Incidentes, Monitores, Regras de alerta.
Investigar: Erros (atual Investigate), Eventos, Traces, Chamadas de IA.
Entender o produto: Analytics, Usuários, Contas/tenants, Experimentos.
Configurar: Configurações do projeto, Instalação e SDK.
Instância em bloco separado: Saúde do Sigmon, Administração.
“Contas” depende do significado real de Entities para o público; manter tenants como explicação quando necessário.
## Contexto e cores
Um seletor de projeto/ambiente no topo, com breadcrumb de categoria/página. Radar global sob demanda, explicitamente identificado como todos os projetos. Administração de projetos não deve trocar silenciosamente o contexto investigado.
Cor discreta por categoria no marcador ativo, ícone e breadcrumb; preservar identidade e cores de gravidade em todas as telas. Separar tokens de categoria, ação e status antes de variar accent: System hoje usa accent para estado saudável.
## Ajustes concretos
Trocar SVG settings (círculo e raios) por engrenagem. A busca promete procurar registros mas gera comandos de navegação; renomear até existir busca real. Corrigir atalho Windows para Ctrl+K. Título Active incidents deve acompanhar History. Mostrar comparação numérica quando houver base; evitar “vs prior window” vazio.
Settings: Geral; Ambientes; Instalação/SDK; Chaves e origens; Integrações; Dados e retenção. Usuários do console em administração da instância. Recent feedback é conteúdo de produto, não configuração do widget.
## Heurísticas
Julgamento qualitativo inicial por código, não medição com usuários. Visibilidade 2; correspondência com mundo real 2; controle 3; consistência 2; prevenção 3; reconhecimento 1; eficiência 3; minimalismo 2; recuperação 2; ajuda 2. Total 22/40. A observação posterior de estado saudável sem amostras reforça a prioridade de visibilidade; não foi usada para recalibrar a nota.
## Personas
Primeiro uso: precisa descobrir onde começar e o significado de cada sinal.
Operador experiente: precisa manter contexto e densidade, atalhos e filtros ao aprofundar.
Teclado/baixa visão: precisa rótulos acessíveis, foco, aria-current e contagem textual; cor não pode ser o único sinal.
## Sequência
1. Verdade dos estados, badge e escopo; engrenagem.
2. Shell: rótulos, grupos, três modos do menu e seletor único.
3. Separação de Settings e administração.
4. Narrativa nas telas: começar por Operations e Incidents.
Validar com tarefas: identificar o projeto, dizer se está saudável ou sem dados, encontrar causa/impacto e próximo passo, distinguir saúde da aplicação e do Sigmon.
