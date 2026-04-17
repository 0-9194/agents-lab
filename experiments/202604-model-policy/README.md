# model-policy Extension — Experimento 202604

**Data:** 2026-04-17
**Status:** Em andamento — Fase 0 concluída
**Engine:** Pi + `@ifi/oh-pi-ant-colony` + `@ifi/pi-extension-subagents`

## Objetivo

Implementar uma extensão pi que adiciona políticas declarativas de modelo por objetivo
ao ecossistema pi-stack, cobrindo:

- Mapeamento objetivo → modelo/provider com herança global → projeto
- Injeção automática de `modelOverrides` em `ant_colony` e `subagent`
- Budget guard em runtime com alertas (50/75/90/95%) e gate de decisão interativo
- Benchmark pós-execução com registro histórico em `.jsonl` para análise de degradação
- A/B testing de modelos por role com relatório comparativo automático
- Cost dashboard consolidado
- Smart budget suggestion baseada em histórico
- Export de benchmarks em CSV, Vega-Lite, HTML

## Motivação

Subscription providers (github-copilot, gemini-cli, openai-codex) reportam `cost.total = 0`.
O budget guard nativo do ant-colony não funciona com esses providers. Esta extensão
calcula **custo sintético** via tokens × preço do guia, habilitando rastreamento real
independente do provider.

## Plano de Execução

Ver `plan-v4.md` neste diretório para o plano completo (v4, 1288 linhas, 22 seções).

### Estratégia A — Sequencial por camadas com subagents

```
Fase 0  → Scaffold (types.ts, index.ts esqueleto, model-policy.json template)  ✅ COMPLETO
Fase 1  → P0 Core: config.ts, pricing.ts, injector.ts                          🔄 próxima
Fase 2  → P1 Paralelo: budget-guard.ts ∥ benchmark-recorder.ts
Fase 3  → P1 Sequencial: handoff-doc.ts, smart-budget.ts
Fase 4  → P2 Paralelo: cost-estimator.ts ∥ ab-testing.ts ∥ export.ts
Fase 5  → P2 Sequencial: pre-flight-planner.ts, dashboard, command /model-policy
Fase 6  → Integração + sync fork + documentação
```

## Estrutura de Arquivos

```
packages/pi-stack/extensions/model-policy/
├── types.ts               Todas as interfaces compartilhadas (Fase 0)
├── index.ts               Entry point + esqueleto de hooks (Fase 0)
├── model-policy.template.json  Template de configuração global
├── config.ts              (Fase 1)
├── pricing.ts             (Fase 1)
├── injector.ts            (Fase 1)
├── budget-guard.ts        (Fase 2)
├── benchmark-recorder.ts  (Fase 2)
├── handoff-doc.ts         (Fase 3)
├── smart-budget.ts        (Fase 3)
├── cost-estimator.ts      (Fase 4)
├── ab-testing.ts          (Fase 4)
├── export.ts              (Fase 4)
├── pre-flight-planner.ts  (Fase 5)
└── package.json           Dependências da extensão

experiments/202604-model-policy/
├── README.md              Este arquivo
├── plan-v4.md             Plano completo v4 com 22 seções
├── benchmark-samples/     (a criar) Amostras reais de benchmark
└── validation-notes.md    (a criar) Notas de teste e validação
```

## Descobertas Técnicas

### Custo sintético para subscription providers

Subscription providers reportam `cost.total = 0` mas tokens são precisos.
O pricing.ts calculará:

```
syntheticCost = (input × inputPrice + output × outputPrice
               + cacheRead × cacheReadPrice + cacheWrite × cacheWritePrice) / 1_000_000
```

Preços sourced de `~/.pi/llm-pricing-guide.md` com fallback hardcoded.

### Budget tracking em 3 fases

O `colonyRuntimeId` só existe após `launchBackgroundColony`. Por isso:
1. `tool_call(ant_colony)` → registra `pendingBudget` por `hash(goal)`
2. `message_end(COLONY_SIGNAL:LAUNCHED)` → vincula `runtimeId` ao pending
3. `usage:record` → acumula custo sinteticamente

### A/B testing: split por colony run

O `modelOverrides.worker` aplica-se a **todas** as tasks de uma caste numa colony.
O split é por run (não por task), garantindo comparabilidade estatística.

## Backlog (P3 — pós-MVP)

- Handoff Chain: vincular runs retomadas via cadeia rastreável
- Auto Demotion/Promotion: troca automática de modelo ao detectar degradação
- Budget Guard para Chains de Subagent
- Policy Inheritance entre Projetos (`extends` no model-policy.json)

## Status de Validação

| Componente | Status |
|---|---|
| types.ts compila sem erros | ✅ |
| index.ts esqueleto carrega | ✅ |
| Extensão registrada no pi | ✅ |
| model-policy.json template | ✅ |
| Fase 1 (config/pricing/injector) | 🔄 próxima |
