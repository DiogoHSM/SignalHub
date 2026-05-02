# Signal Hub

## PRD v0.2

## 1. Visão do produto

O **Signal Hub** é uma plataforma própria de observabilidade e inteligência operacional para produtos digitais, APIs, workflows e aplicações com IA.

O objetivo é centralizar, em um único ambiente, os principais sinais gerados pelos sistemas:

```txt
eventos de produto
erros
logs
traces
chamadas de IA
custos
latência
sessões
usuários
tenants
workflows
alertas
```

A primeira versão será focada em capturar e visualizar os sinais essenciais para entender:

> O que aconteceu, com quem aconteceu, onde aconteceu, quanto demorou, quanto custou e qual foi o impacto.

## 2. Problema

Os produtos atuais geram muitos sinais importantes, mas eles normalmente ficam espalhados em lugares diferentes:

```txt
eventos de uso
erros de frontend
erros de backend
falhas de workflows
logs de automações
chamadas de IA
custos por modelo
latência por etapa
sessões de usuários
comportamento por tenant
```

Isso dificulta responder perguntas simples, como:

```txt
Qual usuário teve erro?
Qual tenant consumiu mais IA?
Qual prompt ficou mais caro?
Qual fluxo está lento?
Qual workflow falhou?
Qual endpoint está instável?
Qual feature está sendo mais usada?
Qual parte da execução causou o problema?
```

O Signal Hub resolve isso criando uma linha única de observabilidade.

## 3. Objetivo

Criar uma plataforma interna para capturar, armazenar, consultar e visualizar sinais operacionais e de produto de todos os sistemas.

O produto deve permitir acompanhar:

```txt
saúde dos sistemas
uso dos produtos
falhas técnicas
execuções de workflows
custo e performance de IA
comportamento por usuário
comportamento por tenant
alertas operacionais
```

## 4. Escopo atual

A versão inicial será organizada em quatro grandes áreas.

### 4.1 Product Analytics

Captura e análise de eventos de produto.

Exemplos:

```txt
user_signed_up
dashboard_created
lesson_generated
chat_started
report_exported
payment_failed
workflow_started
workflow_completed
```

Funcionalidades iniciais:

```txt
captura de eventos via API
captura de eventos via SDK
filtros por projeto, ambiente, usuário e tenant
contagem de eventos por período
eventos por usuário
eventos por sessão
eventos por tenant
eventos por feature
```

### 4.2 Error Tracking

Registro e consulta de erros técnicos.

Funcionalidades iniciais:

```txt
captura de erros frontend
captura de erros backend
captura de erros em workers
captura de erros em workflows
stack trace
severidade
ambiente
release
usuário afetado
tenant afetado
trace relacionado
status do erro
```

Status possíveis:

```txt
aberto
investigando
resolvido
ignorado
```

### 4.3 LLM Observability

Monitoramento de chamadas de IA.

Funcionalidades iniciais:

```txt
modelo usado
provedor
prompt_name
tokens de entrada
tokens de saída
custo estimado
latência
status da chamada
erro da chamada
usuário
tenant
workflow
trace relacionado
input preview
output preview
```

Perguntas que essa área deve responder:

```txt
Qual modelo está mais caro?
Qual prompt consome mais tokens?
Qual tenant consome mais IA?
Qual fluxo tem maior latência?
Qual chamada de IA falhou?
Qual workflow gera mais custo?
```

### 4.4 Operational Tracing

Registro de execuções completas.

Exemplo:

```txt
Usuário clicou em "Gerar dashboard"
API recebeu a requisição
Router classificou a intenção
IA gerou SQL
Banco executou consulta
IA gerou explicação
Frontend renderizou resultado
```

Funcionalidades iniciais:

```txt
criação de traces
criação de spans
timeline de execução
duração por etapa
status por etapa
input e output parcial
erro por etapa
custo por etapa de IA
latência total da execução
```

## 5. Fases do produto

Por enquanto, o plano será organizado em quatro fases.

## Fase 1: Core de Telemetria

### Objetivo

Criar a base de ingestão, armazenamento e consulta dos sinais principais.

### Funcionalidades

```txt
criação de projetos
criação de ambientes
criação de API keys
ingestion API
validação de payloads
fila de processamento
armazenamento analítico
armazenamento operacional
captura de eventos
captura de erros
captura de chamadas de IA
captura de traces simples
```

