# 🏗️ Plano Completo: `model-policy` Extension (v4 — Final + Features)

> **Data:** 2026-04-17
> **Status:** Validado — pronto para implementação
> **Localização:** `~/.pi/agent/extensions/model-policy/`

---

## 1. Visão Geral

Extensão pi que implementa políticas declarativas de modelo por objetivo, com:
- Mapeamento objetivo → modelo/provider (global + projeto)
- Injeção automática de modelOverrides em ant_colony e subagent
- Quality gate e enrichment de goals antes de colony runs
- Estimativa de custo por task baseada em complexidade e modelo
- Alertas de budget em runtime com ações do usuário
- Benchmark pós-execução com registro histórico para análise de degradação
- A/B testing de modelos por role com relatório comparativo
- Cost dashboard consolidado
- Smart budget suggestion para novos projetos
- Export de benchmarks em formatos prontos para plotagem

---

## 2. Descoberta Crítica: Custo Sintético

**Subscription providers (github-copilot, gemini-cli, openai-codex) reportam `cost.total = 0`.**

Tokens são reportados corretamente (`input`, `output`, `cacheRead`, `cacheWrite`),
mas custo é ZERO. O budget guard nativo do ant-colony **não funciona** com esses providers.

**Solução:** A extensão calcula **custo sintético** para TODOS os runs:

```
syntheticCost = (inputTokens × priceInput + outputTokens × priceOutput
               + cacheReadTokens × priceCacheRead + cacheWriteTokens × priceCacheWrite)
               / 1_000_000
```

Preços sourced de `~/.pi/llm-pricing-guide.md` (parseado em `session_start`).
Fallback: preços hardcoded no código como default, atualizados mensalmente via scheduler.

**Implicações:**
- `maxCostUsd` na model-policy funciona SEMPRE, independente do provider
- Benchmark registra **tanto** `reportedCostUsd` (do provider) **quanto** `syntheticCostUsd`
- Alertas de budget usam `syntheticCostUsd` quando `reportedCostUsd = 0`

---

## 3. Arquitetura de Módulos

```
~/.pi/agent/extensions/model-policy/
├── index.ts               Entry point + hooks + comando /model-policy
├── config.ts              Leitura e merge global↔local de model-policy.json
├── pricing.ts             Parser do llm-pricing-guide.md + cálculo de custo sintético
├── injector.ts            tool_call hook: injeta modelOverrides + maxCost
├── pre-flight-planner.ts  Quality gate + goal enrichment (light/full)
├── cost-estimator.ts      Estimativa de custo por task×modelo com calibração histórica
├── budget-guard.ts        Monitora custo via usage:record; alertas + ações
├── handoff-doc.ts         Gera documento de handoff para retomada
└── benchmark-recorder.ts  Captura métricas pós-execução; append em .jsonl
├── ab-testing.ts        A/B testing de modelos por role
├── smart-budget.ts      Sugestão automática de budgets para novos projetos
└── export.ts            Export de benchmarks em CSV, JSON, Vega-Lite, HTML
```

### Dependências entre módulos

```
session_start → config.ts carrega policy
              → pricing.ts parseia guia de preços
              → benchmark-recorder.ts carrega histórico para calibração

tool_call(ant_colony) → injector.ts injeta overrides
                      → pre-flight-planner.ts valida goal (se habilitado)
                      → cost-estimator.ts gera estimativa (se planning.level=full)

pi.events("usage:record") → budget-guard.ts acumula custo sintético
                           → budget-guard.ts dispara alertas em thresholds

colony DONE/FAILED signal → benchmark-recorder.ts coleta e persiste métricas

/budget-gate command → budget-guard.ts abre UI de decisão (ctx.ui.select)
                     → handoff-doc.ts gera handoff se opção "parar e documentar"
```

---

## 4. Schema `model-policy.json`

```jsonc
// ~/.pi/agent/model-policy.json  (GLOBAL)
// .pi/model-policy.json          (PROJETO — overrides por chave)
{
  "version": 1,

  "objectives": {
    // ant_colony — por caste/workerClass
    "swarm:scout":      "google/gemini-2.5-flash-lite",
    "swarm:worker":     "anthropic/claude-sonnet-4.6",
    "swarm:soldier":    "anthropic/claude-haiku-4.5",
    "swarm:design":     "google/gemini-3.1-pro",
    "swarm:backend":    "anthropic/claude-sonnet-4.6",
    "swarm:multimodal": "google/gemini-3.1-pro",
    "swarm:review":     "anthropic/claude-haiku-4.5",

    // subagent — por complexidade
    "subagent:default":  "anthropic/claude-haiku-4.5",
    "subagent:complex":  "anthropic/claude-sonnet-4.6",
    "subagent:analysis": "google/gemini-2.5-pro",

    // sessão interativa
    "agent:default":   "anthropic/claude-sonnet-4.6",
    "agent:cheap":     "anthropic/claude-haiku-4.5",
    "agent:analysis":  "google/gemini-2.5-pro"
  },

  "budgets": {
    "swarm": {
      "maxCostUsd": 2.00,
      "alerts": [50, 75, 90, 95],
      "timeoutOnGateSec": 30,          // timeout do select() em 90%/95%
      "defaultActionOnTimeout": "stop"  // "stop" | "ignore" | "abort"
    },
    "subagent": {
      "maxCostUsd": 0.10,
      "alerts": [50, 75, 90, 95],
      "timeoutOnGateSec": 30,
      "defaultActionOnTimeout": "stop"
    }
  },

  "planning": {
    "enabled": true,
    "level": "light",  // "off" | "light" | "full"
    // light: quality gate do goal + file detection via find/rg
    // full: light + scout seco com preview de tasks e estimativa (opt-in)
    "minTaskCount": 3,
    "requireFilesOnAllTasks": true,
    "requireContextOnWorkers": true,
    "requirePriorityOnAll": true
  },

  "benchmark": {
    "enabled": true,
    "maxEntries": 10000,         // rotação quando exceder
    "inlineReport": true,        // mensagem com resumo após colony done
    "subagentReport": false      // silent para subagents por padrão
  },

  "experiments": {
    // A/B testing — ver seção 16
    // Exemplo:
    // "swarm:worker": {
    //   "enabled": true,
    //   "control": "anthropic/claude-sonnet-4.6",
    //   "variant": "google/gemini-2.5-pro",
    //   "splitPct": 20,
    //   "minSamples": 10
    // }
  }
}
```

**Regra de merge global → projeto:**
- Deep merge por chave individual
- Chave ausente no local → herda global
- Chave presente no local → sobrescreve aquela chave específica
- Arrays (`budgets.swarm.alerts`) são **substituídos inteiramente**, não merged

---

## 5. Módulo `pricing.ts` — Custo Sintético (NOVO)

