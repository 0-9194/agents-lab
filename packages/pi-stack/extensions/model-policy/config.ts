/**
 * model-policy — config.ts
 *
 * Leitura, validação e merge de model-policy.json (global → projeto).
 * Expõe getResolvedPolicy() usado por todos os módulos da extensão.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  ModelPolicyFile,
  ResolvedPolicy,
  ObjectiveMap,
  BudgetConfig,
  PlanningConfig,
  BenchmarkConfig,
  ExperimentConfig,
  PricingConfig,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════
// Defaults
// ═══════════════════════════════════════════════════════════════

const DEFAULT_BUDGET_SWARM: BudgetConfig = {
  maxCostUsd: 2.00,
  alerts: [50, 75, 90, 95],
  timeoutOnGateSec: 30,
  defaultActionOnTimeout: "stop",
};

const DEFAULT_BUDGET_SUBAGENT: BudgetConfig = {
  maxCostUsd: 0.10,
  alerts: [50, 75, 90, 95],
  timeoutOnGateSec: 30,
  defaultActionOnTimeout: "stop",
};

const DEFAULT_PLANNING: PlanningConfig = {
  enabled: true,
  level: "light",
  minTaskCount: 3,
  requireFilesOnAllTasks: true,
  requireContextOnWorkers: true,
  requirePriorityOnAll: true,
};

const DEFAULT_BENCHMARK: BenchmarkConfig = {
  enabled: true,
  maxEntries: 10000,
  inlineReport: true,
  subagentReport: false,
};

const DEFAULT_PRICING: PricingConfig = {
  cacheReadDiscount: 0.90,
  cacheWriteMultiplier: 1.25,
};

const DEFAULT_OBJECTIVES: ObjectiveMap = {
  "swarm:scout":      "google/gemini-2.5-flash-lite",
  "swarm:worker":     "anthropic/claude-sonnet-4.6",
  "swarm:soldier":    "anthropic/claude-haiku-4.5",
  "swarm:design":     "google/gemini-3.1-pro",
  "swarm:backend":    "anthropic/claude-sonnet-4.6",
  "swarm:multimodal": "google/gemini-3.1-pro",
  "swarm:review":     "anthropic/claude-haiku-4.5",
  "subagent:default":  "anthropic/claude-haiku-4.5",
  "subagent:complex":  "anthropic/claude-sonnet-4.6",
  "subagent:analysis": "google/gemini-2.5-pro",
  "agent:default":   "anthropic/claude-sonnet-4.6",
  "agent:cheap":     "anthropic/claude-haiku-4.5",
  "agent:analysis":  "google/gemini-2.5-pro",
};

// ═══════════════════════════════════════════════════════════════
// Paths
// ═══════════════════════════════════════════════════════════════

export function globalPolicyPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "model-policy.json");
}

export function projectPolicyPath(cwd: string): string {
  return path.join(cwd, ".pi", "model-policy.json");
}

// ═══════════════════════════════════════════════════════════════
// Leitura e parse
// ═══════════════════════════════════════════════════════════════

function readPolicyFile(filePath: string): ModelPolicyFile | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ModelPolicyFile;
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Merge global → projeto (deep merge por chave individual)
// ═══════════════════════════════════════════════════════════════

function mergeBudget(
  base: BudgetConfig,
  override?: Partial<BudgetConfig>
): BudgetConfig {
  if (!override) return base;
  return {
    maxCostUsd: override.maxCostUsd ?? base.maxCostUsd,
    // Arrays são substituídos inteiramente, nunca merged
    alerts: override.alerts ?? base.alerts,
    timeoutOnGateSec: override.timeoutOnGateSec ?? base.timeoutOnGateSec,
    defaultActionOnTimeout:
      override.defaultActionOnTimeout ?? base.defaultActionOnTimeout,
  };
}

function mergePlanning(
  base: PlanningConfig,
  override?: Partial<PlanningConfig>
): PlanningConfig {
  if (!override) return base;
  return { ...base, ...override };
}

function mergeBenchmark(
  base: BenchmarkConfig,
  override?: Partial<BenchmarkConfig>
): BenchmarkConfig {
  if (!override) return base;
  return { ...base, ...override };
}

function mergePricing(
  base: PricingConfig,
  override?: Partial<PricingConfig>
): PricingConfig {
  if (!override) return base;
  return {
    cacheReadDiscount:
      override.cacheReadDiscount ?? base.cacheReadDiscount,
    cacheWriteMultiplier:
      override.cacheWriteMultiplier ?? base.cacheWriteMultiplier,
    overrides: override.overrides
      ? { ...(base.overrides ?? {}), ...override.overrides }
      : base.overrides,
  };
}

function mergeExperiments(
  base: Record<string, ExperimentConfig>,
  override?: Record<string, Partial<ExperimentConfig>>
): Record<string, ExperimentConfig> {
  if (!override) return base;
  const result = { ...base };
  for (const [role, exp] of Object.entries(override)) {
    if (base[role]) {
      result[role] = { ...base[role], ...exp };
    } else {
      // Nova entrada: preencher defaults obrigatórios
      result[role] = {
        enabled: exp.enabled ?? false,
        control: exp.control ?? "",
        variant: exp.variant ?? "",
        splitPct: exp.splitPct ?? 20,
        minSamples: exp.minSamples ?? 10,
        startedAt: exp.startedAt ?? new Date().toISOString(),
      };
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// Resolução da policy (singleton por sessão)
// ═══════════════════════════════════════════════════════════════

let _resolved: ResolvedPolicy | null = null;
let _resolvedCwd: string | null = null;

/**
 * Carrega e faz merge da policy global + projeto.
 * Deve ser chamado em session_start. Cacheia o resultado em memória.
 */
