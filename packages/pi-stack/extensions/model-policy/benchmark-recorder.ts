/**
 * model-policy — benchmark-recorder.ts
 *
 * Registra métricas pós-execução de colony e subagent runs em
 * um arquivo .jsonl append-only para análise histórica.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  BenchmarkRecord,
  ByRoleEntry,
  RunExperiment,
  BudgetAlert,
  ObjectiveMap,
} from "./types.js";
import { getPricing, calculateSyntheticCost } from "./pricing.js";
import { getResolvedPolicy } from "./config.js";

// ═══════════════════════════════════════════════════════════════
// Paths
// ═══════════════════════════════════════════════════════════════

export function benchmarkFilePath(): string {
  return path.join(os.homedir(), ".pi", "model-policy-benchmarks.jsonl");
}

function rotatedFilePath(year: number): string {
  return path.join(os.homedir(), ".pi", `model-policy-benchmarks-${year}.jsonl`);
}

// ═══════════════════════════════════════════════════════════════
// Rotação e append
// ═══════════════════════════════════════════════════════════════

function countLines(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").filter(l => l.trim().length > 0).length;
  } catch {
    return 0;
  }
}

function rotateIfNeeded(filePath: string, maxEntries: number): void {
  if (countLines(filePath) <= maxEntries) return;
  const year = new Date().getFullYear();
  const dest = rotatedFilePath(year);
  try {
    fs.renameSync(filePath, dest);
  } catch {
    // Se falhar (ex: dest já existe), apenas continuar
  }
}

function appendRecord(record: BenchmarkRecord): void {
  let maxEntries = 10000;
  try {
    const policy = getResolvedPolicy();
    maxEntries = policy.benchmark.maxEntries;
  } catch { /* usar default */ }

  const filePath = benchmarkFilePath();
  rotateIfNeeded(filePath, maxEntries);

  const line = JSON.stringify(record);
  fs.appendFileSync(filePath, line + "\n", "utf-8");
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function getContextWindow(model: string): number {
  const lower = model.toLowerCase();
  if (lower.includes("gemini")) return 1_000_000;
  if (lower.includes("gpt-4o")) return 128_000;
  return 200_000;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem.toString().padStart(2, "0")}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

// ═══════════════════════════════════════════════════════════════
// Captura de colony run
// ═══════════════════════════════════════════════════════════════

interface RoleTokenData {
  model: string;
  provider: string;
  caste: string;
  input: number;
  output: number;
  cacheRead: number;
  reportedCost: number;
  syntheticCost: number;
  tasksExecuted: number;
  durationMsTotal: number;
  failureCount: number;
  escalations: number;
}