Responsável por resolver preço por modelo, independente do que o provider reporta.

```typescript
// Fontes de preço (em ordem de prioridade):
// 1. model-policy.json → campo "pricing" (override explícito por modelo)
// 2. ~/.pi/llm-pricing-guide.md → parseado na inicialização
// 3. Hardcoded defaults (fallback de última instância)

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

function calculateSyntheticCost(
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number },
  pricing: ModelPricing
): number {
  return (
    tokens.input * pricing.inputPerMTok +
    tokens.output * pricing.outputPerMTok +
    tokens.cacheRead * pricing.cacheReadPerMTok +
    tokens.cacheWrite * pricing.cacheWritePerMTok
  ) / 1_000_000;
}
```

O parser lê `~/.pi/llm-pricing-guide.md` e extrai tabelas markdown automaticamente.
Se o arquivo não existir ou não for parseável, usa defaults hardcoded.

### Cache pricing derivado

O guia de preços não lista preços de cache por modelo. O pricing.ts deriva automaticamente:

```typescript
// Defaults derivados (configuráveis via model-policy.json → pricing)
cacheReadPerMTok  = inputPerMTok * 0.10   // 90% desconto (padrão Anthropic/Google)
cacheWritePerMTok = inputPerMTok * 1.25   // 25% premium (padrão Anthropic)
```

Override por modelo via model-policy.json:
```jsonc
{
  "pricing": {
    "cacheReadDiscount": 0.90,     // desconto sobre input price (default: 0.90)
    "cacheWriteMultiplier": 1.25,  // multiplicador sobre input price (default: 1.25)
    "overrides": {
      // Override completo para modelo específico ($/MTok)
      "anthropic/claude-sonnet-4.6": {
        "inputPerMTok": 3.00,
        "outputPerMTok": 15.00,
        "cacheReadPerMTok": 0.30,
        "cacheWritePerMTok": 3.75
      }
    }
  }
}
```

---

## 6. Módulo `injector.ts` — Injeção de Model Overrides

Hook: `pi.on("tool_call")`

### ant_colony

```typescript
// Intercepta tool_call de ant_colony
// Injeta APENAS campos não-explícitos (respeita overrides do usuário)
if (event.toolName === "ant_colony") {
  const policy = getResolvedPolicy();

  // Model overrides — só injeta se o usuário não passou explicitamente
  if (!event.input.scoutModel && policy.objectives["swarm:scout"]) {
    event.input.scoutModel = policy.objectives["swarm:scout"];
  }
  if (!event.input.workerModel && policy.objectives["swarm:worker"]) {
    event.input.workerModel = policy.objectives["swarm:worker"];
  }
  // ... idem para soldier, design, backend, multimodal, review

  // maxCost — só injeta se não foi passado e policy define
  if (event.input.maxCost == null && policy.budgets.swarm?.maxCostUsd) {
    event.input.maxCost = policy.budgets.swarm.maxCostUsd;
  }
}
```

### subagent

```typescript
if (event.toolName === "subagent") {
  const policy = getResolvedPolicy();

  // Modelo default para subagent single (se não especificado)
  if (!event.input.model && policy.objectives["subagent:default"]) {
    event.input.model = policy.objectives["subagent:default"];
  }

  // Para tasks em parallel/chain, injetar model em cada task se ausente
  if (event.input.tasks) {
    for (const task of event.input.tasks) {
      if (!task.model) task.model = policy.objectives["subagent:default"];
    }
  }
}
```

---

## 7. Módulo `pre-flight-planner.ts` — Quality Gate

Hook: `pi.on("tool_call")` (antes do injector, ou encadeado)

### Nível `light` (default ON)

```
tool_call(ant_colony) interceptado
  │
  ├─ 1. GOAL QUALITY GATE
  │     Verifica se goal contém:
  │     ✓ Pelo menos 1 frase com objetivo claro
  │     ✓ Pelo menos 20 palavras (goals < 20 palavras são vagos)
  │     Se falhar → ctx.ui.confirm("Goal parece incompleto. Prosseguir?")
  │
  └─ 2. GOAL ENRICHMENT (append ao goal, não substitui)
        Executa via pi.exec():
        - `find . -name "*.ts" -o -name "*.py" | head -20` → detecta framework
        - `rg -l "<keywords do goal>" --max-count=5` → arquivos relevantes
        Injeta bloco:
        "## Contexto de codebase (auto-detectado)
         - Arquivos potencialmente relevantes: [lista]
         - Linguagem dominante: TypeScript
         - Framework detectado: NestJS (baseado em package.json)"
```

### Nível `full` (opt-in via config ou `/model-policy estimate <goal>`)

```
light +
  │
  └─ 3. PLAN PREVIEW
        Apresenta estimativa de custo ANTES de lançar a colony:
        "📊 Estimativa (baseada em histórico + heurísticas)
         Tasks estimadas: ~15-18
         Custo estimado: $0.85 - $1.40 (42-70% do budget $2.00)
         Confirmar lançamento? [S/n]"
```

A estimativa no nível `full` NÃO executa scout seco.
Usa dados históricos do benchmark (se ≥5 runs) para projetar baseado em:
- Tamanho do goal (palavras/chars) → correlacionar com tasksTotal histórico
- Modelos configurados na policy → custo médio por task do benchmark

Se não há histórico suficiente → usa heurísticas puras com aviso de baixa confiança.

---

## 8. Módulo `cost-estimator.ts` — Estimativa por Task

Chamado em dois momentos:
1. **Pré-colony (full mode):** Estima custo total baseado no goal
2. **Pós-scout (runtime):** Estima custo real baseado nas tasks descobertas

### Estimativa pós-scout (alta precisão)

Fonte: leitura do `state.json` no disco após fase `scouting` concluir.

```typescript
function estimateTaskCost(task: Task, model: string, pricing: ModelPricing): TaskEstimate {
  // Calibração histórica (se disponível)
  const role = resolveRole(task);  // "scout" | "worker:backend" | "worker:design" | "soldier" | "drone"
  const historical = getHistoricalAvg(role, model);

  if (historical && historical.samples >= 5) {
    // Dados reais do benchmark — alta confiança
    return {
      costUsd: historical.costPerTask,
      inputTokens: historical.inputPerTask,
      outputTokens: historical.outputPerTask,
      contextPct: historical.inputPerTask / getContextWindow(model) * 100,
      confidence: "high",
      method: "historical",
      samples: historical.samples
    };
  }

  // Heurísticas — baixa confiança
  const baseInput = task.files.length * 500          // tokens por arquivo
    + (task.context?.length ?? 0) / 4                // context pré-carregado
    + task.description.length * 2                     // overhead do prompt
    + 2000;                                           // system prompt base

  const baseOutput = task.caste === "soldier" ? 800
    : task.caste === "drone" ? 100
    : 2000;

  const multiplier = task.workerClass === "design" || task.workerClass === "multimodal" ? 1.5
    : task.caste === "soldier" ? 0.6
    : task.caste === "drone" ? 0.1
    : task.priority === 1 ? 1.2
    : 1.0;

  const inputTokens = Math.round(baseInput * multiplier);
  const outputTokens = Math.round(baseOutput * multiplier);

  return {
    costUsd: calculateSyntheticCost({ input: inputTokens, output: outputTokens, cacheRead: 0, cacheWrite: 0 }, pricing),
    inputTokens,
    outputTokens,
    contextPct: inputTokens / getContextWindow(model) * 100,
    confidence: "low",
    method: "heuristic",
    samples: 0
  };
}
```

