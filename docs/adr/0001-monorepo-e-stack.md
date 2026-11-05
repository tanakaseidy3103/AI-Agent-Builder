# ADR 0001 — Monorepo e stack inicial

Data: 2026-11-05 · Status: aceito

## Decisão

- Monorepo com npm workspaces (JS) + `uv` (Python) em `apps/api`. Sem Turborepo/Nx: dois apps não justificam.
- Python 3.12 gerenciado por `uv` (a máquina local tem 3.8, incompatível).
- Contratos: JSON Schema como fonte; tipos TS e modelos Pydantic escritos à mão com teste que verifica sincronia.
  Gerar código a partir do schema fica para quando houver mais contratos.
- A API REST pública será descrita pelo OpenAPI gerado pelo FastAPI (fonte para o SDK).
- PostgreSQL via Docker Compose; migrações com Alembic.
- Tailwind v4 via plugin Vite (sem PostCSS config).

## Consequências

- Dois gerenciadores de pacote (npm e uv) — aceitável, cada um no seu ecossistema.
- Sincronia de contratos depende de testes, não de geração.
