/**
 * model-policy extension — shared types
 *
 * Este arquivo define TODAS as interfaces compartilhadas entre os módulos da extensão.
 * Deve ser estável antes de qualquer implementação de módulo.
 *
 * Importado por: config, pricing, injector, budget-guard, benchmark-recorder,
 *                handoff-doc, smart-budget, cost-estimator, pre-flight-planner,
 *                ab-testing, export
 */

// ═══════════════════════════════════════════════════════════════
// Policy — configuração declarativa de modelo por objetivo
// ═══════════════════════════════════════════════════════════════

/** Chaves de objetivo suportadas */
export type ObjectiveKey =
  | "swarm:scout"
  | "swarm:worker"
  | "swarm:soldier"
  | "swarm:design"
  | "swarm:backend"
  | "swarm:multimodal"
  | "swarm:review"
  | "subagent:default"
  | "subagent:complex"
  | "subagent:analysis"
  | "agent:default"
  | "agent:cheap"
  | "agent:analysis";

/** Mapeamento objetivo → modelo (ex: "anthropic/claude-sonnet-4.6") */
export type ObjectiveMap = Partial<Record<ObjectiveKey, string>>;

/** Configuração de budget para um tipo de execução */
export interface BudgetConfig {
  maxCostUsd: number;
  alerts: number[];          // thresholds em % (ex: [50, 75, 90, 95])
  timeoutOnGateSec: number;  // timeout do select() nos gates bloqueantes
  defaultActionOnTimeout: "stop" | "ignore" | "abort";
}

/** Configuração de planejamento pré-colony */
export interface PlanningConfig {
  enabled: boolean;
  level: "off" | "light" | "full";
  minTaskCount: number;
  requireFilesOnAllTasks: boolean;
  requireContextOnWorkers: boolean;
  requirePriorityOnAll: boolean;
}

/** Configuração de benchmark */
export interface BenchmarkConfig {
  enabled: boolean;
  maxEntries: number;
  inlineReport: boolean;
  subagentReport: boolean;
}

/** Configuração de experimento A/B para um role */
export interface ExperimentConfig {
  enabled: boolean;
  control: string;      // modelo controle
  variant: string;      // modelo variante
  splitPct: number;     // % de colony runs que usam variant (por run, não por task)
  minSamples: number;   // amostras mínimas por grupo antes de gerar relatório
  startedAt: string;    // ISO timestamp
}

