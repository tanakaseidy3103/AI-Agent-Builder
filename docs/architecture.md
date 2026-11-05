# Arquitetura

## Monorepo

```
apps/api            FastAPI (Python 3.12, uv) — toda a lógica de agentes roda aqui
apps/web            React + TS + Vite + Tailwind + TanStack Query
packages/contracts  Contratos compartilhados (JSON Schema + tipos TS; espelho Pydantic na API)
packages/sdk        (Fase 4) SDK TypeScript para apps externos
unity/              (Fase 6) Unity 6 WebGL — camada visual opcional
docs/               Arquitetura e ADRs
```

## Módulos do backend (planejados, como pacotes em `apps/api/app/`)

| Módulo | Responsabilidade | Fase |
|---|---|---|
| `auth` | registro, login, sessões | 1 |
| `projects` | usuários, projetos, autorização por projeto | 1 |
| `agents` | CRUD e versões de agentes | 1 |
| `llm` | interface `LLMProvider`; Ollama primeiro, hospedados opcionais | 1 |
| `tools` | Tool Registry: ferramentas registradas e allowlist por agente | 2 |
| `runtime` | loop de execução, limites, emissão de `AgentEvent` | 2 |
| `skills` | Skill Studio: skills declarativas compostas de tools registradas | 3 |
| `deploy` | versões publicadas, API keys com escopo, `POST /v1/agents/{id}/run` | 4 |
| `gateway` | rate limiting, cota, auditoria das chamadas públicas | 4 |
| `evals` | Evaluation Lab: personas, cenários, checagens determinísticas, regressão | 5 |
| `events` | WebSocket de `AgentEvent` para web e Unity | 6 |

## Fluxo de dados

```
Web UI ──REST──▶ API ──▶ runtime ──▶ llm provider (Ollama)
                  │          └──▶ tools (somente allowlist)
App externo ─SDK─▶ /v1 gateway (API key) ──▶ runtime
                  └── AgentEvent ──WS──▶ Web UI / Unity (só leitura)
```

## Princípios

- Execução sempre no backend; Unity e web apenas exibem.
- Isolamento: todo acesso a dados filtrado por projeto do usuário; testes de isolamento obrigatórios.
- Nenhum código gerado por LLM é executado. Skills = composição declarativa de tools registradas.
- Avaliações priorizam checagens determinísticas; LLM-judge nunca é a nota final sozinho.
- Contratos compartilhados ficam em `packages/contracts` e têm teste de sincronia nos dois lados.
