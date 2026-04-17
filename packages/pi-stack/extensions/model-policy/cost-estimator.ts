/**
 * model-policy — cost-estimator.ts
 *
 * Estimativa de custo por task antes e depois do scout.
 * Usa dados históricos do benchmark quando disponíveis (≥5 amostras),
 * heurísticas baseadas em complexidade da task como fallback.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  TaskEstimate,
  PlanEstimate,
  ResolvedPolicy,
  TokenUsage,
} from "./types.js";
import { getPricing, calculateSyntheticCost } from "./pricing.js";
import { getResolvedPolicy } from "./config.js";
import { loadBenchmarksByRole } from "./benchmark-recorder.js";

// ═══════════════════════════════════════════════════════════════
// Context window por modelo
// ═══════════════════════════════════════════════════════════════

function getContextWindow(model: string): number {
  const m = model.toLowerCase();
  if (m.includes("gemini")) return 1_000_000;
  if (m.includes("gpt-4o")) return 128_000;
  return 200_000;
}

// ═══════════════════════════════════════════════════════════════
// Resolução de role a partir de caste + workerClass
// ═══════════════════════════════════════════════════════════════

interface RawTask {
  caste?: string;
  workerClass?: string;
  files?: string[];
  context?: string;
  description?: string;
  priority?: number;
}

function resolveRole(task: RawTask): string {
  const caste = task.caste ?? "worker";
  const wc = task.workerClass;
  return wc ? `${caste}:${wc}` : caste;
}

function resolveObjectiveKey(task: RawTask): string {
  const caste = task.caste ?? "worker";
  const wc = task.workerClass;
  return wc ? `swarm:${wc}` : `swarm:${caste}`;
}

// ═══════════════════════════════════════════════════════════════
// Heurísticas de tokens por caste
// ═══════════════════════════════════════════════════════════════

const CASTE_BASE_OUTPUT: Record<string, number> = {
  soldier: 800,
  drone:   100,
  scout:   2_000,
  worker:  2_000,
};

const WORKER_CLASS_MULTIPLIER: Record<string, number> = {
  design:     1.5,
  multimodal: 1.5,
  backend:    1.0,
  review:     0.8,
};

function estimateTokensHeuristic(task: RawTask): TokenUsage {
  const caste = task.caste ?? "worker";
  const wc = task.workerClass;

  const baseInput =
    (task.files?.length ?? 0) * 500 +
    ((task.context?.length ?? 0) / 4) +
    ((task.description?.length ?? 0) * 2) +
    2_000; // system prompt base

  const baseOutput = CASTE_BASE_OUTPUT[caste] ?? 2_000;

  let multiplier = 1.0;
  if (wc && WORKER_CLASS_MULTIPLIER[wc] !== undefined) {
    multiplier = WORKER_CLASS_MULTIPLIER[wc] as number;
  } else if (caste === "soldier") {
    multiplier = 0.6;
  } else if (caste === "drone") {
    multiplier = 0.1;
  } else if ((task.priority ?? 3) === 1) {
    multiplier = 1.2;
  }

  return {
    input: Math.round(baseInput * multiplier),
    output: Math.round(baseOutput * multiplier),
    cacheRead: 0,
    cacheWrite: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// Estimativa de uma task individual
// ═══════════════════════════════════════════════════════════════

export function estimateTaskCost(
  task: RawTask,
  model: string
): TaskEstimate {
  const role = resolveRole(task);
  const pricing = getPricing(model);
  const contextWindow = getContextWindow(model);

  // Tentar calibração histórica primeiro (≥5 amostras)
  const historical = loadBenchmarksByRole(role, model, 5);
  if (historical && historical.samples >= 5) {
    return {
      role,
      model,
      costUsd: historical.costPerTask,
      inputTokens: Math.round(historical.inputPerTask),
      outputTokens: Math.round(historical.outputPerTask),
      contextPct: (historical.inputPerTask / contextWindow) * 100,
      confidence: "high",
      method: "historical",
      samples: historical.samples,
    };
  }

  // Fallback: heurísticas
  const tokens = estimateTokensHeuristic(task);
  const costUsd = calculateSyntheticCost(tokens, pricing);

  return {
    role,
    model,
    costUsd,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    contextPct: (tokens.input / contextWindow) * 100,
    confidence: "low",
    method: "heuristic",
    samples: historical?.samples ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// Estimativa do plano completo (pós-scout)
// ═══════════════════════════════════════════════════════════════

/**
 * Lê state.json do disco após fase scouting e estima custo total.
 * Chamado pelo budget-guard e pelo pre-flight-planner.
 */