### Entregáveis

```txt
POST /v1/events
POST /v1/errors
POST /v1/llm
POST /v1/traces
POST /v1/spans
POST /v1/logs
```

### Resultado esperado

Ao final da Fase 1, qualquer sistema poderá enviar sinais para o Signal Hub de forma padronizada.

## Fase 2: SDK e Integração com Produtos

### Objetivo

Facilitar a integração dos produtos existentes com o Signal Hub.

### Funcionalidades

```txt
SDK JavaScript
track()
identify()
captureError()
startTrace()
endTrace()
span()
llm()
flush()
```

### Exemplo de uso

```ts
signal.identify("user_123", {
  email: "user@email.com",
  plan: "pro"
})

signal.track("dashboard_created", {
  source: "ai",
  charts_count: 6
})

signal.captureError(error, {
  area: "dashboard_generation"
})

signal.llm({
  provider: "openai",
  model: "gpt-5.5",
  prompt_name: "generate_sql",
  input_tokens: 1200,
  output_tokens: 300,
  latency_ms: 8400,
  cost_usd: 0.03
})
```

### Resultado esperado

Ao final da Fase 2, os principais produtos poderão ser instrumentados com poucas linhas de código.

## Fase 3: Console Operacional

### Objetivo

Criar a interface visual para investigar eventos, erros, usuários, traces e chamadas de IA.

### Telas iniciais

```txt
Overview
Events
Users
Errors
Traces
LLM
Settings
```

### Overview

Deve mostrar:

```txt
eventos hoje
usuários ativos
erros nas últimas 24h
taxa de erro
latência p95
custo de IA hoje
chamadas de IA hoje
workflows com falha
top tenants por uso
top tenants por custo
```

### Events

Deve permitir:

```txt
listar eventos
filtrar por projeto
filtrar por ambiente
filtrar por tenant
filtrar por usuário
filtrar por sessão
buscar por nome do evento
visualizar propriedades do evento
```

### Users

Deve permitir ver:

```txt
dados do usuário
sessões recentes
eventos recentes
erros encontrados
traces relacionados
chamadas de IA relacionadas
custo estimado daquele usuário
```

### Errors

Deve permitir ver:

```txt
lista de erros
severidade
ocorrências
usuários afetados
tenants afetados
primeira ocorrência
última ocorrência
stack trace
trace relacionado
status do erro
```

### Traces

Deve permitir ver:

```txt
timeline da execução
spans por ordem
duração de cada etapa
status de cada etapa
input parcial
output parcial
erro por etapa
custo por etapa
latência total
```

### LLM

Deve permitir ver:

```txt
custo por projeto
custo por tenant
custo por usuário
custo por modelo
custo por prompt
latência por modelo
tokens por modelo
taxa de erro por modelo
chamadas por workflow
```

### Resultado esperado

Ao final da Fase 3, o Signal Hub já será útil para investigar problemas reais e acompanhar o uso dos produtos.

## Fase 4: Alertas, Governança e Maturidade Operacional

### Objetivo

Transformar o Signal Hub em uma ferramenta ativa de monitoramento, não apenas consulta.

### Funcionalidades

```txt
regras simples de alerta
canais de notificação
histórico de alertas
mascaramento de dados sensíveis
rate limit
retenção configurável
agregações diárias
backup
painel de saúde do próprio Signal Hub
```

### Exemplos de alertas

```txt
erro crítico em produção
taxa de erro maior que 5% em 10 minutos
latência p95 maior que 15 segundos
custo diário de IA maior que R$ 50
mais de 5 falhas no mesmo workflow em 30 minutos
tenant específico teve erro crítico
```

### Canais iniciais

```txt
email
webhook
telegram
discord
whatsapp via integração futura
```

### Governança de dados

O sistema deve evitar armazenar dados sensíveis por padrão.

Campos a mascarar:

```txt
password
token
authorization
cookie
secret
api_key
cpf
credit_card
```

### Retenção inicial sugerida

```txt
eventos: 90 dias
erros: 180 dias
traces: 90 dias
chamadas de IA: 180 dias
logs: 30 dias
agregados: 1 ano ou mais
```

### Resultado esperado