### Feedback loop com benchmark

Após cada colony run, o benchmark-recorder persiste métricas reais por role+model.
Na próxima estimativa, o cost-estimator consulta esse histórico.

```
Run 1-4:  método=heuristic, confiança=low, margem de erro ±40%
Run 5+:   método=historical, confiança=high, margem de erro ±15% (medida real)
Run 20+:  tendência estatística disponível, detecta degradação
```

---

## 9. Módulo `budget-guard.ts` — Alertas em Runtime

### Fonte de dados e ciclo de vida (3 fases)

O colonyRuntimeId só existe APÓS launchBackgroundColony — que executa depois
do tool_call retornar. Por isso o tracking opera em 3 fases:

```typescript
// ═══ Estado em memória ═══
const pendingBudgets = new Map<string, { maxCostUsd: number; goalHash: string; createdAt: number }>();
const colonyBudgets = new Map<string, {
  colonyId: string;
  runtimeId: string;
  syntheticCostUsd: number;      // calculado via pricing.ts
  reportedCostUsd: number;       // do provider (pode ser 0)
  maxCostUsd: number;            // da policy
  alertsFired: Set<number>;      // thresholds já disparados: 50, 75, 90, 95
  gateInProgress: boolean;       // flag anti-race-condition: bloqueia re-disparo
  tasksTotal: number;
  tasksDone: number;
}>();

// ═══ FASE 1: tool_call(ant_colony) — registra budget pendente ═══
// O injector.ts já injetou maxCost. O budget-guard salva uma entry pendente
// indexada por hash(goal) + timestamp, aguardando o LAUNCHED signal.
pi.on("tool_call", (event) => {
  if (event.toolName !== "ant_colony") return;
  const goalHash = hashGoal(event.input.goal);
  pendingBudgets.set(goalHash, {
    maxCostUsd: event.input.maxCost ?? Infinity,
    goalHash,
    createdAt: Date.now(),
  });
});

// ═══ FASE 2: message_end(COLONY_SIGNAL:LAUNCHED) — vincula runtimeId ═══
// Parseia o runtimeId do texto "[COLONY_SIGNAL:LAUNCHED] [c1]" e cria
// a entry definitiva no colonyBudgets, vinculando ao pending.
pi.on("message_end", (event) => {
  const text = extractText(event.message);
  const launched = parseLaunchedSignal(text); // { runtimeId, goal }
  if (!launched) return;

  // Vincular ao pending mais recente por goalHash
  const goalHash = hashGoal(launched.goal);
  const pending = pendingBudgets.get(goalHash);
  if (!pending) return;
  pendingBudgets.delete(goalHash);

  colonyBudgets.set(launched.runtimeId, {
    colonyId: launched.runtimeId,
    runtimeId: launched.runtimeId,
    syntheticCostUsd: 0,
    reportedCostUsd: 0,
    maxCostUsd: pending.maxCostUsd,
    alertsFired: new Set(),
    gateInProgress: false,
    tasksTotal: 0,
    tasksDone: 0,
  });
});

// ═══ FASE 3: usage:record — acumula custo em tempo real ═══
pi.events.on("usage:record", (data) => {
  if (data.source !== "ant-colony") return;

  const budget = colonyBudgets.get(data.colonyRuntimeId);
  if (!budget || budget.gateInProgress) return;

  const synCost = calculateSyntheticCost(data.usage, getPricing(data.model));
  budget.syntheticCostUsd += synCost;
  budget.reportedCostUsd += data.usage.costTotal;

  const effectiveCost = budget.reportedCostUsd > 0
    ? budget.reportedCostUsd
    : budget.syntheticCostUsd;

  const pct = (effectiveCost / budget.maxCostUsd) * 100;
  checkThresholds(budget, pct);
});
```

### Fluxo de alertas

```
50% → pi.sendMessage(display:true, deliverAs:"followUp", triggerTurn:false)
      "[⚠️ Budget 50%] Colony c1: $1.00 / $2.00 (sintético) | 8/20 tasks (40%)"

75% → pi.sendMessage(display:true, deliverAs:"followUp", triggerTurn:false)
      "[⚠️ Budget 75%] Colony c1: $1.50 / $2.00 | 13/20 tasks (65%)
       Estimativa para completar: +$0.68 → projeção $2.18 (9% acima do budget)"

90% → ETAPA 1: /colony-stop <id> via pi.sendUserMessage(deliverAs:"steer")
               (steer é entregue após current turn, mais rápido que followUp)
      ETAPA 2: pi.sendMessage(deliverAs:"followUp", triggerTurn:true)
               "[🛑 Budget 90%] Colony c1 PAUSADA. Aguardando decisão..."
      ETAPA 3: LLM vê mensagem → chama tool model_policy_budget_decision
      ETAPA 4: Dentro da tool → ctx.ui.select() (bloqueante, com timeout 30s)

      ┌─────────────────────────────────────────────────────────┐
      │ 🛑 Budget 90% — Colony c1 PAUSADA                       │
      │                                                         │
      │ Consumido: $1.80 / $2.00 (90%) [custo sintético]        │
      │ Progresso: 16/20 tasks (80%)                            │
      │                                                         │
      │ Tasks pendentes: 4                                      │
      │   worker:sonnet    ×2  → ~$0.28  (18% ctx)             │
      │   soldier:haiku    ×1  → ~$0.03  (8% ctx)              │
      │   worker:design    ×1  → ~$0.18  (14% ctx)             │
      │   Total adicional estimado: +$0.49                      │
      │                                                         │
      │ ► 1. Ignorar — continuar além do budget                 │
      │   2. Aumentar budget para $2.49 (+$0.49)                │
      │   3. Parar e documentar progresso (gerar handoff.md)    │
      │   4. Abortar (descartar trabalho pendente)              │
      │                                                         │
      │ Auto: "parar e documentar" em 30s                       │
      └─────────────────────────────────────────────────────────┘

      Opção 1: Edita state.json (status→"working") + /colony-resume
      Opção 2: Edita state.json atomicamente (read→modify→write .tmp→rename)
               (maxCost→2.49, status→"working") + /colony-resume
      Opção 3: Gera handoff.md via handoff-doc.ts + notifica
      Opção 4: Estado já é aborted (sem resume)

95% → Se usuário escolheu "ignorar" no 90% e colony continuou:
      Mesmo fluxo, MAS sem opção 1 (forçar decisão)
      Timeout → "parar e documentar" automático
```