export function recordColonyRun(params: {
  colonyId: string;
  runtimeId: string;
  goal: string;
  outcome: "done" | "failed" | "budget_exceeded" | "aborted";
  durationMs: number;
  tokensByRole: Map<string, RoleTokenData>;
  budgetConfiguredUsd: number;
  budgetAlerts: BudgetAlert[];
  reportedCostUsd: number;
  syntheticCostUsd: number;
  estimatedCostUsd: number | null;
  maxAnts: number;
  workspaceMode: "worktree" | "shared";
  sessionFile: string;
  projectCwd: string;
  piVersion: string;
  experiment: RunExperiment | null;
  tasksTotal: number;
  tasksDone: number;
  tasksFailed: number;
  subTasksSpawned: number;
  throughputHistory: number[];
}): void {
  let policy: { objectives: ObjectiveMap; benchmark: { enabled: boolean } } = {
    objectives: {},
    benchmark: { enabled: true },
  };
  try {
    policy = getResolvedPolicy();
  } catch { /* usar defaults */ }

  if (!policy.benchmark.enabled) return;

  const effectiveCostUsd =
    params.reportedCostUsd > 0 ? params.reportedCostUsd : params.syntheticCostUsd;

  const budgetConsumedPct =
    params.budgetConfiguredUsd > 0
      ? (effectiveCostUsd / params.budgetConfiguredUsd) * 100
      : 0;

  const estimateAccuracyPct =
    params.estimatedCostUsd != null
      ? (1 -
          Math.abs(effectiveCostUsd - params.estimatedCostUsd) /
            Math.max(params.estimatedCostUsd, 0.001)) *
        100
      : null;

  // Throughput
  const th = params.throughputHistory;
  const tasksPerMinute =
    th.length > 0
      ? th.reduce((a, b) => a + b, 0) / th.length
      : params.durationMs > 0
      ? params.tasksDone / (params.durationMs / 60_000)
      : 0;
  const tasksPerMinutePeak = th.length > 0 ? Math.max(...th) : tasksPerMinute;

  // Tokens totais
  let inputTotal = 0, outputTotal = 0, cacheReadTotal = 0;
  for (const data of params.tokensByRole.values()) {
    inputTotal += data.input;
    outputTotal += data.output;
    cacheReadTotal += data.cacheRead;
  }
  const totalTokens = inputTotal + outputTotal + cacheReadTotal;
  const tokensPerSecond =
    params.durationMs > 0 ? totalTokens / (params.durationMs / 1000) : 0;

  // byRole[]
  const byRole: ByRoleEntry[] = [];
  for (const [role, data] of params.tokensByRole) {
    const contextPctAvg =
      data.tasksExecuted > 0
        ? (data.input / data.tasksExecuted / getContextWindow(data.model)) * 100
        : 0;

    // Determinar experimentGroup se há experimento ativo para este role
    let experimentGroup: "control" | "variant" | undefined;
    if (params.experiment && params.experiment.role === `swarm:${role.split(":")[0]}`) {
      experimentGroup = params.experiment.group;
    }

    byRole.push({
      role,
      model: data.model,
      provider: data.provider,
      tasksExecuted: data.tasksExecuted,
      durationMsTotal: data.durationMsTotal,
      durationMsAvg:
        data.tasksExecuted > 0 ? data.durationMsTotal / data.tasksExecuted : 0,
      inputTokens: data.input,
      outputTokens: data.output,
      cacheReadTokens: data.cacheRead,
      reportedCostUsd: data.reportedCost,
      syntheticCostUsd: data.syntheticCost,
      costPerTask:
        data.tasksExecuted > 0 ? data.syntheticCost / data.tasksExecuted : 0,
      failureRate:
        data.tasksExecuted > 0 ? data.failureCount / data.tasksExecuted : 0,
      escalations: data.escalations,
      contextPctAvg,
      ...(experimentGroup ? { experimentGroup } : {}),
    });
  }

  const record: BenchmarkRecord = {
    schemaVersion: 2 as 2,
    recordedAt: new Date().toISOString(),
    runType: "colony",
    runId: params.colonyId,
    sessionFile: params.sessionFile,
    projectCwd: params.projectCwd,
    goal: params.goal.slice(0, 200),

    policy: {
      source: "merged",
      objectives: policy.objectives,
      budgetConfiguredUsd: params.budgetConfiguredUsd,
    },

    outcome: params.outcome,
    durationMs: params.durationMs,
    reportedCostUsd: params.reportedCostUsd,
    syntheticCostUsd: params.syntheticCostUsd,
    effectiveCostUsd,
    budgetConsumedPct,
    estimatedCostUsd: params.estimatedCostUsd,
    estimateAccuracyPct,
    estimateMethod: null,
    estimateSamples: null,

    tasks: {
      total: params.tasksTotal,
      done: params.tasksDone,
      failed: params.tasksFailed,
      subTasksSpawned: params.subTasksSpawned,
    },

    tokens: {
      inputTotal,
      outputTotal,
      cacheReadTotal,
      cacheWriteTotal: 0,
      totalTokens,
    },

    throughput: {
      tasksPerMinute: Math.round(tasksPerMinute * 10) / 10,
      tasksPerMinutePeak: Math.round(tasksPerMinutePeak * 10) / 10,
      tokensPerSecond: Math.round(tokensPerSecond),
    },

    byRole,
    budgetAlerts: params.budgetAlerts,
    planning: null,

    routing: {
      escalations: 0,
      avgLatencyMsByRole: {},
    },

    experiment: params.experiment,

    env: {
      piVersion: params.piVersion,
      maxAnts: params.maxAnts,
      workspaceMode: params.workspaceMode,
      providerType: params.reportedCostUsd === 0 ? "subscription" : "api-key",
    },
  };

  appendRecord(record);
}

// ═══════════════════════════════════════════════════════════════
// Captura de subagent run
// ═══════════════════════════════════════════════════════════════