export function estimatePlanFromStateJson(
  colonyDir: string,
  policy: ResolvedPolicy
): PlanEstimate | null {
  const stateFile = path.join(colonyDir, "state.json");
  if (!fs.existsSync(stateFile)) return null;

  let tasks: RawTask[] = [];
  let maxCostUsd = 0;

  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8")) as {
      tasks?: RawTask[];
      maxCost?: number;
    };
    tasks = state.tasks ?? [];
    maxCostUsd = state.maxCost ?? policy.budgets.swarm.maxCostUsd;
  } catch {
    return null;
  }

  return estimatePlanFromTasks(tasks, policy, maxCostUsd);
}

export function estimatePlanFromTasks(
  tasks: RawTask[],
  policy: ResolvedPolicy,
  maxCostUsd?: number
): PlanEstimate {
  const budget = maxCostUsd ?? policy.budgets.swarm.maxCostUsd;
  const taskEstimates: TaskEstimate[] = [];

  for (const task of tasks) {
    const objKey = resolveObjectiveKey(task);
    const model =
      (policy.objectives as Record<string, string | undefined>)[objKey] ??
      policy.objectives["swarm:worker"] ??
      "anthropic/claude-sonnet-4.6";

    taskEstimates.push(estimateTaskCost(task, model));
  }

  // Agregar por role
  const byRoleMap = new Map<
    string,
    { model: string; count: number; totalCost: number; totalContext: number }
  >();

  for (const est of taskEstimates) {
    const existing = byRoleMap.get(est.role);
    if (existing) {
      existing.count++;
      existing.totalCost += est.costUsd;
      existing.totalContext += est.contextPct;
    } else {
      byRoleMap.set(est.role, {
        model: est.model,
        count: 1,
        totalCost: est.costUsd,
        totalContext: est.contextPct,
      });
    }
  }

  const byRole = Array.from(byRoleMap.entries()).map(([role, data]) => ({
    role,
    model: data.model,
    count: data.count,
    totalCostUsd: data.totalCost,
    avgContextPct: data.totalContext / data.count,
  }));

  const totalCostUsd = taskEstimates.reduce((s, e) => s + e.costUsd, 0);
  // Margem de erro: ±40% heurístico, ±15% histórico
  const hasHeuristic = taskEstimates.some(e => e.method === "heuristic");
  const marginPct = hasHeuristic ? 0.40 : 0.15;
  const rangeLowUsd = totalCostUsd * (1 - marginPct);
  const rangeHighUsd = totalCostUsd * (1 + marginPct);
  const budgetConsumedPct = budget > 0 ? (totalCostUsd / budget) * 100 : 0;

  const overallConfidence: "high" | "low" = hasHeuristic ? "low" : "high";
  const allSamples = taskEstimates.reduce((s, e) => s + e.samples, 0);
  const method: "historical" | "heuristic" | "mixed" =
    taskEstimates.every(e => e.method === "historical")
      ? "historical"
      : taskEstimates.every(e => e.method === "heuristic")
      ? "heuristic"
      : "mixed";

  return {
    totalCostUsd,
    rangeLowUsd,
    rangeHighUsd,
    budgetConfiguredUsd: budget,
    budgetConsumedPct,
    tasks: taskEstimates,
    byRole,
    overallConfidence,
    method,
    samplesUsed: allSamples,
  };
}

