---
created: 2026-04-13
status: draft
---

# Colony × Monitors — Avaliação Inicial de Interferência

## Pergunta

Monitores do `@davidorex/pi-behavior-monitors` podem atrapalhar a execução da colônia (`@ifi/oh-pi-ant-colony`)?

## Evidência estática (código)

### 1) Dentro dos ants da colônia

No ant-colony, cada ant é criado com `createAgentSession(...)` usando um `ResourceLoader` mínimo:

- `node_modules/@ifi/oh-pi-ant-colony/extensions/ant-colony/spawner.ts`
  - `makeMinimalResourceLoader()` retorna:
    - `getExtensions: () => ({ extensions: [], ... })`
    - `getSkills: () => ({ skills: [], ... })`

Implicação: **ants não carregam extensões/skills de sessão**, incluindo monitores do davidorex.

### 2) No processo principal (queen/main session)

A extensão de monitores do davidorex roda no processo principal e pode atuar em eventos da sessão (`message_end`, `turn_end`, `agent_end`, `tool_call`).

- `node_modules/@davidorex/pi-behavior-monitors/dist/index.js`
  - eventos registrados em `pi.on(...)`
  - coleta de contexto inclui `custom_messages`

Como a colônia injeta mensagens custom (`ant-colony-progress`, `ant-colony-report`) no processo principal, existe risco de **interação indireta** entre monitor de sessão e fluxo da queen.

## Evidência dinâmica (run r1)

Executado A/B em sandbox mínimo:

- relatório: `colony-monitor-interference-run-2026-04-13-r1.md`
- dataset: `docs/research/data/colony-monitor-ab/run-2026-04-13-r1/results.json`

Resultado resumido:

- sucesso 100% nos dois braços
- sem `monitor-steer`/`monitor-pending` no run
- latência média:
  - monitors-on: `312.23s`
  - monitors-off: `160.93s`
  - delta: **+94%** com monitores ON

## Conclusão atual (sobriedade)

- **Não há evidência de mistura dentro dos ants** (soldier/scout/worker/drone).
- **Há evidência de overhead no processo principal** quando monitores gerais estão ON durante execução da colônia.

Decisão provisória para pilot:
- preferir profile **monitors-off during colony**,
- continuar medindo qualidade e latência para decidir coexistência por default.