### Tool `model_policy_budget_decision`

```typescript
pi.registerTool({
  name: "model_policy_budget_decision",
  description: "Budget gate triggered — present decision to user",
  parameters: Type.Object({
    colonyId: Type.String(),
    pctUsed: Type.Number(),
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const budget = colonyBudgets.get(params.colonyId);
    // ... build summary from budget + tasks pendentes
    const choice = await ctx.ui.select(
      `🛑 Budget ${params.pctUsed}% — Colony ${params.colonyId}`,
      options,
      { timeout: budget.timeoutOnGateSec * 1000 }
    );
    // ... executar ação baseada em choice
  }
});
```

---

## 10. Módulo `handoff-doc.ts` — Documento de Retomada

Gerado quando opção 3 ("parar e documentar") é selecionada.

```markdown
# Handoff: <goal resumido>

**Gerado:** 2026-04-17T14:32:00Z
**Colony:** colony-abc123
**Budget consumido:** $1.82 / $2.00 (91%) [custo sintético]
**Budget reportado pelo provider:** $0.00 (subscription)
**Progresso:** 16/20 tasks (80%)
**Motivo de parada:** Budget 90% — decisão do usuário

## Objetivo original
<goal completo incluindo enrichment>

## Tasks concluídas (16)
| # | Task | Caste | Model | Custo | Duração |
|---|------|-------|-------|-------|---------|
| 1 | Analisar estrutura auth | scout | gemini-flash-lite | $0.002 | 6.2s |
| 2 | Refatorar AuthProvider | worker:backend | sonnet-4.6 | $0.09 | 12.3s |
...

## Tasks pendentes (4)
| # | Task | Caste | Prioridade | Arquivos | Custo estimado |
|---|------|-------|-----------|----------|---------------|
| 17 | Atualizar testes de integração | worker | 1 | src/auth/**/*.spec.ts | ~$0.15 |
| 18 | Review security do módulo auth | soldier | 2 | src/auth/* | ~$0.03 |
...

## Estimativa para completar
- Total adicional: ~$0.49 (método: historical, 23 samples)
- Budget adicional sugerido: $0.60 (+20% margem)
- Contexto máximo estimado por task: 22% (worker:backend via sonnet-4.6)

## Descobertas relevantes (pheromones)
<últimas pheromones tipo "discovery" e "warning">

## Como retomar
```bash
# Opção A: via /colony-resume (state.json deve ter status != "budget_exceeded")
/colony-resume colony-abc123

# Opção B: via novo ant_colony com contexto
ant_colony com goal: "Continuar: [ver seção 'Tasks pendentes' acima]"
```

Recomendações:
- Budget adicional sugerido: $0.60
- Considere modelo mais barato para tasks restantes: swarm:worker=haiku-4.5
- Prioridade 1: "Atualizar testes de integração"
```

**Localização do arquivo:** `.pi/handoffs/handoff-<colonyId>-<timestamp>.md` (projeto local)

---

## 11. Módulo `benchmark-recorder.ts` — Métricas Pós-Execução

### Trigger

- Colony: signal terminal (`done`, `failed`, `budget_exceeded`, `aborted`)
  → lê `state.json` do disco + acumulador do budget-guard
- Subagent: `tool_result` com `event.details.usage`

### Schema do registro (.jsonl)

```jsonc
// ~/.pi/model-policy-benchmarks.jsonl (append-only, 1 linha por run)
{
  "schemaVersion": 2,
  "recordedAt": "2026-04-17T14:32:00.000Z",
  "runType": "colony",
  "runId": "colony-abc123",
  "sessionFile": "...",
  "projectCwd": "/home/giga/dev/pessoal/potlabs/potlabs-deception",
  "goal": "Refatorar módulo auth para JWT (primeiros 200 chars)",

  // Configuração aplicada
  "policy": {
    "source": "merged",     // "global" | "project" | "merged"
    "objectives": { "swarm:scout": "...", "swarm:worker": "...", ... },
    "budgetConfiguredUsd": 2.00
  },

  // Resultado
  "outcome": "done",
  "durationMs": 184200,
  "reportedCostUsd": 0.00,        // do provider (0 = subscription)
  "syntheticCostUsd": 1.13,       // calculado via pricing.ts
  "effectiveCostUsd": 1.13,       // max(reported, synthetic)
  "budgetConsumedPct": 56.5,
  "estimatedCostUsd": 1.18,       // pre-flight estimate (se disponível)
  "estimateAccuracyPct": 95.8,
  "estimateMethod": "historical",  // "historical" | "heuristic"
  "estimateSamples": 23,

  // Tasks
  "tasks": {
    "total": 20, "done": 20, "failed": 0, "subTasksSpawned": 3
  },

  // Tokens
  "tokens": {
    "inputTotal": 284000, "outputTotal": 97000,
    "cacheReadTotal": 42000, "cacheWriteTotal": 18000, "totalTokens": 441000
  },

  // Throughput
  "throughput": {
    "tasksPerMinute": 6.5, "tasksPerMinutePeak": 9.2, "tokensPerSecond": 2068
  },

  // Breakdown por role
  "byRole": [
    {
      "role": "scout",
      "model": "google/gemini-2.5-flash-lite",
      "provider": "google",
      "tasksExecuted": 2,
      "durationMsTotal": 12400, "durationMsAvg": 6200,
      "inputTokens": 18000, "outputTokens": 9200, "cacheReadTokens": 4100,
      "reportedCostUsd": 0.00,
      "syntheticCostUsd": 0.004,
      "costPerTask": 0.002,
      "failureRate": 0.0,
      "escalations": 0,
      "contextPctAvg": 2.1
    }
    // ... outros roles
  ],

  // Alertas disparados
  "budgetAlerts": [
    { "thresholdPct": 50, "triggeredAt": "...", "action": "info" },
    { "thresholdPct": 90, "triggeredAt": "...", "action": "increase_budget",
      "budgetBefore": 2.00, "budgetAfter": 2.50 }
  ],

  // Qualidade do planejamento
  "planning": {
    "level": "light",
    "goalEnriched": true,
    "qualityGatePassed": true,
    "tasksAtPlanTime": null,        // null se level != "full"
    "tasksActual": 20
  },

  // Routing telemetry (do ColonyMetrics)
  "routing": {
    "escalations": 0,
    "avgLatencyMsByRole": { "scout": 6200, "worker:backend": 12300 }
  },

  // Experimento A/B (se ativo durante este run)
  "experiment": null,              // null se nenhum experimento ativo
  // Quando ativo:
  // "experiment": {
  //   "role": "swarm:worker",
  //   "group": "variant",         // "control" | "variant"
  //   "experimentId": "swarm:worker-2026-04-17",
  //   "controlModel": "anthropic/claude-sonnet-4.6",
  //   "variantModel": "google/gemini-2.5-pro"
  // },

  // Ambiente
  "env": {
    "piVersion": "0.67.6",
    "maxAnts": 4,
    "workspaceMode": "worktree",
    "providerType": "subscription"  // "subscription" | "api-key"
  }
}
```