export function loadConfig(cwd: string): ResolvedPolicy {
  // Re-resolver se o cwd mudou (ex: /new session em outro projeto)
  if (_resolved && _resolvedCwd === cwd) return _resolved;

  const globalFile = readPolicyFile(globalPolicyPath());
  const projectFile = readPolicyFile(projectPolicyPath(cwd));

  // Rastrear origem de cada chave (para /model-policy sem args)
  const sources: ResolvedPolicy["_sources"] = {
    objectives: {} as Record<string, "global" | "project">,
    budgets: { swarm: "global", subagent: "global" },
    planning: "global",
    benchmark: "global",
  };

  // Objectives — merge chave a chave
  const globalObjectives: ObjectiveMap = {
    ...DEFAULT_OBJECTIVES,
    ...(globalFile?.objectives ?? {}),
  };
  const projectObjectives: ObjectiveMap = projectFile?.objectives ?? {};
  const mergedObjectives: ObjectiveMap = { ...globalObjectives };

  for (const key of Object.keys(globalObjectives) as Array<keyof ObjectiveMap>) {
    sources.objectives[key] = "global";
  }
  for (const [key, val] of Object.entries(projectObjectives)) {
    (mergedObjectives as Record<string, string>)[key] = val;
    sources.objectives[key] = "project";
  }

  // Budgets
  const globalSwarm = mergeBudget(
    DEFAULT_BUDGET_SWARM,
    globalFile?.budgets?.swarm
  );
  const globalSubagent = mergeBudget(
    DEFAULT_BUDGET_SUBAGENT,
    globalFile?.budgets?.subagent
  );
  const swarm = mergeBudget(globalSwarm, projectFile?.budgets?.swarm);
  const subagent = mergeBudget(globalSubagent, projectFile?.budgets?.subagent);
  if (projectFile?.budgets?.swarm) sources.budgets.swarm = "project";
  if (projectFile?.budgets?.subagent) sources.budgets.subagent = "project";

  // Planning
  const globalPlanning = mergePlanning(
    DEFAULT_PLANNING,
    globalFile?.planning
  );
  const planning = mergePlanning(globalPlanning, projectFile?.planning);
  if (projectFile?.planning) sources.planning = "project";

  // Benchmark
  const globalBenchmark = mergeBenchmark(
    DEFAULT_BENCHMARK,
    globalFile?.benchmark
  );
  const benchmark = mergeBenchmark(globalBenchmark, projectFile?.benchmark);
  if (projectFile?.benchmark) sources.benchmark = "project";

  // Pricing
  const globalPricing = mergePricing(DEFAULT_PRICING, globalFile?.pricing);
  const pricing = mergePricing(globalPricing, projectFile?.pricing);

  // Experiments
  const globalExps = globalFile?.experiments
    ? mergeExperiments({}, globalFile.experiments as Record<string, Partial<ExperimentConfig>>)
    : {};
  const experiments = projectFile?.experiments
    ? mergeExperiments(globalExps, projectFile.experiments as Record<string, Partial<ExperimentConfig>>)
    : globalExps;

  _resolved = {
    objectives: mergedObjectives,
    budgets: { swarm, subagent },
    planning,
    benchmark,
    experiments,
    pricing,
    _sources: sources,
  };
  _resolvedCwd = cwd;

  return _resolved;
}

