# Administração via CLI/MCP, preços de LLMs e OpenTelemetry

Data: 2026-09-09. Status: requisitos registrados; sem implementação nesta entrega.

Este documento separa os pedidos de produto das recomendações técnicas. Nomes de campos e comandos abaixo são propostas para uma implementação futura, não contratos disponíveis hoje. A direção de adoção gradual de OpenTelemetry foi aprovada em 2026-09-09; esta entrega continua limitada à documentação, sem autorização para iniciar implementação.

## Situação atual verificada

| Área | Evidência no repositório | Lacuna |
| --- | --- | --- |
| CLI | `packages/cli/src/index.ts` oferece `sigmon sourcemaps upload`. | Ampliar para controle e administração. |
| MCP | `packages/mcp/src/server.ts` registra nove ferramentas de investigação; `stdio.ts` usa `SIGMON_READ_TOKEN`. | Acrescentar operações administrativas e autorização de escrita. |
| Custos LLM | `packages/telemetry/src/ingestion-schemas.ts`, em `llmCallPayloadSchema`, aplica `cost_usd.default(0)` e defaults zero aos tokens. `packages/db/migrations/0001_initial.sql` define custo não nulo com default zero. | Ausência e zero tornam-se indistinguíveis; não foi identificado catálogo de preços ou cálculo automático no fluxo examinado. |
| Propagação de traces | `packages/sdk/src/trace-context.ts` gera IDs no formato W3C e lê/emite `traceparent`; o wrapper Next.js aproveita o contexto recebido. | O parser reemite flags como `01`; não foi encontrado suporte a `tracestate`. Isso não comprova conformidade integral com W3C ou OTel. |
| Ingestão | `docs/HTTP-INGESTION.md` descreve endpoints JSON próprios em `/v1/*`; schemas próprios em `packages/telemetry`. | Não foram encontrados receptor/exportador OTLP, dependências `@opentelemetry/*` ou convenções `gen_ai.*` no código de runtime e lockfile examinados. |

Conclusão: há compatibilidade parcial de contexto de traces, mas o Sigmon não deve ser apresentado hoje como backend compatível com OpenTelemetry. Ter traces e spans não basta para essa afirmação.

## 1. CLI e MCP para controle e administração

Requisito: permitir que operadores, scripts e agentes controlem e administrem o Sigmon por ambas as interfaces, ampliando os pacotes existentes.

Cobertura pretendida:

- Projetos e ambientes: listar, consultar, criar, alterar e arquivar.
- Acesso: administrar usuários, permissões e credenciais, incluindo emissão e revogação conforme as capacidades da API.
- Operação: saúde, diagnósticos, filas, dead letters, reprocessamento, backups e retenção.
- Configuração: monitores, alertas, canais e integrações.
- LLMs: consultar catálogo, preços, cobertura e estado de atualização; solicitar sincronização e administrar preços personalizados.
- Preservar investigação, consultas e upload de source maps já existentes.

Direção técnica proposta: CLI e MCP devem consumir a mesma API e regras de autorização da console. Definir credenciais de máquina revogáveis, com permissões de leitura/escrita e escopo explícito; não promover tokens de leitura ou chaves públicas de ingestão a administradores. Registrar autor, escopo, operação e resultado em auditoria.

A CLI deve oferecer ajuda, saída humana/JSON, paginação e códigos de saída previsíveis. O MCP deve oferecer ferramentas tipadas e separar consulta de mutação. Operações destrutivas devem explicitar alvo e impacto e exigir confirmação apropriada ao cliente. Ações assíncronas devem retornar identificação e permitir acompanhar conclusão; aceite na fila não significa sucesso da operação.

Critérios de aceite futuros: operações administrativas prioritárias disponíveis nas duas interfaces, paridade de autorização com a API, testes de isolamento entre projetos/ambientes e proibição de escrita com credenciais de leitura. A lista de comandos e a matriz exata de permissões serão detalhadas antes da implementação.

### Distribuição pública e MCP remoto