### Rotação do arquivo

```
~/.pi/model-policy-benchmarks.jsonl           ← ativo
~/.pi/model-policy-benchmarks-2025.jsonl      ← arquivo de anos anteriores

Rotação quando lineCount > maxEntries (default 10000)
Renomeia ativo → ativo-YYYY.jsonl, cria novo ativo
```

### Mensagem inline pós-colony

```
📊 Benchmark — colony-abc123
──────────────────────────────────────────────
Outcome: ✅ done  |  Duração: 3m04s  |  Tasks: 20/20
Custo sintético: $1.13  |  Provider: $0.00 (subscription)
Estimativa: $1.18 (96% acurado, método: historical, 23 amostras)
Tokens: 441K  |  Throughput: 6.5 tasks/min

Por modelo:
  gemini-2.5-flash-lite (scout)     $0.004  |  2 tasks  |  6.2s/task  |  2% ctx
  claude-sonnet-4.6 (worker)        $0.720  |  8 tasks  |  12.3s/task |  18% ctx
  gemini-3.1-pro (design)           $0.280  |  2 tasks  |  18.1s/task |  12% ctx
  claude-haiku-4.5 (soldier)        $0.090  |  3 tasks  |  4.8s/task  |  8% ctx

Registro salvo: ~/.pi/model-policy-benchmarks.jsonl
```

---

## 12. Comando `/model-policy`

```
/model-policy                         → policy resolvida (global+local+origem)
/model-policy edit [global|project]   → abre model-policy.json no editor
/model-policy test swarm              → simula injeção de modelos para colony
/model-policy estimate <goal>         → estimativa sem lançar (level=full)
/model-policy set <key> <value>       → edita chave no projeto (.pi/model-policy.json)
/model-policy benchmark               → resumo últimos 10 runs
/model-policy benchmark --role worker  → filtrado por role
/model-policy benchmark --model <m>    → filtrado por modelo
/model-policy benchmark --weeks 4      → janela temporal
/model-policy benchmark --csv          → export CSV para análise externa
/model-policy pricing                  → mostra tabela de preços carregada
/model-policy pricing refresh          → re-parseia llm-pricing-guide.md
/model-policy dashboard               → cost dashboard consolidado (30d default)
/model-policy dashboard --weeks 8     → janela customizada
/model-policy init                    → smart budget suggestion para novo projeto
/model-policy experiment status       → mostra A/B tests ativos
/model-policy experiment start <role> → wizard para configurar novo teste
/model-policy experiment stop <role>  → encerra teste e mostra relatório
/model-policy benchmark --vega-lite   → export spec Vega-Lite
/model-policy benchmark --html        → export HTML standalone com charts
```

---

## 13. Delimitação de Escopo

### O que `model-policy` faz vs tooling existente

| Responsabilidade | `model-policy` | `quota-visibility` |
|---|---|---|
| Budget por provider (mensal/semanal) | ❌ | ✅ |
| Budget por run individual (colony/subagent) | ✅ | ❌ |
| Mapeamento objetivo → modelo | ✅ | ❌ |
| Custo sintético para subscription providers | ✅ | ❌ |
| Benchmark histórico e degradação | ✅ | ❌ |
| Rate limit tracking | ❌ | ✅ |
| Handoff automático de provider | ❌ | ✅ (handoff-advisor) |

### O que está fora de escopo

| Item | Motivo |
|---|---|
| Troca automática de modelo na sessão interativa por conteúdo do prompt | Muito invasivo |
| Integração com providerBudgets do quota-visibility | Escopo diferente |
| Scout seco automático (level=full por default) | Custo duplicado |
| Budget guard para sessão interativa (não colony/subagent) | Overhead sem valor claro |
| UI TUI customizada (widgets/painéis) | Desnecessário — comandos e mensagens suficientes |

---

## 14. Análises habilitadas pelo benchmark

### Degradação de modelo

```python
# Custo por task crescente ao longo do tempo = degradação de eficiência
df = pd.read_json("benchmarks.jsonl", lines=True)
roles = pd.json_normalize(df.explode("byRole")["byRole"])
roles.groupby(["model", pd.Grouper(key="recordedAt", freq="W")])["costPerTask"].mean().plot()
```

### Coerência do mapeamento

```python
# Failure rate por role+modelo — identifica modelos inadequados
roles.groupby(["role", "model"])["failureRate"].agg(["mean", "count"]).sort_values("mean", ascending=False)
```

### Acurácia do estimador

```python
# Drift da estimativa — valida calibração
df[["recordedAt","estimateAccuracyPct","estimateMethod"]].plot(x="recordedAt", y="estimateAccuracyPct", color="estimateMethod")
```

### Custo efetivo vs reportado (subscription audit)

```python
# Quanto subscription providers "custam" realmente
df[["recordedAt","reportedCostUsd","syntheticCostUsd"]].plot()

---

## 15. Feature: Smart Budget Suggestion (P1)

Modulo: `smart-budget.ts`

Quando um novo projeto e configurado ou quando o usuario executa `/model-policy init`,
a extensao sugere budgets baseados no historico de benchmarks existente.

### Trigger

- Comando `/model-policy init` (explicito)
- Primeiro `tool_call(ant_colony)` em projeto sem `.pi/model-policy.json` (automatico)

### Logica

```typescript
function suggestBudgets(benchmarks: BenchmarkRecord[]): BudgetSuggestion {
  const colonyRuns = benchmarks.filter(b => b.runType === "colony");
  const subagentRuns = benchmarks.filter(b => b.runType === "subagent");

  const colonyStats = computeStats(colonyRuns.map(r => r.effectiveCostUsd));
  const subagentStats = computeStats(subagentRuns.map(r => r.effectiveCostUsd));

  return {
    swarm: {
      maxCostUsd: roundUp(colonyStats.p90, 0.50),    // P90 arredondado pra cima
      reasoning: `Cobre 90% dos runs (n=${colonyRuns.length}, media=$${colonyStats.mean}, P90=$${colonyStats.p90})`,
    },
    subagent: {
      maxCostUsd: roundUp(subagentStats.p99, 0.05),  // P99 para subagent (mais tolerante)
      reasoning: `Cobre 99% dos runs (n=${subagentRuns.length}, media=$${subagentStats.mean})`,
    }
  };
}
```

### Output

```
/model-policy init