Ao final da Fase 4, o Signal Hub estará pronto para operar múltiplos produtos com segurança, previsibilidade e alertas básicos.

## 6. Plano futuro

As funcionalidades abaixo ficam previstas para evolução futura, depois da consolidação das Fases 1 a 4. Elas não são dependências do MVP, mas devem orientar decisões de arquitetura para evitar retrabalho.

### 6.1 Evals complexos

Avaliação estruturada de respostas e execuções de IA.

Funcionalidades previstas:

```txt
criação de datasets de avaliação
evals por prompt
evals por modelo
evals por workflow
evals automáticos com juiz de IA
evals manuais
comparação entre versões de prompt
comparação entre modelos
score por critério
histórico de qualidade por versão
```

Critérios possíveis:

```txt
correção factual
clareza
completude
aderência ao formato
segurança
utilidade
consistência
custo-benefício
```

### 6.2 Agrupamento inteligente de erros

Agrupamento automático de erros similares.

Funcionalidades previstas:

```txt
fingerprint automático
agrupamento por stack trace
agrupamento por mensagem
agrupamento por origem
agrupamento por release
agrupamento por similaridade semântica
identificação de regressões
identificação de erros recorrentes
sugestão de prioridade
```

### 6.3 Replay de sessão

Reprodução visual da experiência do usuário antes de um erro ou evento relevante.

Funcionalidades previstas:

```txt
gravação de interações
cliques
scroll
navegação
mudanças de rota
eventos de formulário com mascaramento
console logs associados
network events selecionados
replay vinculado a eventos, erros e traces
```

Requisitos importantes:

```txt
mascaramento de dados sensíveis
controle por projeto
controle por ambiente
sampling
retenção curta
exclusão por usuário
```

### 6.4 Source maps bem resolvidos

Melhor leitura de erros frontend em produção.

Funcionalidades previstas:

```txt
upload de source maps por release
associação automática entre erro e release
tradução de stack minificado
visualização de arquivo original
linha e coluna originais
integração com pipeline de deploy
retenção por versão
```

### 6.5 Integrações prontas

Conectores simples para ferramentas, plataformas e ambientes usados nos produtos.

Funcionalidades previstas:

```txt
integração com frontends web
integração com APIs Node.js
integração com APIs Python
integração com workers
integração com workflows
integração com provedores de IA
integração com bancos de dados
integração com webhooks
integração com canais de alerta
```

### 6.6 Alertas avançados

Sistema mais sofisticado de detecção, roteamento e gestão de incidentes.

Funcionalidades previstas:

```txt
alertas por anomalia
alertas por tendência
alertas por comparação histórica
alertas por janela móvel
alertas compostos
alertas por tenant crítico
alertas por usuário VIP
silenciamento temporário
escalação
rotas por severidade
rotas por projeto
histórico de incidentes
```

### 6.7 Permissões enterprise

Controle avançado de acesso para equipes, clientes e operações multi-tenant.

Funcionalidades previstas:

```txt
organizações
workspaces
papéis customizados
permissões por projeto
permissões por tenant
permissões por ambiente
permissões por tela
permissões por ação
auditoria de acesso
logs administrativos
SSO futuro
```

Papéis possíveis:

```txt
owner
admin
developer
analyst
support
viewer
client_viewer
```

### 6.8 Dashboards sofisticados

Criação de painéis customizados e análises mais avançadas.

Funcionalidades previstas:

```txt
dashboard builder
cards customizados
métricas calculadas
filtros globais
filtros por card
gráficos temporais
tabelas dinâmicas
rankings
segmentações
comparações entre períodos
salvamento de views
compartilhamento de dashboards
```

### 6.9 Feature flags robustas

Sistema para ativar, desativar e testar funcionalidades por público, tenant ou contexto.

Funcionalidades previstas:

```txt
criação de flags
flags booleanas
flags multivariadas
ativação por ambiente
ativação por tenant
ativação por usuário
ativação por propriedades
rollout percentual
kill switch
histórico de alterações
SDK com cache
avaliação local quando possível
```

### 6.10 Experimentação A/B

Testes controlados para medir impacto de mudanças de produto, UX, fluxo, modelo ou prompt.

Funcionalidades previstas:

```txt
criação de experimentos
variantes
alocação de usuários
métricas primárias
métricas secundárias
período do experimento
resultado por variante
significância estatística
impacto por segmento
experimentos de prompt
experimentos de modelo
experimentos de interface
```

### 6.11 Cohorts avançados

Segmentação dinâmica de usuários, tenants e sessões.

Funcionalidades previstas:

```txt
cohorts por comportamento
cohorts por evento
cohorts por propriedade
cohorts por frequência
cohorts por recência
cohorts por consumo de IA
cohorts por erro
cohorts por plano
cohorts por tenant
cohorts salvos
cohorts dinâmicos
```

Exemplos:

```txt
usuários que geraram mais de 5 dashboards em 7 dias
tenants com custo de IA acima de R$ 100 no mês
usuários que tiveram erro no onboarding
usuários que usaram uma feature e não retornaram
usuários que completaram um fluxo crítico
```

### 6.12 Retenção avançada

Análises de retorno, engajamento e permanência.

Funcionalidades previstas:

```txt
retenção por evento inicial
retenção por evento de retorno
retenção diária
retenção semanal
retenção mensal
retenção por cohort
retenção por tenant
retenção por feature
retenção por canal de aquisição
curvas de retenção
análise de queda
comparação entre períodos
```

Perguntas que essa área deve responder:

```txt
Quem volta depois de usar uma feature?
Qual feature gera maior retorno?
Qual tenant está perdendo engajamento?
Usuários que usam IA voltam mais?
Qual fluxo aumenta a retenção?
```

## 7. Arquitetura proposta

```txt
Apps Frontend
Backends
Workers
Workflows
Agentes de IA
        |
        v
Signal SDK
        |
        v
Ingestion API
        |
        v
Queue
        |
        v
Workers de processamento
        |
        +--> Banco analítico
        +--> Banco operacional
        +--> Object storage
        |
        v
Query API
        |
        v
Signal Console
        |
        v
Alert Engine
```

## 8. Stack sugerida

```txt
Frontend:
React + Vite
Tailwind
shadcn/ui
TanStack Query
Recharts ou ECharts

Backend:
Node.js
Fastify
Zod
BullMQ
Redis

Banco analítico:
ClickHouse

Banco operacional:
Postgres

Storage:
Cloudflare R2 ou MinIO

Deploy:
Docker Compose na VPS
```

## 9. Entidades principais

```txt
Project
Environment
Tenant
User
Session
Event
Error
Trace
Span
LLMCall
Log
Metric
AlertRule
NotificationChannel
APIKey
```

## 10. Requisitos principais

### P0

```txt
criar projetos
criar API keys
receber eventos
receber erros
receber chamadas de IA
receber traces
armazenar dados
consultar dados
filtrar por projeto
filtrar por ambiente
filtrar por tenant
filtrar por usuário
SDK JS básico
dashboard overview
```

### P1

```txt
timeline por usuário
timeline por sessão
timeline por trace
alertas simples
custo por modelo
custo por prompt
custo por tenant
sanitização de dados
retenção configurável
status de erros
```

### P2

```txt
agregações diárias
webhooks
dashboards customizados simples
comparação de modelos
prompt registry simples
avaliação manual de respostas de IA
exportação de dados
```

### P3

```txt
funcionalidades avançadas previstas no plano futuro
```

## 11. Definição de MVP útil

A menor versão realmente útil do Signal Hub precisa entregar:

```txt
API de ingestão
SDK JS
eventos
erros
chamadas de IA
traces simples
dashboard overview
tela de eventos
tela de erros
tela de traces
tela de IA
filtros por projeto, ambiente, tenant e usuário
```

Com isso, já será possível conectar um produto real e responder:

```txt
O que aconteceu?
Quem foi afetado?
Qual etapa falhou?
Quanto demorou?
Quanto custou?
Qual tenant foi impactado?
Qual usuário teve problema?
```

## 12. Posicionamento final

O Signal Hub deve ser pensado como:

> Uma camada própria de observabilidade unificada para produtos digitais e sistemas com IA, focada em eventos, erros, traces, custos, latência, usuários, tenants e workflows.

A primeira versão deve evitar complexidade desnecessária e focar em uma pergunta central:

> O que aconteceu nesse fluxo e qual foi o impacto técnico, operacional e financeiro?