Complemento solicitado em 2026-09-09: publicar a CLI para instalação simples, disponibilizar MCP remoto em `mcp.sigmon.app` ou domínio equivalente, permitir gerar token de acesso ou conectar via OAuth e documentar a experiência no site e no Markdown de configuração de agents.

Verificação nesta data: `@sigmon/cli` e `@sigmon/mcp` estão com `private: true`; consultas públicas ao npm registry retornaram HTTP 404 para ambos. O workflow `.github/workflows/publish-sdk.yml` publica apenas o SDK. A consulta DNS de `mcp.sigmon.app` retornou domínio inexistente. O MCP encontrado usa stdio local. Isso confirma indisponibilidade pública nesses nomes, sem excluir instalações privadas ou outros nomes não identificados.

#### MCP hospedado

- Endpoint proposto: `https://mcp.sigmon.app/mcp`, via HTTPS e Streamable HTTP. O hostname é uma preferência de produto, ainda não provisionada; usar um caminho no host atual também é tecnicamente possível.
- Reutilizar ferramentas e serviços existentes, adicionando transporte remoto e autenticação. Preservar stdio para instalações locais e self-hosted.
- Definir DNS, certificado, proxy, limites, timeouts, healthcheck e compatibilidade com clientes antes do lançamento. O usuário deve conectar informando a URL, sem clonar o repositório ou rodar um servidor local.
- Escolher e declarar uma versão do protocolo suportada pelo SDK e pelos clientes testados. Seguir a especificação oficial de [Streamable HTTP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx), conferindo os requisitos da versão selecionada na implementação.

#### Tokens e OAuth

Recomendação de experiência: oferecer ambos, com token para CI/scripts e clientes que aceitem Bearer configurável, e OAuth para clientes interativos compatíveis. Token manual isolado não garante interoperabilidade com clientes que exigem descoberta OAuth.

Na console, permitir criar, nomear, listar metadados, expirar e revogar tokens de acesso. Selecionar permissões e projetos/ambientes; leitura como padrão, administração explicitamente concedida. Mostrar o segredo apenas na criação, armazenar hash e exibir último uso. Tokens de acesso não são chaves de ingestão, tokens de source maps ou cookies de sessão. A autenticação não deve ampliar as permissões do usuário emissor; alterações de acesso e revogações devem afetar novas chamadas.

Para OAuth, oferecer login e consentimento com escopo visível. Implementar descoberta de resource/authorization server, PKCE, validação de issuer/audience/resource, expiração e revogação conforme a [especificação de autorização MCP](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx). O login Google já existente na console não torna o Sigmon automaticamente um servidor OAuth para clientes MCP. Definir o authorization server e a estratégia de cadastro de clientes como parte da implementação.

CLI e MCP devem usar autorização compartilhada, distinguindo tokens destinados a cada recurso quando necessário. Credenciais devem ficar em armazenamento local protegido ou secret manager do cliente, nunca em arquivos versionados, URLs ou exemplos públicos. Documentar logout/revogação e o comportamento em token expirado, escopo insuficiente e acesso removido. Usuários podem instalar a CLI publicamente; acesso a dados permanece autenticado.

#### Publicação da CLI

Publicar `@sigmon/cli` no npm público com binário `sigmon`. Experiência pretendida após o lançamento: `npm install -g @sigmon/cli` e `npx @sigmon/cli@<versão> --help`. Esses comandos são metas, ainda não instruções funcionais de instalação. Oferecer versão fixada para CI, requisitos de Node/OS, atualização, desinstalação, changelog e exemplos de autenticação sem senha administrativa compartilhada.

Antes de publicar: remover o bloqueio `private` apenas no pacote preparado, definir conteúdo distribuído/licença/metadados, incluir build e todas as dependências de runtime, verificar ausência de segredos e de dependências `workspace:*` não resolvidas e testar o tarball instalado fora do monorepo. Validar Windows, macOS e Linux, ajuda, autenticação e uma operação autorizada. Definir processo de release reproduzível de acordo com a política vigente do repositório; o workflow atual é manual e exclusivo do SDK.

Publicar também `@sigmon/mcp` como opção stdio é uma recomendação complementar; não é pré-requisito para usar o serviço remoto. Se distribuído, resolver em especial a dependência interna `@sigmon/telemetry` e testar execução sem checkout do monorepo.