export function recordSubagentRun(params: {
  runId: string;
  goal: string;
  model: string;
  provider: string;
  outcome: "done" | "failed";
  durationMs: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
  sessionFile: string;
  projectCwd: string;
  piVersion: string;
}): void {
  let policy: { objectives: ObjectiveMap; benchmark: { enabled: boolean; subagentReport: boolean } } = {
    objectives: {},
    benchmark: { enabled: true, subagentReport: false },
  };
  try {
    policy = getResolvedPolicy();
  } catch { /* usar defaults */ }

  if (!policy.benchmark.enabled) return;

  const pricing = getPricing(params.model);
  const tokens = {
    input: params.usage.input,
    output: params.usage.output,
    cacheRead: params.usage.cacheRead,
    cacheWrite: params.usage.cacheWrite,
  };
  const syntheticCost = calculateSyntheticCost(tokens, pricing);
  const effectiveCostUsd = params.usage.cost > 0 ? params.usage.cost : syntheticCost;
  const totalTokens =
    params.usage.input + params.usage.output + params.usage.cacheRead + params.usage.cacheWrite;

  // Derivar role a partir do model
  const modelLower = params.model.toLowerCase();
  const role = modelLower.includes("pro") || modelLower.includes("opus")
    ? "subagent:analysis"
    : modelLower.includes("sonnet") || modelLower.includes("5.4")
    ? "subagent:complex"
    : "subagent:default";

  const byRole: ByRoleEntry[] = [
    {
      role,
      model: params.model,
      provider: params.provider,
      tasksExecuted: 1,
      durationMsTotal: params.durationMs,
      durationMsAvg: params.durationMs,
      inputTokens: params.usage.input,
      outputTokens: params.usage.output,
      cacheReadTokens: params.usage.cacheRead,
      reportedCostUsd: params.usage.cost,
      syntheticCostUsd: syntheticCost,
      costPerTask: syntheticCost,
      failureRate: params.outcome === "failed" ? 1 : 0,
      escalations: 0,
      contextPctAvg: (params.usage.input / getContextWindow(params.model)) * 100,
    },
  ];

  const record: BenchmarkRecord = {
    schemaVersion: 2 as 2,
    recordedAt: new Date().toISOString(),
    runType: "subagent",
    runId: params.runId,
    sessionFile: params.sessionFile,
    projectCwd: params.projectCwd,
    goal: params.goal.slice(0, 200),

    policy: {
      source: "merged",
      objectives: policy.objectives,
      budgetConfiguredUsd: 0,
    },

    outcome: params.outcome,
    durationMs: params.durationMs,
    reportedCostUsd: params.usage.cost,
    syntheticCostUsd: syntheticCost,
    effectiveCostUsd,
    budgetConsumedPct: 0,
    estimatedCostUsd: null,
    estimateAccuracyPct: null,
    estimateMethod: null,
    estimateSamples: null,

    tasks: { total: 1, done: params.outcome === "done" ? 1 : 0, failed: params.outcome === "failed" ? 1 : 0, subTasksSpawned: 0 },
    tokens: {
      inputTotal: params.usage.input,
      outputTotal: params.usage.output,
      cacheReadTotal: params.usage.cacheRead,
      cacheWriteTotal: params.usage.cacheWrite,
      totalTokens,
    },
    throughput: {
      tasksPerMinute: params.durationMs > 0 ? 1 / (params.durationMs / 60_000) : 0,
      tasksPerMinutePeak: 0,
      tokensPerSecond: params.durationMs > 0 ? totalTokens / (params.durationMs / 1000) : 0,
    },

    byRole,
    budgetAlerts: [],
    planning: null,
    routing: { escalations: 0, avgLatencyMsByRole: {} },
    experiment: null,
    env: {
      piVersion: params.piVersion,
      maxAnts: 1,
      workspaceMode: "shared",
      providerType: params.usage.cost === 0 ? "subscription" : "api-key",
    },
  };

  appendRecord(record);
}

// ═══════════════════════════════════════════════════════════════
// Leitura de benchmarks
// ═══════════════════════════════════════════════════════════════

export function loadBenchmarks(options?: {
  maxRecords?: number;
  runType?: "colony" | "subagent";
  projectCwd?: string;
}): BenchmarkRecord[] {
  const filePath = benchmarkFilePath();
  if (!fs.existsSync(filePath)) return [];

  const max = options?.maxRecords ?? 500;
  let records: BenchmarkRecord[] = [];

  try {
    const lines = fs.readFileSync(filePath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = JSON.parse(trimmed) as BenchmarkRecord;
        if (options?.runType && record.runType !== options.runType) continue;
        if (options?.projectCwd && record.projectCwd !== options.projectCwd) continue;
        records.push(record);
      } catch { /* skip linha corrompida */ }
    }
  } catch {
    return [];
  }

  // Retornar os N mais recentes
  return records.slice(-max);
}