Sugestao de budget baseada no historico (38 colony + 142 subagent runs):

  swarm.maxCostUsd = $2.00
  -- Cobre 90% dos runs (media: $1.13, P90: $1.82, max: $3.41)

  subagent.maxCostUsd = $0.10
  -- Cobre 99% dos runs (media: $0.038, P90: $0.072, max: $0.18)

  Modelos sugeridos (baseado em menor custo com failRate < 5%):
    swarm:scout   -> google/gemini-2.5-flash-lite ($0.002/task, 0% fail)
    swarm:worker  -> anthropic/claude-sonnet-4.6  ($0.091/task, 1% fail)
    swarm:soldier -> anthropic/claude-haiku-4.5   ($0.031/task, 0% fail)

Gerar .pi/model-policy.json com estas sugestoes? [S/n]
```

Se nao ha historico (primeiro uso), usa defaults do guia de precos com aviso:
```
Sem historico de benchmark — usando defaults recomendados do guia de precos.
Estes valores serao refinados automaticamente apos 5+ colony runs.
```

### Integracao com config.ts

Quando o usuario confirma, `smart-budget.ts` chama `config.writeProjectPolicy(suggestion)` que cria
o `.pi/model-policy.json` com os valores sugeridos.

---

## 16. Feature: Model A/B Testing (P2)

Modulo: `ab-testing.ts`

Permite rodar modelos alternativos em paralelo para comparacao data-driven.

### Schema (adicao ao model-policy.json)

```jsonc
{
  "experiments": {
    "swarm:worker": {
      "enabled": true,
      "control": "anthropic/claude-sonnet-4.6",
      "variant": "google/gemini-2.5-pro",
      "splitPct": 20,          // % de tasks que usam variant
      "minSamples": 10,        // minimo de amostras antes de gerar relatorio
      "startedAt": "2026-04-17T00:00:00Z"
    }
  }
}
```

### Funcionamento

1. **Injecao via injector.ts:** O split ocorre **por colony run** (nao por task individual).
   Quando uma colony e lancada e ha experimento ativo para um role, o injector sorteia
   qual modelo sera usado para TODAS as tasks daquela caste neste run:
   ```typescript
   // Decisao tomada uma vez por colony run, no tool_call(ant_colony)
   if (experiment.enabled && Math.random() * 100 < experiment.splitPct) {
     modelOverride = experiment.variant;
     markAsExperiment(colonyId, role, "variant");
   } else {
     modelOverride = experiment.control;
     markAsExperiment(colonyId, role, "control");
   }
   // Nota: para castes (scout/worker/soldier), o modelo se aplica a TODAS
   // as tasks da caste. Split por task individual e possivel para workerClass
   // (design/backend/multimodal) mas adiado para pos-MVP por complexidade.
   ```

2. **Registro no benchmark:** O benchmark-recorder adiciona campo `experimentGroup` em `byRole[]`:
   ```jsonc
   {
     "role": "worker:backend",
     "model": "google/gemini-2.5-pro",
     "experimentGroup": "variant",   // "control" | "variant" | null
   }
   ```

3. **Relatorio automatico:** Quando `minSamples` e atingido para ambos os grupos, gera relatorio
   na proxima colony completion:

```
A/B Test Concluido: swarm:worker (10+ amostras por grupo)
----------------------------------------------------------
                        Control               Variant
  Modelo:               sonnet-4.6            gemini-2.5-pro
  Amostras:             23 tasks              8 tasks
  Custo/task:           $0.091 +/- $0.018     $0.062 +/- $0.021
  Latencia/task:        12.3s +/- 2.1s        14.8s +/- 3.4s
  Failure rate:         0.0%                  5.0%
  Tokens/task:          28.4K                 31.2K
  Context % medio:      18%                   22%
----------------------------------------------------------
  Custo:    -32% (variant mais barato)
  Latencia: +20% (variant mais lento)
  Falhas:   +5pp (variant menos confiavel)

  Recomendacao: MANTER CONTROL (sonnet-4.6)
  Motivo: variant tem failure rate > 0 e latencia superior.
          Economia de 32% nao compensa perda de confiabilidade.

  Desativar experimento? [S/n]
```

### Criterio de recomendacao automatica

```typescript
function recommend(control: Stats, variant: Stats): "control" | "variant" | "inconclusive" {
  const costBetter = variant.costPerTask < control.costPerTask * 0.85;     // >=15% mais barato
  const latencyWorse = variant.durationMsAvg > control.durationMsAvg * 1.3; // <=30% mais lento
  const failWorse = variant.failureRate > control.failureRate + 0.03;       // <=3pp mais falhas

  if (failWorse) return "control";                     // confiabilidade e P0
  if (costBetter && !latencyWorse) return "variant";   // mais barato sem degradar
  if (latencyWorse && !costBetter) return "control";   // mais lento sem ser mais barato
  return "inconclusive";                               // pedir mais dados
}
```

---

## 17. Feature: Cost Dashboard (P2)

Adicao ao comando `/model-policy dashboard` — sumario visual consolidado.

### Output

```
Model Policy Dashboard (ultimos 30 dias)
================================================================

Custo acumulado:
  Total sintetico: $14.82 (38 colony + 142 subagent runs)
  Por provider: Anthropic $9.20 | Google $4.80 | OpenAI $0.82
  Provider reportado: $0.00 (100% subscription)

Performance por role:
  Role            Modelo              $/task  Latencia  Fail  Status
  scout           gemini-flash-lite   $0.002  5.9s      0%    OK
  worker:backend  sonnet-4.6          $0.091  12.3s     1%    OK
  worker:design   gemini-3.1-pro      $0.142  18.1s     3%    WARN
  soldier         haiku-4.5           $0.031  4.8s      0%    OK
  subagent        haiku-4.5           $0.038  8.2s      2%    OK

Tendencias (vs periodo anterior):
  Custo medio/colony: $1.13 (estavel)
  Estimador: 91.3% acuracia (+2.1pp)
  Throughput: 6.5 tasks/min (+0.3)
  Degradacao detectada: worker:design +12% custo (monitorar)

Experimentos ativos:
  swarm:worker: sonnet-4.6 vs gemini-pro (8/10 amostras variant)

Policy ativa:
  Fonte: merged (global + potlabs-deception)
  Budget swarm: $2.00 | subagent: $0.10
  Planning: light | Benchmark: ON

