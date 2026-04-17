/**
 * model-policy — injector.ts
 *
 * Intercepta tool_call de ant_colony e subagent, injetando modelOverrides
 * e maxCost definidos na policy resolvida. Respeita valores explícitos
 * passados pelo usuário (não sobrescreve o que já foi definido).
 */
import type { ResolvedPolicy } from "./types.js";

// ═══════════════════════════════════════════════════════════════
// Tipos dos inputs das tools (subset dos campos que nos interessam)
// ═══════════════════════════════════════════════════════════════

interface AntColonyInput {
  goal?: string;
  maxAnts?: number;
  maxCost?: number | null;
  scoutModel?: string;
  workerModel?: string;
  soldierModel?: string;
  designWorkerModel?: string;
  multimodalWorkerModel?: string;
  backendWorkerModel?: string;
  reviewWorkerModel?: string;
  [key: string]: unknown;
}

interface SubagentTaskInput {
  model?: string;
  [key: string]: unknown;
}

interface SubagentInput {
  model?: string;
  tasks?: SubagentTaskInput[];
  chain?: SubagentTaskInput[];
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════
// Injeção em ant_colony
// ═══════════════════════════════════════════════════════════════

/**
 * Muta event.input para ant_colony injetando modelOverrides e maxCost
 * da policy. Só injeta onde o usuário não passou valor explícito.
 *
 * Retorna um log dos campos injetados (para debug/audit).
 */
export function injectAntColonyOverrides(
  input: AntColonyInput,
  policy: ResolvedPolicy
): string[] {
  const injected: string[] = [];
  const obj = policy.objectives;

  // ── Model overrides por caste / workerClass ───────────────────
  const colonyFields: Array<{
    inputField: keyof AntColonyInput;
    objectiveKey: keyof typeof obj;
  }> = [
    { inputField: "scoutModel",          objectiveKey: "swarm:scout"      },
    { inputField: "workerModel",         objectiveKey: "swarm:worker"     },
    { inputField: "soldierModel",        objectiveKey: "swarm:soldier"    },
    { inputField: "designWorkerModel",   objectiveKey: "swarm:design"     },
    { inputField: "backendWorkerModel",  objectiveKey: "swarm:backend"    },
    { inputField: "multimodalWorkerModel", objectiveKey: "swarm:multimodal" },
    { inputField: "reviewWorkerModel",   objectiveKey: "swarm:review"     },
  ];

  for (const { inputField, objectiveKey } of colonyFields) {
    // Só injeta se: (1) não foi passado pelo usuário E (2) policy tem valor
    const alreadySet =
      input[inputField] !== undefined && input[inputField] !== null && input[inputField] !== "";
    const policyValue = obj[objectiveKey];

    if (!alreadySet && policyValue) {
      (input as Record<string, unknown>)[inputField] = policyValue;
      injected.push(`${inputField}=${policyValue}`);
    }
  }

  // ── maxCost ───────────────────────────────────────────────────
  const maxCostNotSet = input.maxCost === undefined || input.maxCost === null;
  if (maxCostNotSet && policy.budgets.swarm.maxCostUsd > 0) {
    input.maxCost = policy.budgets.swarm.maxCostUsd;
    injected.push(`maxCost=${policy.budgets.swarm.maxCostUsd}`);
  }

  return injected;
}

// ═══════════════════════════════════════════════════════════════
// Injeção em subagent
// ═══════════════════════════════════════════════════════════════

/**
 * Muta event.input para subagent injetando o modelo default.
 * Para single/parallel, injeta em `model`.
 * Para chain, injeta em cada step sem modelo definido.
 * Para parallel tasks, injeta em cada task sem modelo definido.
 *
 * Retorna um log dos campos injetados.
 */
export function injectSubagentOverrides(
  input: SubagentInput,
  policy: ResolvedPolicy
): string[] {
  const injected: string[] = [];
  const defaultModel = policy.objectives["subagent:default"];

  if (!defaultModel) return injected;

  // ── Single mode: campo `model` top-level ──────────────────────
  if (input.model === undefined || input.model === null || input.model === "") {
    // Só injeta se não é parallel nem chain (esses têm tasks/chain)
    if (!input.tasks && !input.chain) {
      input.model = defaultModel;
      injected.push(`model=${defaultModel}`);
    }
  }

  // ── Parallel mode: tasks[] ────────────────────────────────────
  if (Array.isArray(input.tasks)) {
    for (let i = 0; i < input.tasks.length; i++) {
      const task = input.tasks[i];
      if (task && (task.model === undefined || task.model === null || task.model === "")) {
        task.model = defaultModel;
        injected.push(`tasks[${i}].model=${defaultModel}`);
      }
    }
  }

  // ── Chain mode: chain[] ───────────────────────────────────────
  if (Array.isArray(input.chain)) {
    for (let i = 0; i < input.chain.length; i++) {
      const step = input.chain[i];
      if (step && (step.model === undefined || step.model === null || step.model === "")) {
        step.model = defaultModel;
        injected.push(`chain[${i}].model=${defaultModel}`);
      }
    }
  }

  return injected;
}

// ═══════════════════════════════════════════════════════════════
// A/B testing: modificação de override conforme experimento ativo
// ═══════════════════════════════════════════════════════════════

/**
 * Aplica split de experimento A/B a um campo de model override.
 * O split é por colony run (não por task individual).
 * Deve ser chamado APÓS injectAntColonyOverrides.
 *
 * Retorna o grupo atribuído ("control" | "variant") ou null se
 * não há experimento ativo para o role.
 */
export function applyExperimentSplit(
  input: AntColonyInput,
  policy: ResolvedPolicy,
  /** Callback para registrar o grupo atribuído (budget-guard usa isso) */
  onSplit?: (role: string, group: "control" | "variant", model: string) => void
): void {
  const experiments = policy.experiments;
  if (!experiments || Object.keys(experiments).length === 0) return;

  // Mapeamento role → campo no input
  const roleToField: Record<string, keyof AntColonyInput> = {
    "swarm:scout":      "scoutModel",
    "swarm:worker":     "workerModel",
    "swarm:soldier":    "soldierModel",
    "swarm:design":     "designWorkerModel",
    "swarm:backend":    "backendWorkerModel",
    "swarm:multimodal": "multimodalWorkerModel",
    "swarm:review":     "reviewWorkerModel",
  };

  for (const [role, exp] of Object.entries(experiments)) {
    if (!exp.enabled) continue;

    const field = roleToField[role];
    if (!field) continue;

    // Sortear grupo: splitPct % de chance de ser variant
    const group: "control" | "variant" =
      Math.random() * 100 < exp.splitPct ? "variant" : "control";

    const model = group === "variant" ? exp.variant : exp.control;

    // Sobrescrever o modelo injetado pela policy base
    (input as Record<string, unknown>)[field] = model;

    onSplit?.(role, group, model);
  }
}

// ═══════════════════════════════════════════════════════════════
// Hash de goal (para vincular pendingBudget → LAUNCHED signal)
// ═══════════════════════════════════════════════════════════════

/**
 * Hash simples do goal para correlacionar tool_call com LAUNCHED signal.
 * Não precisa ser criptográfico — só deve ser consistente e rápido.
 */
export function hashGoal(goal: string): string {
  let h = 0;
  for (let i = 0; i < Math.min(goal.length, 200); i++) {
    h = (Math.imul(31, h) + goal.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}