/** Override de preço por modelo */
export interface ModelPricingOverride {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

/** Configuração de preços e derivação de cache */
export interface PricingConfig {
  cacheReadDiscount: number;     // desconto sobre input price (default: 0.90)
  cacheWriteMultiplier: number;  // multiplicador sobre input price (default: 1.25)
  overrides?: Record<string, ModelPricingOverride>;
}

/** Schema completo do model-policy.json */
export interface ModelPolicyFile {
  version: number;
  objectives?: ObjectiveMap;
  budgets?: {
    swarm?: Partial<BudgetConfig>;
    subagent?: Partial<BudgetConfig>;
  };
  planning?: Partial<PlanningConfig>;
  benchmark?: Partial<BenchmarkConfig>;
  experiments?: Record<string, Partial<ExperimentConfig>>;
  pricing?: Partial<PricingConfig>;
}

/** Policy resolvida após merge global → projeto */
export interface ResolvedPolicy {
  objectives: ObjectiveMap;
  budgets: {
    swarm: BudgetConfig;
    subagent: BudgetConfig;
  };
  planning: PlanningConfig;
  benchmark: BenchmarkConfig;
  experiments: Record<string, ExperimentConfig>;
  pricing: PricingConfig;
  /** Origem de cada chave (para /model-policy sem args) */
  _sources: {
    objectives: Record<string, "global" | "project">;
    budgets: { swarm: "global" | "project"; subagent: "global" | "project" };
    planning: "global" | "project";
    benchmark: "global" | "project";
  };
}

// ═══════════════════════════════════════════════════════════════
// Pricing — cálculo de custo sintético
// ═══════════════════════════════════════════════════════════════

/** Preços por modelo em USD por milhão de tokens */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

/** Tabela de preços mapeada por model id (ex: "anthropic/claude-sonnet-4.6") */
export type PricingTable = Record<string, ModelPricing>;

/** Tokens de uma chamada a um modelo */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

// ═══════════════════════════════════════════════════════════════
// Budget Guard — tracking de custo em runtime
// ═══════════════════════════════════════════════════════════════

/** Ação tomada quando um budget gate dispara */
export type BudgetGateAction =
  | "info"             // alerta informativo (50%, 75%)
  | "ignore"           // usuário escolheu continuar além do budget
  | "increase_budget"  // usuário aumentou o budget
  | "stop"             // colony parada + handoff gerado
  | "abort"            // colony abortada sem handoff
  | "timeout";         // timeout do select() — ação default aplicada

/** Registro de alerta disparado durante uma run */
export interface BudgetAlert {
  thresholdPct: number;
  triggeredAt: string;   // ISO timestamp
  action: BudgetGateAction;
  budgetBefore?: number;
  budgetAfter?: number;
}

/** Entry de tracking de budget em memória (por colonyRuntimeId) */
export interface ColonyBudgetEntry {
  colonyId: string;          // stableId (colony-xxx)
  runtimeId: string;         // runtimeId (c1, c2...)
  goal: string;              // primeiros 200 chars do goal
  syntheticCostUsd: number;
  reportedCostUsd: number;
  maxCostUsd: number;
  alertsFired: Set<number>;  // thresholds já disparados
  gateInProgress: boolean;   // anti-race-condition
  tasksTotal: number;
  tasksDone: number;
  startedAt: number;         // timestamp ms
  alerts: BudgetAlert[];     // histórico de alertas desta run
  pendingTasksEstimate?: PendingTasksEstimate;
}

/** Entry pendente: criado em tool_call, aguardando LAUNCHED signal */
export interface PendingBudgetEntry {
  maxCostUsd: number;
  goalHash: string;
  goal: string;
  createdAt: number;
}

/** Estimativa de custo para tasks pendentes (mostrada no gate 90%/95%) */
export interface PendingTasksEstimate {
  byRole: Array<{
    role: string;
    model: string;
    count: number;
    estimatedCostUsd: number;
    contextPctAvg: number;
  }>;
  totalEstimatedUsd: number;
  suggestedBudgetIncrease: number;
}

// ═══════════════════════════════════════════════════════════════
// Benchmark — métricas pós-execução
// ═══════════════════════════════════════════════════════════════

/** Breakdown de métricas por role dentro de uma run */
export interface ByRoleEntry {
  role: string;              // ex: "scout", "worker:backend", "soldier"
  model: string;             // ex: "anthropic/claude-sonnet-4.6"
  provider: string;          // ex: "anthropic"
  tasksExecuted: number;
  durationMsTotal: number;
  durationMsAvg: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reportedCostUsd: number;
  syntheticCostUsd: number;
  costPerTask: number;       // syntheticCostUsd / tasksExecuted
  failureRate: number;       // 0-1
  escalations: number;
  contextPctAvg: number;     // % média do context window usado
  experimentGroup?: "control" | "variant";
}

/** Dados de experimento A/B no nível da run */
export interface RunExperiment {
  role: string;              // ex: "swarm:worker"
  group: "control" | "variant";
  experimentId: string;      // ex: "swarm:worker-2026-04-17"
  controlModel: string;
  variantModel: string;
}

/** Schema completo de um registro de benchmark (uma linha do .jsonl) */
export interface BenchmarkRecord {
  schemaVersion: 2;
  recordedAt: string;        // ISO timestamp
  runType: "colony" | "subagent";
  runId: string;
  sessionFile: string;
  projectCwd: string;
  goal: string;              // primeiros 200 chars

  policy: {
    source: "global" | "project" | "merged";
    objectives: ObjectiveMap;
    budgetConfiguredUsd: number;
  };

  outcome: "done" | "failed" | "budget_exceeded" | "aborted";
  durationMs: number;
  reportedCostUsd: number;
  syntheticCostUsd: number;
  effectiveCostUsd: number;  // max(reported, synthetic)
  budgetConsumedPct: number;
  estimatedCostUsd: number | null;
  estimateAccuracyPct: number | null;
  estimateMethod: "historical" | "heuristic" | null;
  estimateSamples: number | null;

  tasks: {
    total: number;
    done: number;
    failed: number;
    subTasksSpawned: number;
  };

  tokens: {
    inputTotal: number;
    outputTotal: number;
    cacheReadTotal: number;
    cacheWriteTotal: number;
    totalTokens: number;
  };

  throughput: {
    tasksPerMinute: number;
    tasksPerMinutePeak: number;
    tokensPerSecond: number;
  };

  byRole: ByRoleEntry[];
  budgetAlerts: BudgetAlert[];

  planning: {
    level: "off" | "light" | "full";
    goalEnriched: boolean;
    qualityGatePassed: boolean;
    tasksAtPlanTime: number | null;
    tasksActual: number;
  } | null;

