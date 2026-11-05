# AI Agent Builder

Plataforma web para criar, configurar, testar, melhorar e integrar agentes de IA em seus próprios apps.
就職作品 — HAL名古屋.

> **Estado atual: Fase 0 (estrutura).** Nenhuma funcionalidade de agente está implementada ainda.
> Existe apenas `GET /health` na API e uma página web que mostra o status dela.

## Estrutura

Ver [docs/architecture.md](docs/architecture.md).

## Requisitos

- Node.js 22+, npm 10+
- [uv](https://docs.astral.sh/uv/) (baixa Python 3.12 automaticamente)
- Docker (para PostgreSQL)

## Rodando localmente

```bash
cp .env.example .env
docker compose up -d db          # PostgreSQL
cd apps/api && uv sync && uv run uvicorn app.main:app --reload   # API em :8000
npm install && npm run dev:web   # Web em :5173 (proxy /api -> :8000)
```

## Testes

```bash
cd apps/api && uv run pytest     # backend
npm test                         # frontend + contracts
```

## Roadmap

0. Estrutura do monorepo ← **atual**
1. Auth, projetos, CRUD de agentes, provider Ollama, executar agente
2. Tool Registry + runtime com allowlist e limites
3. Skill Studio (skills declarativas, testes, aprovação)
4. Deploy: versões publicadas, API keys, `/v1/agents/{id}/run`, SDK TypeScript, app React de exemplo
5. Evaluation Lab
6. Unity WebGL Workspace
