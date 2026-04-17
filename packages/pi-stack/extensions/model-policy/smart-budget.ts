/**
 * model-policy — smart-budget.ts
 *
 * Sugestão automática de budgets e objectives baseada no histórico
 * de benchmarks. Ativado em /model-policy init ou no primeiro
 * tool_call(ant_colony) sem .pi/model-policy.json no projeto.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  SmartBudgetSuggestion,
  BudgetSuggestionItem,
  ObjectiveMap,
  BenchmarkRecord,
  ByRoleEntry,
} from "./types.js";
import { loadBenchmarks } from "./benchmark-recorder.js";
import { getResolvedPolicy, writeProjectPolicy, projectPolicyPath } from "./config.js";

// ═══════════════════════════════════════════════════════════════
// Estatísticas
// ═══════════════════════════════════════════════════════════════

interface Stats {
  mean: number;
  p90: number;
  p99: number;
  max: number;
  count: number;
}

function computeStats(values: number[]): Stats {
  if (values.length === 0) return { mean: 0, p90: 0, p99: 0, max: 0, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? sorted[sorted.length - 1] ?? 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return { mean, p90, p99, max, count: sorted.length };
}

/** Arredonda para cima no múltiplo de `step` */
function roundUp(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

// ═══════════════════════════════════════════════════════════════
// Sugestão de budgets
// ═══════════════════════════════════════════════════════════════

/** Defaults usados quando não há histórico suficiente */
const DEFAULT_SWARM_BUDGET = 2.00;
const DEFAULT_SUBAGENT_BUDGET = 0.10;

function buildSuggestionItem(
  stats: Stats,
  percentile: "p90" | "p99",
  step: number,
  coverageLabel: string
): BudgetSuggestionItem {
  const targetValue = stats[percentile];
  const suggested = stats.count >= 5 ? roundUp(targetValue, step) : undefined;

  return {
    maxCostUsd: suggested ?? (step === 0.50 ? DEFAULT_SWARM_BUDGET : DEFAULT_SUBAGENT_BUDGET),
    meanCost: stats.mean,
    p90Cost: stats.p90,
    p99Cost: stats.p99,
    maxObserved: stats.max,
    samples: stats.count,
    coveragePct: stats.count >= 5 ? parseFloat(coverageLabel) : 0,
    reasoning:
      stats.count >= 5
        ? `Cobre ${coverageLabel}% dos runs (n=${stats.count}, media=$${stats.mean.toFixed(2)}, ${percentile}=$${targetValue.toFixed(2)})`
        : `Sem historico suficiente (n=${stats.count} < 5) — usando default recomendado`,
  };
}

// ═══════════════════════════════════════════════════════════════
// Sugestão de objectives
// ═══════════════════════════════════════════════════════════════

/**
 * Para cada role, escolhe o modelo com menor costPerTask E failureRate < 5%.
 * Requer pelo menos 3 amostras por role+model para considerar.
 */
function suggestObjectives(records: BenchmarkRecord[]): ObjectiveMap {
  // Coletar métricas por role+model
  const roleModelStats = new Map<
    string,
    { costs: number[]; fails: number[]; model: string; role: string }
  >();

  for (const record of records) {
    for (const entry of record.byRole) {
      const key = `${entry.role}|${entry.model}`;
      const existing = roleModelStats.get(key);
      if (existing) {
        existing.costs.push(entry.costPerTask);
        existing.fails.push(entry.failureRate);
      } else {
        roleModelStats.set(key, {
          costs: [entry.costPerTask],
          fails: [entry.failureRate],
          model: entry.model,
          role: entry.role,
        });
      }
    }
  }

  // Para cada role, encontrar o melhor modelo
  const bestByRole = new Map<string, { model: string; avgCost: number }>();

  for (const [, data] of roleModelStats) {
    if (data.costs.length < 3) continue; // mínimo 3 amostras

    const avgCost = data.costs.reduce((s, v) => s + v, 0) / data.costs.length;
    const avgFail = data.fails.reduce((s, v) => s + v, 0) / data.fails.length;

    // Desqualificar modelos com failureRate médio > 5%
    if (avgFail > 0.05) continue;

    const existing = bestByRole.get(data.role);
    if (!existing || avgCost < existing.avgCost) {
      bestByRole.set(data.role, { model: data.model, avgCost });
    }
  }

  // Converter para ObjectiveMap
  // Mapeamento role → chave de objective
  const roleToObjective: Record<string, keyof ObjectiveMap> = {
    "scout":          "swarm:scout",
    "worker":         "swarm:worker",
    "worker:backend": "swarm:backend",
    "worker:design":  "swarm:design",
    "worker:multimodal": "swarm:multimodal",
    "worker:review":  "swarm:review",
    "soldier":        "swarm:soldier",
    "subagent:default":  "subagent:default",
    "subagent:complex":  "subagent:complex",
    "subagent:analysis": "subagent:analysis",
  };

  const suggested: ObjectiveMap = {};
  for (const [role, { model }] of bestByRole) {
    const key = roleToObjective[role];
    if (key) (suggested as Record<string, string>)[key] = model;
  }

  return suggested;
}

// ═══════════════════════════════════════════════════════════════
// Geração da sugestão completa
// ═══════════════════════════════════════════════════════════════

export function generateSmartBudgetSuggestion(): SmartBudgetSuggestion {
  const colonyRecords = loadBenchmarks({ runType: "colony", maxRecords: 200 });
  const subagentRecords = loadBenchmarks({ runType: "subagent", maxRecords: 200 });

  const colonyStats = computeStats(colonyRecords.map(r => r.effectiveCostUsd));
  const subagentStats = computeStats(subagentRecords.map(r => r.effectiveCostUsd));

  const swarmSuggestion = buildSuggestionItem(colonyStats, "p90", 0.50, "90");
  const subagentSuggestion = buildSuggestionItem(subagentStats, "p99", 0.05, "99");

  const allRecords = [...colonyRecords, ...subagentRecords];
  const suggestedObjectives = suggestObjectives(allRecords);

  return {
    swarm: swarmSuggestion,
    subagent: subagentSuggestion,
    suggestedObjectives,
    basedOnSamples: {
      colony: colonyRecords.length,
      subagent: subagentRecords.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatação para exibição
// ═══════════════════════════════════════════════════════════════

export function formatSmartBudgetSuggestion(suggestion: SmartBudgetSuggestion): string {
  const hasHistory =
    suggestion.basedOnSamples.colony >= 5 || suggestion.basedOnSamples.subagent >= 5;

  const lines: string[] = [
    "╭─ Smart Budget Suggestion ──────────────────────────────",
    "│",
  ];

  if (!hasHistory) {
    lines.push("│  ⚠️  Sem historico suficiente — usando defaults recomendados.");
    lines.push("│     Os valores serao refinados apos 5+ colony runs.");
    lines.push("│");
  } else {
    lines.push(
      `│  Baseado em: ${suggestion.basedOnSamples.colony} colony runs + ` +
      `${suggestion.basedOnSamples.subagent} subagent runs`
    );
    lines.push("│");
  }

  lines.push("│  swarm.maxCostUsd = $" + suggestion.swarm.maxCostUsd.toFixed(2));
  lines.push("│  └─ " + suggestion.swarm.reasoning);
  lines.push("│");
  lines.push("│  subagent.maxCostUsd = $" + suggestion.subagent.maxCostUsd.toFixed(2));
  lines.push("│  └─ " + suggestion.subagent.reasoning);

  const objKeys = Object.keys(suggestion.suggestedObjectives);
  if (objKeys.length > 0) {
    lines.push("│");
    lines.push("│  Modelos sugeridos (menor custo, failRate < 5%):");
    for (const key of objKeys) {
      const model = (suggestion.suggestedObjectives as Record<string, string>)[key] ?? "";
      lines.push(`│    ${key.padEnd(24)} -> ${model}`);
    }
  }

  lines.push("│");
  lines.push("╰────────────────────────────────────────────────────────");
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Aplicação da sugestão
// ═══════════════════════════════════════════════════════════════

/**
 * Verifica se o projeto já tem model-policy.json.
 * Usado para trigger automático no primeiro tool_call(ant_colony).
 */
export function projectHasPolicy(cwd: string): boolean {
  return fs.existsSync(projectPolicyPath(cwd));
}

/**
 * Aplica a sugestão ao model-policy.json do projeto.
 * Chamado após confirmação do usuário em /model-policy init.
 */
export function applySmartBudgetSuggestion(
  cwd: string,
  suggestion: SmartBudgetSuggestion
): void {
  writeProjectPolicy(cwd, {
    version: 1,
    objectives: suggestion.suggestedObjectives,
    budgets: {
      swarm: {
        maxCostUsd: suggestion.swarm.maxCostUsd,
        alerts: [50, 75, 90, 95],
        timeoutOnGateSec: 30,
        defaultActionOnTimeout: "stop",
      },
      subagent: {
        maxCostUsd: suggestion.subagent.maxCostUsd,
        alerts: [50, 75, 90, 95],
        timeoutOnGateSec: 30,
        defaultActionOnTimeout: "stop",
      },
    },
  });
}