  routing: {
    escalations: number;
    avgLatencyMsByRole: Record<string, number>;
  };

  experiment: RunExperiment | null;

  env: {
    piVersion: string;
    maxAnts: number;
    workspaceMode: "worktree" | "shared";
    providerType: "subscription" | "api-key";
  };
}

// ═══════════════════════════════════════════════════════════════
// Cost Estimator — estimativa por task
// ═══════════════════════════════════════════════════════════════

/** Resultado da estimativa para uma task individual */
export interface TaskEstimate {
  role: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  contextPct: number;
  confidence: "high" | "low";
  method: "historical" | "heuristic";
  samples: number;
}

/** Estimativa agregada do plano completo (pós-scout) */
export interface PlanEstimate {
  totalCostUsd: number;
  rangeLowUsd: number;
  rangeHighUsd: number;
  budgetConfiguredUsd: number;
  budgetConsumedPct: number;
  tasks: TaskEstimate[];
  byRole: Array<{
    role: string;
    model: string;
    count: number;
    totalCostUsd: number;
    avgContextPct: number;
  }>;
  overallConfidence: "high" | "low";
  method: "historical" | "heuristic" | "mixed";
  samplesUsed: number;
}

// ═══════════════════════════════════════════════════════════════
// Handoff — documento de retomada de colony
// ═══════════════════════════════════════════════════════════════

/** Dados necessários para gerar o documento de handoff */
export interface HandoffContext {
  colonyId: string;
  goal: string;
  budgetEntry: ColonyBudgetEntry;
  tasksCompleted: HandoffTask[];
  tasksPending: HandoffTask[];
  pheromones: string;          // texto das últimas pheromones relevantes
  pendingEstimate: PendingTasksEstimate | null;
  stateFilePath: string;
  projectCwd: string;
}

/** Representação simplificada de uma task para o handoff */
export interface HandoffTask {
  id: string;
  title: string;
  caste: string;
  workerClass?: string;
  priority: number;
  files: string[];
  status: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  error?: string;
  estimatedCostUsd?: number;
}

// ═══════════════════════════════════════════════════════════════
// A/B Testing — comparação de modelos
// ═══════════════════════════════════════════════════════════════

/** Estatísticas de um grupo (control ou variant) */
export interface ABStats {
  group: "control" | "variant";
  model: string;
  samples: number;
  costPerTaskMean: number;
  costPerTaskStd: number;
  durationMsMean: number;
  durationMsStd: number;
  failureRate: number;
  tokensPerTask: number;
  contextPctMean: number;
}

/** Resultado de um A/B test completo */
export interface ABTestResult {
  role: string;
  experimentId: string;
  control: ABStats;
  variant: ABStats;
  recommendation: "control" | "variant" | "inconclusive";
  reasoning: string;
  completedAt: string;  // ISO timestamp
}

// ═══════════════════════════════════════════════════════════════
// Smart Budget — sugestão automática de budgets
// ═══════════════════════════════════════════════════════════════

/** Sugestão de budget para um tipo de execução */
export interface BudgetSuggestionItem {
  maxCostUsd: number;
  meanCost: number;
  p90Cost: number;
  p99Cost: number;
  maxObserved: number;
  samples: number;
  coveragePct: number;   // % dos runs históricos cobertos pelo valor sugerido
  reasoning: string;
}

/** Sugestão completa de budgets para um projeto */
export interface SmartBudgetSuggestion {
  swarm: BudgetSuggestionItem;
  subagent: BudgetSuggestionItem;
  suggestedObjectives: ObjectiveMap;  // modelos com melhor custo-benefício histórico
  basedOnSamples: { colony: number; subagent: number };
  generatedAt: string;
}

// ═══════════════════════════════════════════════════════════════
// Eventos internos do event bus
// ═══════════════════════════════════════════════════════════════

/** Payload do evento "usage:record" emitido pelo ant-colony */
export interface AntUsageRecord {
  source: "ant-colony";
  scope: "sync" | "background";
  workspaceMode: "shared" | "worktree";
  colonyRuntimeId: string | null;
  colonyId: string | null;
  antId: string;
  caste: string;
  taskId: string;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    costTotal: number;
  };
}

/** Payload do evento "model-policy:colony-budget" para comunicação interna */
export interface ColonyBudgetEvent {
  runtimeId: string;
  pctUsed: number;
  effectiveCostUsd: number;
  maxCostUsd: number;
  tasksTotal: number;
  tasksDone: number;
}
