# Unity Workspace (placeholder)

O projeto Unity 6 será criado aqui na fase do Workspace 3D (`unity/AgentWorkspace/`), via Unity Hub.

Regras já definidas:

- Camada **somente visual**: nenhuma lógica de agente roda no Unity.
- Consome `AgentEvent` (ver `packages/contracts/schemas/agent-event.schema.json`) recebidos do backend via WebSocket.
- Cada personagem = um agente real (`agent_id`). Nenhuma animação de "concluído" sem evento `completed` correspondente.
- Build WebGL é embutido no frontend web; o app funciona sem ele.
- Pastas geradas (`Library/`, `Temp/`, `Build/` …) já estão no `.gitignore`.