Budget gates disparados: 3 (2x increase, 1x stop)
================================================================
```

### Indicadores de status

- OK = failRate < 3% E custo estavel (variacao < 15% vs periodo anterior)
- WARN = failRate 3-10% OU custo crescente (>15% vs anterior)
- FAIL = failRate > 10% OU custo crescente > 30%

Deteccao de degradacao: compara media movel das ultimas 2 semanas vs 2 semanas anteriores.

---

## 18. Feature: Export para Plotagem (P2)

Adicao ao comando `/model-policy benchmark`.

### Formatos suportados

```
/model-policy benchmark --csv           -> CSV flat para pandas/Excel
/model-policy benchmark --json-flat     -> JSON sem nesting para jq
/model-policy benchmark --vega-lite     -> spec Vega-Lite com dados inline
/model-policy benchmark --html          -> HTML standalone com charts Vega-Lite
```

### CSV flat

Desnormaliza `byRole[]` em linhas individuais:

```csv
recordedAt,runType,runId,outcome,durationMs,effectiveCostUsd,role,model,provider,tasksExecuted,costPerTask,durationMsAvg,failureRate,contextPctAvg,experimentGroup
2026-04-17T14:32:00Z,colony,colony-abc123,done,184200,1.13,scout,gemini-2.5-flash-lite,google,2,0.002,6200,0.0,2.1,
2026-04-17T14:32:00Z,colony,colony-abc123,done,184200,1.13,worker:backend,claude-sonnet-4.6,anthropic,8,0.09,12300,0.0,18.0,control
```

### Vega-Lite spec

Gerado automaticamente com 4 charts pre-configurados:

```jsonc
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "vconcat": [
    {
      "title": "Custo por task ao longo do tempo (por modelo)",
      "mark": "line",
      "encoding": {
        "x": { "field": "recordedAt", "type": "temporal" },
        "y": { "field": "costPerTask", "type": "quantitative" },
        "color": { "field": "model", "type": "nominal" },
        "strokeDash": { "field": "experimentGroup", "type": "nominal" }
      }
    },
    {
      "title": "Latencia media por role",
      "mark": "bar",
      "encoding": {
        "x": { "field": "role", "type": "nominal" },
        "y": { "field": "durationMsAvg", "type": "quantitative" },
        "color": { "field": "model", "type": "nominal" }
      }
    },
    {
      "title": "Failure rate por modelo",
      "mark": "bar",
      "encoding": {
        "x": { "field": "model", "type": "nominal" },
        "y": { "field": "failureRate", "type": "quantitative" },
        "color": { "field": "role", "type": "nominal" }
      }
    },
    {
      "title": "Acuracia do estimador",
      "mark": "point",
      "encoding": {
        "x": { "field": "estimatedCostUsd", "type": "quantitative" },
        "y": { "field": "effectiveCostUsd", "type": "quantitative" }
      }
    }
  ],
  "data": { "values": [] }  // populated at export time
}
```

### HTML standalone

Gera HTML que embute Vega-Lite via CDN + dados inline, abrivel em qualquer browser:

```
/model-policy benchmark --html

Exportado: .pi/exports/benchmark-report-2026-04-17.html
```

Localizacao dos exports: `.pi/exports/` (projeto local) ou `~/.pi/exports/` (global)

---

## 19. Memoria Global Atualizada

Adicionar ao `~/.pi/APPEND_SYSTEM.md`:

```markdown
## Model Policy

A extensao `model-policy` (em `~/.pi/agent/extensions/model-policy/`) gerencia:
- Mapeamento de objetivos para modelos: `~/.pi/agent/model-policy.json` (global) e `.pi/model-policy.json` (projeto)
- Benchmark historico: `~/.pi/model-policy-benchmarks.jsonl`
- Custo sintetico para subscription providers (tokens x preco do guia)
- A/B testing de modelos com relatorios comparativos automaticos
- Smart budget suggestion baseada em historico
- Export de benchmarks em CSV, JSON, Vega-Lite, HTML

**Consulte ao:**
- Decidir modelo para colony/subagent -> policy e injetada automaticamente
- Avaliar performance/degradacao -> `/model-policy benchmark` ou `/model-policy dashboard`
- Entender custo real de subscription providers -> benchmark tem syntheticCostUsd
- Retomar tarefa interrompida -> `.pi/handoffs/handoff-*.md`
- Comparar modelos -> `/model-policy experiment status`
- Configurar novo projeto -> `/model-policy init` (smart budget suggestion)

**Nao sobrescreva:**
- model-policy.json sem consultar o usuario
- benchmarks.jsonl (append-only, nunca reescrever)
```

---

## 20. Checklist de Implementacao

| # | Modulo | Prioridade | Complexidade | Dependencias |
|---|--------|-----------|-------------|-------------|
| 1 | `config.ts` | P0 | Baixa | — |
| 2 | `pricing.ts` | P0 | Media | llm-pricing-guide.md |
| 3 | `injector.ts` | P0 | Baixa | config.ts |
| 4 | `budget-guard.ts` | P1 | Alta | pricing.ts, config.ts |
| 5 | `handoff-doc.ts` | P1 | Media | budget-guard.ts |
| 6 | `benchmark-recorder.ts` | P1 | Alta | pricing.ts, config.ts |
| 7 | `smart-budget.ts` | P1 | Media | benchmark-recorder.ts, config.ts |
| 8 | `cost-estimator.ts` | P2 | Alta | pricing.ts, benchmark-recorder.ts |
| 9 | `pre-flight-planner.ts` | P2 | Media | cost-estimator.ts, config.ts |
| 10 | `ab-testing.ts` | P2 | Media | injector.ts, benchmark-recorder.ts |
| 11 | `export.ts` | P2 | Media | benchmark-recorder.ts |
| 12 | Dashboard (no comando) | P2 | Media | benchmark-recorder.ts, ab-testing.ts |
| 13 | Comando `/model-policy` | P2 | Media | todos os modulos |

**Ordem de implementacao sugerida:**
```
P0: config -> pricing -> injector
P1: budget-guard -> handoff -> benchmark-recorder -> smart-budget
P2: cost-estimator -> pre-flight -> ab-testing -> export -> dashboard -> command
```

---

## 21. Backlog (P3 — pos-MVP)

Features validadas no planejamento mas adiadas para apos MVP funcional.
Registradas aqui para retomada de implementacao.

### 21.1 Handoff Chain

Vincular automaticamente colony runs que sao retomadas a partir de handoffs,
criando cadeia rastreavel de custo e duracao total.

```jsonc
// Adicao ao benchmark schema:
{
  "resumedFrom": "colony-abc123",
  "resumedFromHandoff": "handoff-abc123-20260417.md",
  "chainCost": 3.42,          // custo acumulado da cadeia inteira
  "chainDuration": 542000,
  "chainRuns": 2
}
```

**Justificativa:** Tarefas complexas podem precisar de 2-3 retomadas.
Sem cadeia, perde-se a visao total do custo e tempo da tarefa.

**Pre-requisitos:** handoff-doc.ts, benchmark-recorder.ts funcionando.

### 21.2 Automatic Model Demotion/Promotion

Baseado no benchmark historico, sugerir ou aplicar automaticamente trocas de
modelo quando a performance muda significativamente.

```
Alerta de degradacao detectada
  claude-sonnet-4.6 (worker:backend):
    Semana passada: $0.09/task, 12s avg, 0% fail
    Esta semana:    $0.14/task, 18s avg, 8% fail
    -> Degradacao de 55% no custo e 50% na latencia

  Sugestao: trocar swarm:worker para google/gemini-2.5-pro
  (historico no benchmark: $0.06/task, 14s avg, 2% fail)
  Aplicar? [S/n]