#### Site e configuração de agents

O lançamento deve incluir documentação pública navegável no site, ligada pela landing page e pela área de documentação, com:

- Quickstart da CLI, requisitos, instalação, versão, autenticação, comandos e atualização.
- URL MCP definitiva, token e OAuth, seleção de escopo, conexão e revogação.
- Exemplos efetivamente testados nos clientes de agents suportados, diferenciando configuração remota de stdio e compatibilidade de autenticação.
- Configuração self-hosted, diagnóstico de 401/403, token expirado e problemas de transporte.
- Referência das permissões e operações de administração, incluindo acompanhamento de ações assíncronas.

Manter `docs/AGENT-SETUP.md` como fonte do guia público `/agents.md`, já servido por `apps/api/src/routes/sdk-docs.ts`. Na implementação, substituir o onboarding baseado em sessão administrativa pelo fluxo de credencial delegada onde disponível. Documentar descoberta/seleção de projeto e ambiente, criação autorizada de chaves de ingestão, instalação do SDK e confirmação de chegada da telemetria. Não confundir o token usado pelo agent para administrar com a chave instalada no aplicativo monitorado.

Até o lançamento, documentação deve identificar URL, comandos e fluxos futuros como planejados. Após deploy, verificar o conteúdo efetivamente servido no site e em `/agents.md`, além dos links de instalação; edição no repositório não equivale a publicação no site.

Critérios de aceite futuros: pacote público instalável em máquina limpa; endpoint MCP com DNS/TLS e conexão por cliente externo; token criado/revogado pela console; OAuth funcionando nos clientes declarados, caso disponibilizado; bloqueio de escrita sem permissão; documentação do site e `/agents.md` validada ponta a ponta sem acesso ao monorepo. Antes do release, decidir se a primeira versão oferece token, OAuth ou ambos e declarar claramente a matriz de clientes suportados.

## 2. Catálogo amplo de preços de LLMs

Requisito: manter uma tabela com a maior cobertura prática de provedores e modelos, atualizada automaticamente a cada sete dias quando a fonte permitir. A atualização pertence ao produto, no scheduler do Sigmon; este documento não cria automação nem agenda tarefas.

