# Arquitetura

## Monorepo

```
apps/api             FastAPI (Python 3.12, uv) — toda a lógica roda aqui
apps/web             React + TS + Vite + Tailwind + TanStack Query (Skill Studio)
packages/contracts   Contratos compartilhados (JSON Schema + tipos TS; espelho Pydantic na API)
packages/sdk-python  SDK Python (stdlib, Python ≥ 3.8)
unity/               (planejado) Unity 6 WebGL — camada visual opcional
docs/                Arquitetura, especificação de Skills, ADRs
```

## Backend (`apps/api/app/`)

| Módulo | Responsabilidade | Estado |
|---|---|---|
| `llm.py` | `LLMProvider` (Ollama, Fake para testes); modelo via `LLM_MODEL` | implementado |
| `skills/package.py` | formato canônico, regras de caminho e limites | implementado |
| `skills/pipeline.py` | pipeline de 9 estágios persistidos | implementado |
| `skills/validation.py` | validação estática determinística | implementado |
| `skills/sandbox.py` | execução isolada em Docker | implementado |
| `skills/adapters.py` | exportação Claude Code / Codex / Cursor | implementado |
| `skills/storage.py` | arquivos de pacote no filesystem | implementado |
| `api/studio.py` | API do Studio (local-only) | implementado |
| `api/public.py` | API `/v1` com API key | implementado |
| `auth.py` | API keys (hash SHA-256), rate limit, guarda local-only | implementado |
| `models.py` | skills, versões, jobs, validações, exports, keys, execuções, auditoria | implementado |
| `auth` de usuários, `projects`, `agents`, `tools`, `runtime`, `evals`, `events` | | planejado |

## Fluxo do Skill Compiler

```
Web (Skill Studio) ─REST─▶ /studio ─▶ pipeline ─▶ LLMProvider (Ollama)
                                         │
                                         ├─▶ validation (estática, sem executar)
                                         ├─▶ sandbox (docker run --network none …)  ◀─ código gerado roda SÓ aqui
                                         └─▶ storage (STORAGE_DIR) + Postgres (metadados)
                         /studio/export ─▶ ZIP + comandos ─▶ usuário instala em ~/.claude/skills etc.
App externo ─SDK─▶ /v1 (API key, rate limit) ─▶ sandbox (code) | LLM (instructions) ─▶ ExecutionLog
```

## Princípios

- Execução sempre no backend; web (e futuramente Unity) apenas exibem.
- Conteúdo gerado por LLM é **não confiável**: código gerado só é executado dentro do sandbox Docker
  (sem rede, sem mounts, read-only, usuário sem privilégio, limites de CPU/memória/PIDs/tempo). Nunca no processo da API.
  (Alterado do princípio da Fase 0 "nenhum código gerado é executado" — ver ADR 0002.)
- Nada é marcado como verificado sem testes executados no sandbox.
- Avaliações priorizam checagens determinísticas; LLM-judge nunca é a nota final sozinho.
- Contratos compartilhados ficam em `packages/contracts` e têm teste de sincronia nos dois lados.
- Isolamento por usuário/projeto: obrigatório quando contas forem implementadas (ainda não existem).

## Frontend: Agent Studio (2026-11-06)

```
App (nav: Create · Skills · API keys, EN/JA via src/i18n.tsx)
 ├─ AgentStudio      chat request → POST /studio/skills/generate; polls GET /studio/jobs/{id}
 │   ├─ AgentOffice  polls GET /studio/events?run_id=… (persisted AgentEventRow, one per real stage transition);
 │   │               one SVG robot per pipeline role: architect=Planner, coder=Developer, reviewer=Reviewer,
 │   │               tester=Tester, packager=Builder. Planned roles (Researcher, Security) are labelled, never animated.
 │   └─ VersionView  Files · Manifest · Validation (hints, criteria, eval cases, holdout, why the sandbox did not run) · Export
 └─ SkillsPage / ApiKeys
```

Polling of persisted events was chosen over the WebSocket endpoint: it survives reconnects and restarts and needs no
extra state. No 3D library is used; animations respect `prefers-reduced-motion`.