// ═══════════════════════════════════════════════════════════════
// Estimativa pré-colony (baseada no goal, sem tasks ainda)
// ═══════════════════════════════════════════════════════════════

/**
 * Estimativa rápida baseada apenas no goal (antes do scout).
 * Usa dados históricos de runs anteriores com goals de tamanho similar.
 */
export function estimateFromGoal(
  goal: string,
  policy: ResolvedPolicy
): { estimatedCostUsd: number; rangeLow: number; rangeHigh: number; confidence: "high" | "low"; reasoning: string } {
  const colonyRecords = (() => {
    try {
      const { loadBenchmarks } = require("./benchmark-recorder.js") as typeof import("./benchmark-recorder.js");
      return loadBenchmarks({ runType: "colony", maxRecords: 100 });
    } catch {
      return [];
    }
  })();

  // Agrupar por comprimento de goal (proxy de complexidade)
  const goalLen = goal.length;
  const similar = colonyRecords.filter(r => {
    const diff = Math.abs(r.goal.length - goalLen);
    return diff < goalLen * 0.5; // dentro de 50% do tamanho
  });

  if (similar.length >= 5) {
    const costs = similar.map(r => r.effectiveCostUsd).sort((a, b) => a - b);
    const mean = costs.reduce((s, v) => s + v, 0) / costs.length;
    const p90 = costs[Math.floor(costs.length * 0.9)] ?? costs[costs.length - 1] ?? mean;
    return {
      estimatedCostUsd: mean,
      rangeLow: costs[0] ?? 0,
      rangeHigh: p90,
      confidence: "high",
      reasoning: `Baseado em ${similar.length} runs históricos com goals de tamanho similar`,
    };
  }

  // Fallback: estimar ~15 tasks médias com modelo worker
  const workerModel = policy.objectives["swarm:worker"] ?? "anthropic/claude-sonnet-4.6";
  const pricing = getPricing(workerModel);
  const avgTaskCost = calculateSyntheticCost(
    { input: 28_000, output: 4_000, cacheRead: 0, cacheWrite: 0 },
    pricing
  );
  const estimatedTasks = Math.max(5, Math.min(25, Math.round(goalLen / 100)));
  const estimated = avgTaskCost * estimatedTasks;

  return {
    estimatedCostUsd: estimated,
    rangeLow: estimated * 0.5,
    rangeHigh: estimated * 1.5,
    confidence: "low",
    reasoning: `Heurística: ~${estimatedTasks} tasks estimadas, custo médio por worker task`,
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatação
// ═══════════════════════════════════════════════════════════════

export function formatPlanEstimate(plan: PlanEstimate): string {
  const lines = [
    "╭─ Estimativa de Custo do Plano ────────────────────────────",
    `│  Budget configurado: $${plan.budgetConfiguredUsd.toFixed(2)}`,
    "│",
    "│  Por role:",
  ];

  for (const r of plan.byRole) {
    const modelShort = r.model.split("/")[1] ?? r.model;
    lines.push(
      `│    ${r.role.padEnd(20)} (${modelShort})  ×${r.count}  →  $${r.totalCostUsd.toFixed(3)}  (${r.avgContextPct.toFixed(0)}% ctx)`
    );
  }

  lines.push(
    "│  " + "─".repeat(54),
    `│  Total estimado:  $${plan.totalCostUsd.toFixed(2)}  (${plan.budgetConsumedPct.toFixed(0)}% do budget)`,
    `│  Range:           $${plan.rangeLowUsd.toFixed(2)} – $${plan.rangeHighUsd.toFixed(2)}`,
    `│  Margem de erro:  ${plan.overallConfidence === "high" ? "±15%" : "±40%"}`,
    `│  Método:          ${plan.method}  (${plan.samplesUsed} amostras históricas)`,
    "╰────────────────────────────────────────────────────────────"
  );

  return lines.join("\n");
}