```

**Criterios de trigger:**
- Custo medio por task > 30% maior que media movel de 4 semanas
- Failure rate > 3x a media movel de 4 semanas
- Latencia > 50% maior que media movel de 4 semanas

**Acao:** Sugere troca via `ctx.ui.confirm()` + edita model-policy.json se aceito.

**Pre-requisitos:** benchmark-recorder.ts com >= 20 runs historicos por role.

### 21.3 Budget Guard para Chains de Subagent

Estender o budget-guard para monitorar custo acumulado de chains de subagent
(que executam multiplos steps sequenciais), nao apenas subagent individual.

**Pre-requisitos:** budget-guard.ts, entender chain execution flow no subagent.

### 21.4 Policy Inheritance entre Projetos

Permitir que um projeto herde policy de outro projeto (nao apenas do global),
util para monorepos ou organizacoes com multiplos repositorios.

```jsonc
// .pi/model-policy.json
{
  "extends": "../potlabs-deception/.pi/model-policy.json",
  "objectives": {
    "swarm:worker": "override-especifico-deste-projeto"
  }
}
```

**Pre-requisitos:** config.ts com suporte a `extends`.

---

## 22. Rastreabilidade e Sync com agents-lab Fork

### Contexto

O usuario e mantenedor do pi-stack via fork em `~/dev/pessoal/forks/agents-lab`.
Toda implementacao da model-policy deve ser rastreavel e portavel para o fork,
visando um futuro PR no upstream `aretw0/agents-lab`.

### Convenções do fork

- **Branch:** `feat/model-policy-extension` (a partir de `main`)
- **Commits:** Conventional Commits em PT-BR (conforme diretiva global)
- **Changeset:** obrigatorio para `packages/pi-stack` via `npx changeset`
- **CHANGELOG:** atualizar secao `[Nao lancado]`
- **Experimento:** registrar em `experiments/202604-model-policy/README.md`
- **PR template:** seguir `.github/PULL_REQUEST_TEMPLATE.md`

### Estrutura de arquivos no fork

```
~/dev/pessoal/forks/agents-lab/
├── packages/pi-stack/
│   └── extensions/
│       └── model-policy/          ← extensao completa (copiada de ~/.pi/agent/extensions/model-policy/)
│           ├── index.ts
│           ├── types.ts
│           ├── config.ts
│           ├── pricing.ts
│           ├── injector.ts
│           ├── budget-guard.ts
│           ├── handoff-doc.ts
│           ├── benchmark-recorder.ts
│           ├── smart-budget.ts
│           ├── cost-estimator.ts
│           ├── pre-flight-planner.ts
│           ├── ab-testing.ts
│           └── export.ts
├── experiments/
│   └── 202604-model-policy/
│       ├── README.md              ← documentacao do experimento
│       ├── plan-v4.md             ← copia do plano completo
│       ├── benchmark-samples/     ← amostras reais de benchmark (anonimizadas)
│       └── validation-notes.md    ← notas de testes e validacao
└── docs/
    └── model-policy-guide.md      ← guia de uso para usuarios da stack
```

### Fluxo de sync

```
1. Implementacao em ~/.pi/agent/extensions/model-policy/ (workspace potlabs)
2. Testes manuais com ant_colony e subagent no potlabs
3. Quando modulo estavel:
   a. Copiar para ~/dev/pessoal/forks/agents-lab/packages/pi-stack/extensions/model-policy/
   b. Commitar no fork com referencia ao plano
   c. Atualizar CHANGELOG.md
4. Quando MVP completo:
   a. Criar changeset (`npx changeset`)
   b. Atualizar README do pi-stack
   c. Criar experiment README em experiments/202604-model-policy/
   d. Abrir PR no fork (main)
5. Quando validado:
   a. Avaliar PR upstream para aretw0/agents-lab
```

### Commits esperados (por fase de implementacao)

```
feat(pi-stack): adicionar types.ts e scaffold da extensao model-policy
feat(pi-stack): implementar config.ts — leitura e merge de model-policy.json
feat(pi-stack): implementar pricing.ts — custo sintetico e parser do guia de precos
feat(pi-stack): implementar injector.ts — injecao de modelOverrides em ant_colony e subagent
feat(pi-stack): implementar budget-guard.ts — alertas de budget em 3 fases
feat(pi-stack): implementar benchmark-recorder.ts — metricas pos-execucao em .jsonl
feat(pi-stack): implementar handoff-doc.ts — documento de retomada de colony
feat(pi-stack): implementar smart-budget.ts — sugestao automatica de budgets
feat(pi-stack): implementar cost-estimator.ts — estimativa por task com calibracao
feat(pi-stack): implementar pre-flight-planner.ts — quality gate e goal enrichment
feat(pi-stack): implementar ab-testing.ts — A/B testing de modelos por role
feat(pi-stack): implementar export.ts — export CSV, Vega-Lite, HTML
feat(pi-stack): implementar comando /model-policy com dashboard
feat(pi-stack): integrar index.ts final da extensao model-policy
docs(experiments): documentar experimento model-policy com resultados de validacao
chore(pi-stack): adicionar changeset para model-policy extension
```

### Diretivas para o agente durante implementacao

1. **Toda mudanca no codigo da extensao** deve ser refletivel no fork — nao usar
   paths hardcoded ou dependencias que so existem em ~/.pi/
2. **O model-policy.json template** deve funcionar tanto como global (~/.pi/agent/)
   quanto como projeto-local (.pi/) — sem assumir workspace especifico
3. **Imports da extensao** devem usar imports relativos (./types, ./config, etc.)
   para que o diretorio seja portavel entre ~/.pi/agent/extensions/ e packages/pi-stack/extensions/
4. **Testes de validacao** devem ser documentados em experiments/202604-model-policy/validation-notes.md
5. **Qualquer mudanca no plano v4 durante implementacao** deve ser refletida tanto no
   `.pi/plans/model-policy-extension-v4.md` (potlabs) quanto copiada para o fork
