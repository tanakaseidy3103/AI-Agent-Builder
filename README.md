# AI Agent Builder

Plataforma web para criar, testar, melhorar e integrar capacidades de IA nos seus próprios apps.
就職作品 — HAL名古屋.

## O que funciona hoje

**Skill Compiler** ([docs/skills.md](docs/skills.md)): descrição em linguagem natural → pacote de Skill → validação
estática → testes em sandbox Docker isolado → relatório → exportação ZIP para Claude Code / Codex / Cursor →
execução por API (`/v1`) e SDK Python.

| Parte | Estado |
|---|---|
| Formato de pacote (`SKILL.md` + `manifest.json`) | Implementado e testado |
| Pipeline de 9 estágios persistidos (Ollama) | Implementado e testado; testes com LLM falso + execução real |
| Validação estática + sandbox Docker (sem rede, read-only, limites) | Implementado e testado |
| Status `generated` / `validated` / `verified` | Implementado |
| Exportação ZIP + comandos que não sobrescrevem | Implementado; comando bash testado de verdade |
| API pública `/v1` com API key, rate limit, logs, auditoria | Implementado e testado |
| SDK Python (`packages/sdk-python`) | Implementado; testado contra a API real |
| Skill Studio (web) | Implementado; testes Vitest |
| Contas de usuário, projetos, agentes, Evaluation Lab, Unity, SDK TypeScript | **Planejado** |

Limitação importante: com `llama3.2:3b`, nenhuma de 8 gerações reais de Skills com código passou na validação.
Skills só de instruções funcionam. Para código, configure um modelo mais forte em `LLM_MODEL`.

## Requisitos

- Node.js 22+, npm 10+
- [uv](https://docs.astral.sh/uv/) (baixa Python 3.12 automaticamente)
- Docker Desktop (PostgreSQL e sandbox) · `docker pull python:3.12-slim`
- [Ollama](https://ollama.com) com um modelo (`ollama pull llama3.2:3b`)

## Rodando localmente (modo completo, com sandbox)

```bash
docker compose up -d db                          # PostgreSQL em 127.0.0.1:5433
cd apps/api
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --port 8000          # API no host (precisa do docker CLI para o sandbox)
# outro terminal, na raiz:
npm install
npm run dev:web                                  # http://localhost:5173 (proxy /api -> :8000)
```

Configuração opcional por variáveis de ambiente (veja `.env.example`): `LLM_MODEL`, `OLLAMA_BASE_URL`,
`DATABASE_URL`, `STORAGE_DIR`, `SANDBOX_IMAGE`, `RATE_LIMIT_PER_MINUTE`.

`docker compose up -d` também sobe a API em container, mas nele o sandbox fica **indisponível** de propósito
(sem socket Docker montado). Use um modo por vez (porta 8000).

## Testes

```bash
cd apps/api && uv run pytest                                   # backend (sandbox real se Docker estiver ativo)
npm test && npm run build                                      # web + contracts
cd packages/sdk-python && PYTHONPATH=. uv run --no-project --python 3.12 --with pytest pytest tests
```

## Documentação

- [docs/architecture.md](docs/architecture.md) — arquitetura geral
- [docs/skills.md](docs/skills.md) — formato, pipeline, validação, segurança, instalação, API, SDK, limitações
- [docs/adr/](docs/adr/) — decisões

## Roadmap

0. Estrutura do monorepo — feito
1. **Skill Compiler** — feito (fatia vertical)
2. Auth, projetos, agentes, provider de LLM hospedado
3. Evaluation Lab (personas, asserções determinísticas, regressão)
4. Deploy de agentes, SDK TypeScript, app React de exemplo
5. Unity WebGL Workspace