Fonte candidata: [Models.dev](https://github.com/anomalyco/models.dev/blob/dev/README.md), cujo projeto publica uma API JSON com dados por provedor/modelo e preços por milhão de tokens, incluindo dimensões de cache. Usá-la como base ampla, validando as condições de uso na implementação e conciliando divergências com fontes oficiais dos provedores. Nenhuma fonte garante cobertura completa ou preços sempre atuais.

Proposta de registro:

| Grupo | Dados necessários |
| --- | --- |
| Identidade | Provedor que cobra, ID exato do modelo, versão e aliases explícitos. |
| Contexto comercial | Região, modalidade, faixa de contexto, serviço/tier e batch quando alterarem preço. |
| Tarifas | Entrada, saída, leitura/escrita de cache e outras unidades cobradas; moeda e unidade explícitas. |
| Proveniência | Fonte, data de coleta, vigência quando conhecida, versão/hash do catálogo e estado de validação. |
| Personalização | Preço contratado por escopo, prioridade sobre catálogo público e histórico auditável. |

Não assumir que o mesmo modelo custa igual no provedor original, em um gateway ou em outra nuvem. Não interpretar preço ausente ou zero de um catálogo como declaração de gratuidade do cliente. Modelos locais também podem ter custo de infraestrutura; gratuidade é uma informação explícita sobre a chamada.

Atualização proposta: buscar e validar um snapshot fora do caminho de ingestão, publicar atomicamente, manter a última versão válida em caso de falha, usar exclusão mútua/deduplicação e tentativas limitadas. Preservar overrides locais e histórico; remoção na fonte não deve apagar tarifas históricas. Exibir última tentativa, último sucesso, idade do catálogo, falhas e modelos sem preço. Oferecer atualização manual e importação para instalações offline.

Usar a tarifa vigente na data da chamada quando disponível. Se a fonte não fornecer vigência histórica, registrar que o preço era conhecido a partir da coleta; não aplicar a tarifa atual retroativamente como se fosse histórica. Guardar a versão usada em cada estimativa e não recalcular o passado silenciosamente.

Critérios de aceite futuros: importação extensível por fonte, cobertura mensurável por provedor/modelo, execução semanal, recuperação de falha sem perder o catálogo, preservação de overrides e reprodução de estimativas com a versão registrada.

## 3. Custo informado, estimado, gratuito e desconhecido

Requisito: calcular custo quando não informado, se houver preço e consumo suficientes. Gratuidade deve ser marcada explicitamente como `free`, separada do número `0.00`.

Proposta de entrada: `cost_mode: "auto" | "reported" | "free"`, com `auto` como padrão quando ausente, e `cost_usd` numérico opcional. No SDK, nomes equivalentes podem seguir camelCase. Resultado armazenado: `cost_source: "reported" | "estimated" | "free" | "unknown"`, custo efetivo anulável, custo original informado e referência da tarifa quando usada.

| Entrada | Resultado proposto |
| --- | --- |
| `free`, sem custo ou com zero | Custo efetivo zero, origem `free`, sem estimativa. |
| `free` com custo positivo | Rejeitar a contradição com erro de validação. |
| Custo positivo informado, modo ausente ou `reported` | Preservar valor, origem `reported`. |
| Custo ausente, modo ausente ou `auto` | Estimar se houver todos os dados necessários; caso contrário, `unknown` e custo nulo. |
| Zero informado, modo ausente ou `auto` | Não interpretar como gratuito; tentar estimativa e preservar o zero original para auditoria. |
| `reported` com zero | Preservar zero explicitamente informado, origem `reported`; não rotular como `free`. |
| `reported` sem custo | Rejeitar entrada incompleta. |
| `auto` com custo informado | Aplicar as regras acima: positivo é preservado, zero solicita estimativa. |

Essa semântica de zero é uma proposta explícita para evitar a ambiguidade atual. Deve ser documentada/versionada na migração; clientes que usam zero como gratuidade precisarão enviar `free`.

Para texto sem condições especiais: `custo = (tokens_entrada × preço_entrada + tokens_saída × preço_saída) / 1.000.000`, com tarifas em USD por milhão de tokens. Exemplo fictício: 1.000 tokens de entrada a USD 2/milhão e 500 de saída a USD 8/milhão resultam em USD 0,006.

Cache, reasoning, áudio, imagem, batch e faixas precisam seguir as unidades e regras do provedor, evitando dupla contagem de tokens já incluídos nos totais. Preservar ausência de contadores em vez de convertê-la em zero antes do cálculo. Sem dados suficientes para o custo completo, registrar `unknown` com motivo; eventual estimativa parcial deve ser identificada separadamente. Usar aritmética decimal e arredondar apenas na apresentação/persistência definida pelo contrato.

Console, API, CLI, MCP, agregações e alertas devem distinguir valores reportados, estimados, gratuitos e desconhecidos. Exibir quantidade/cobertura das chamadas sem custo conhecido; a soma conhecida não pode ser apresentada como gasto total completo. Usar uma fonte canônica por chamada para evitar somar novamente o mesmo custo em spans correlacionados.

Migração: os zeros históricos já perderam a informação de ausência versus gratuidade. Preservá-los como legado ambíguo, sem classificá-los automaticamente como `free` ou recalculá-los com preços atuais. Backfill futuro deve ser explícito, auditável e limitado a registros com dados e tarifas históricas suficientes.

Critérios de aceite futuros: todos os casos da tabela, modelo desconhecido, tokens ausentes, cache sem dupla contagem, preço personalizado, histórico de tarifas e agregações que revelem cobertura incompleta.

## 4. OpenTelemetry: vantagens e direção recomendada

O [OpenTelemetry](https://opentelemetry.io/docs/) padroniza instrumentação, coleta e exportação de traces, métricas e logs. O [OTLP](https://opentelemetry.io/docs/specs/otlp/) define o protocolo de transporte de telemetria. As [convenções semânticas](https://opentelemetry.io/docs/concepts/semantic-conventions/) padronizam o significado dos atributos.

Vantagens esperadas para o Sigmon: receber dados de instrumentações existentes em várias linguagens, reduzir integrações específicas por framework, facilitar correlação entre serviços e interoperar com Collectors e outros backends. OTel não fornece o catálogo de preços nem substitui armazenamento, console, analytics de produto ou regras de administração do Sigmon.

Direção aprovada: adoção incremental, preservando a ingestão atual. Começar por traces, depois logs correlacionados e posteriormente métricas, validando cada etapa antes de ampliar o escopo. Não prometer compatibilidade de 100% sem especificar versão, sinais, transportes e campos efetivamente suportados.

1. Revisar propagação W3C: IDs, relações pai/filho, flags de amostragem e `tracestate`.
2. Definir um mapeamento documentado de resource, instrumentation scope, atributos, timestamps, status, eventos e links para o modelo do Sigmon. Preservar identificadores externos necessários à correlação.
3. Adicionar ingestão OTLP de traces inicialmente, com transporte/encoding suportados declarados e isolamento por projeto/ambiente. Um Collector padrão precisa de um receptor OTLP compatível no Sigmon ou de um adaptador; não envia automaticamente para os endpoints JSON atuais.
4. Mapear spans de IA usando uma versão explícita das [convenções GenAI](https://opentelemetry.io/docs/specs/semconv/gen-ai/). A documentação consultada aponta para um repositório dedicado; verificar estabilidade dos atributos escolhidos na implementação. Manter cálculo e proveniência de custos como extensões documentadas do Sigmon.
5. Avaliar métricas/logs e instrumentação interna da API/worker separadamente, após validar demanda e impacto de armazenamento, cardinalidade e amostragem. Instrumentar o próprio Sigmon não torna sua ingestão compatível com OTLP.

Critérios de aceite futuros: envio de um trace por SDK OTel padrão e por Collector, preservação de trace/parent IDs e atributos, ausência de duplicação ao coexistir com SDK Sigmon, isolamento entre escopos e documentação precisa dos sinais/transportes suportados. Validar custo e consumo em traces amostrados antes de usá-los para totais financeiros.

### Armazenamento e impacto operacional

Decisão de 2026-09-09: avaliar ClickHouse ou outra alternativa somente se as necessidades e medições justificarem. Não introduzir um novo banco como pré-requisito de OTLP. O caminho atual API → Redis/BullMQ → Postgres será o ponto de partida da avaliação.

Antes de ampliar sinais ou substituir armazenamento, medir taxa de ingestão, tamanho dos lotes, atraso das filas, latência de consulta, CPU/memória, crescimento em disco, retenção e cardinalidade dos atributos em cargas representativas. Definir metas de capacidade e latência na especificação de cada etapa. Considerar custo e complexidade de operação, backup, recuperação e migração de dados ao comparar alternativas; escolher ClickHouse permanece uma decisão futura.

Aceitar o protocolo, preservar os dados e oferecer consultas/visualizações úteis são compromissos distintos. Suporte adicional exige representar os campos recebidos, lidar com retentativas e duplicações, manter isolamento e sanitização e oferecer limites por cliente. Métricas exigem tratamento próprio de contadores, histogramas e temporalidade, além de uma tela para exibi-las.

A contabilização de LLMs deve permanecer independente da amostragem de traces: somar chamadas amostradas não representa gasto completo. Para totais exatos, usar registros completos e deduplicados ou uma fonte agregada confiável; extrapolações devem aparecer como estimativas. Preservar o SDK Sigmon para onboarding e recursos de produto, como replay e feedback, durante a evolução da ingestão padrão.

## Sequência sugerida para futura implementação

Primeiro, definir contrato de custos e compatibilidade de clientes; depois catálogo versionado e cálculo; em seguida sincronização semanal e apresentação de cobertura. Administração CLI/MCP depende da matriz de permissões e API de máquina. OpenTelemetry pode seguir como frente própria, começando por propagação e um piloto OTLP de traces. Nenhuma dessas funcionalidades foi implementada ou ativada por este registro.