/** Retorna a policy resolvida em cache. Lança se loadConfig não foi chamado. */
export function getResolvedPolicy(): ResolvedPolicy {
  if (!_resolved) {
    throw new Error(
      "model-policy: getResolvedPolicy() chamado antes de loadConfig(). " +
      "Verifique que session_start inicializou a extensão."
    );
  }
  return _resolved;
}

/** Invalida o cache (usado em testes ou ao editar policy em runtime). */
export function invalidateConfig(): void {
  _resolved = null;
  _resolvedCwd = null;
}

/**
 * Escreve ou atualiza o model-policy.json do projeto.
 * Cria o diretório .pi/ se necessário.
 */
export function writeProjectPolicy(
  cwd: string,
  patch: Partial<ModelPolicyFile>
): void {
  const filePath = projectPolicyPath(cwd);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const existing = readPolicyFile(filePath) ?? { version: 1 };
  const merged: ModelPolicyFile = {
    ...existing,
    ...patch,
    version: 1,
  };

  const tmpPath = filePath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  fs.renameSync(tmpPath, filePath);

  // Invalidar cache para forçar re-leitura
  invalidateConfig();
}

/**
 * Formata a policy resolvida para exibição no comando /model-policy.
 */
export function formatPolicyReport(policy: ResolvedPolicy): string {
  const lines: string[] = [
    "╭─ Model Policy (resolvida) ──────────────────────────────",
    "│",
    "│ Objectives:",
  ];

  for (const [key, model] of Object.entries(policy.objectives)) {
    const src = policy._sources.objectives[key] ?? "global";
    const tag = src === "project" ? " [projeto]" : "";
    lines.push(`│   ${key.padEnd(22)} → ${model}${tag}`);
  }

  lines.push("│");
  lines.push("│ Budgets:");

  const swarmSrc = policy._sources.budgets.swarm === "project" ? " [projeto]" : "";
  const subSrc = policy._sources.budgets.subagent === "project" ? " [projeto]" : "";
  lines.push(`│   swarm.maxCostUsd     $${policy.budgets.swarm.maxCostUsd.toFixed(2)}${swarmSrc}`);
  lines.push(`│   swarm.alerts         [${policy.budgets.swarm.alerts.join(", ")}]%`);
  lines.push(`│   subagent.maxCostUsd  $${policy.budgets.subagent.maxCostUsd.toFixed(2)}${subSrc}`);

  lines.push("│");
  const plSrc = policy._sources.planning === "project" ? " [projeto]" : "";
  lines.push(`│ Planning: level=${policy.planning.level}, enabled=${policy.planning.enabled}${plSrc}`);

  const bkSrc = policy._sources.benchmark === "project" ? " [projeto]" : "";
  lines.push(`│ Benchmark: enabled=${policy.benchmark.enabled}, maxEntries=${policy.benchmark.maxEntries}${bkSrc}`);

  const expKeys = Object.keys(policy.experiments);
  if (expKeys.length > 0) {
    lines.push("│");
    lines.push("│ Experiments:");
    for (const role of expKeys) {
      const exp = policy.experiments[role];
      lines.push(`│   ${role}: ${exp.control} vs ${exp.variant} (${exp.splitPct}% variant, enabled=${exp.enabled})`);
    }
  }

  lines.push("╰────────────────────────────────────────────────────────");
  return lines.join("\n");
}