export function loadBenchmarksByRole(
  role: string,
  model: string,
  minSamples = 1
): { costPerTask: number; inputPerTask: number; outputPerTask: number; samples: number } | null {
  const records = loadBenchmarks({ runType: "colony" });
  const entries: ByRoleEntry[] = [];

  for (const record of records) {
    for (const entry of record.byRole) {
      if (entry.role === role && entry.model === model) {
        entries.push(entry);
      }
    }
  }

  if (entries.length < minSamples) return null;

  const samples = entries.length;
  const costPerTask = entries.reduce((sum, e) => sum + e.costPerTask, 0) / samples;
  const inputPerTask = entries.reduce((sum, e) => sum + e.inputTokens, 0) /
    entries.reduce((sum, e) => sum + e.tasksExecuted, 0);
  const outputPerTask = entries.reduce((sum, e) => sum + e.outputTokens, 0) /
    entries.reduce((sum, e) => sum + e.tasksExecuted, 0);

  return { costPerTask, inputPerTask, outputPerTask, samples };
}

// ═══════════════════════════════════════════════════════════════
// Formatação
// ═══════════════════════════════════════════════════════════════

export function formatBenchmarkInline(record: BenchmarkRecord): string {
  const outcome = record.outcome === "done" ? "✅ done" : `❌ ${record.outcome}`;
  const dur = formatDuration(record.durationMs);
  const tasks = `${record.tasks.done}/${record.tasks.total}`;
  const providerType = record.env.providerType === "subscription" ? "(subscription)" : "(api-key)";

  const lines = [
    `📊 Benchmark — ${record.runId}`,
    "─".repeat(46),
    `Outcome: ${outcome}  |  Duração: ${dur}  |  Tasks: ${tasks}`,
    `Custo sintético: $${record.syntheticCostUsd.toFixed(2)}  |  Provider: $${record.reportedCostUsd.toFixed(2)} ${providerType}`,
  ];

  if (record.estimateAccuracyPct != null && record.estimatedCostUsd != null) {
    lines.push(
      `Estimativa: $${record.estimatedCostUsd.toFixed(2)} (${record.estimateAccuracyPct.toFixed(0)}% acurado)`
    );
  }

  lines.push(
    `Tokens: ${formatTokens(record.tokens.totalTokens)}  |  Throughput: ${record.throughput.tasksPerMinute.toFixed(1)} tasks/min`
  );

  if (record.byRole.length > 0) {
    lines.push("");
    lines.push("Por modelo:");
    for (const r of record.byRole) {
      const modelShort = r.model.split("/")[1] ?? r.model;
      const costStr = `$${r.costPerTask.toFixed(3)}`;
      const durStr = `${(r.durationMsAvg / 1000).toFixed(1)}s/task`;
      const ctxStr = `${r.contextPctAvg.toFixed(0)}% ctx`;
      lines.push(
        `  ${modelShort.padEnd(28)} ${costStr.padStart(7)} | ${r.tasksExecuted} tasks | ${durStr} | ${ctxStr}`
      );
    }
  }

  lines.push(`Registro salvo: ~/.pi/model-policy-benchmarks.jsonl`);
  return lines.join("\n");
}

export function formatBenchmarkSummary(records: BenchmarkRecord[]): string {
  if (records.length === 0) return "Nenhum benchmark registrado ainda.";

  // Agrupar por role+model
  const groups = new Map<
    string,
    { costs: number[]; latencies: number[]; fails: number; total: number }
  >();

  for (const record of records) {
    for (const entry of record.byRole) {
      const key = `${entry.role}|${entry.model}`;
      const existing = groups.get(key);
      if (existing) {
        existing.costs.push(entry.costPerTask);
        existing.latencies.push(entry.durationMsAvg);
        existing.fails += entry.failureRate;
        existing.total++;
      } else {
        groups.set(key, {
          costs: [entry.costPerTask],
          latencies: [entry.durationMsAvg],
          fails: entry.failureRate,
          total: 1,
        });
      }
    }
  }

  const lines = [
    `📊 Benchmark — últimos ${records.length} runs`,
    "─".repeat(60),
    "",
    "Por modelo:",
    `${"Role".padEnd(22)} ${"Modelo".padEnd(30)} $/task    Lat.     Fail  N`,
  ];

  for (const [key, data] of groups) {
    const [role, model] = key.split("|");
    const modelShort = (model ?? "").split("/")[1] ?? model ?? "";
    const avgCost = data.costs.reduce((a, b) => a + b, 0) / data.costs.length;
    const avgLat = data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length;
    const failRate = (data.fails / data.total * 100).toFixed(0);
    lines.push(
      `${(role ?? "").padEnd(22)} ${modelShort.padEnd(30)} ` +
      `$${avgCost.toFixed(3).padStart(7)} ${(avgLat / 1000).toFixed(1).padStart(5)}s  ${failRate.padStart(4)}%  ${data.total}`
    );
  }

  return lines.join("\n");
}
