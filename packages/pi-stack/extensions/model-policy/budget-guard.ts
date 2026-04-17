/**
 * model-policy — budget-guard.ts
 *
 * Rastreamento de custo de colony runs em 3 fases e alertas de budget.
 * Fase 1: tool_call → pendingBudgets (aguarda runtimeId)
 * Fase 2: message_end LAUNCHED → colonyBudgets (vincula runtimeId)
 * Fase 3: usage:record → acumula custo sintético, dispara thresholds
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type {
  ColonyBudgetEntry,
  PendingBudgetEntry,
  BudgetAlert,
  BudgetGateAction,
  PendingTasksEstimate,
  AntUsageRecord,
  ResolvedPolicy,
  TokenUsage,
} from "./types.js";
import { getPricing, calculateSyntheticCost } from "./pricing.js";
import { getResolvedPolicy } from "./config.js";
import { hashGoal } from "./injector.js";

// ═══════════════════════════════════════════════════════════════
// Estado em memória
// ═══════════════════════════════════════════════════════════════

/** Entry pendente: criado em tool_call, aguardando LAUNCHED signal */
export const pendingBudgets = new Map<string, PendingBudgetEntry>();

/** Entry ativo: criado quando LAUNCHED signal é recebido */
export const colonyBudgets = new Map<string, ColonyBudgetEntry>();

// Regex para parsear LAUNCHED signal — não dinâmico, sem risco de ReDoS
const LAUNCHED_RE = /\[COLONY_SIGNAL:LAUNCHED\]\s*\[([^\]]+)\]/i;

// ═══════════════════════════════════════════════════════════════
// Fase 1 — Registrar budget pendente no tool_call
// ═══════════════════════════════════════════════════════════════

/**
 * Chamado em tool_call(ant_colony) pelo index.ts.
 * O runtimeId não existe ainda — armazenamos por hash(goal).
 */
export function registerPendingBudget(goal: string, maxCostUsd: number): void {
  const goalHash = hashGoal(goal);
  pendingBudgets.set(goalHash, {
    maxCostUsd,
    goalHash,
    goal: goal.slice(0, 200),
    createdAt: Date.now(),
  });

  // Limpar pendentes com mais de 5 minutos (evitar vazamentos)
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [key, entry] of pendingBudgets) {
    if (entry.createdAt < cutoff) pendingBudgets.delete(key);
  }
}

// ═══════════════════════════════════════════════════════════════
// Fase 2 — Vincular runtimeId ao pending em message_end
// ═══════════════════════════════════════════════════════════════

/**
 * Chamado em message_end pelo index.ts.
 * Parseia o COLONY_SIGNAL:LAUNCHED e vincula ao PendingBudgetEntry.
 * Texto esperado: "[COLONY_SIGNAL:LAUNCHED] [c1]\n...Goal: <goal>..."
 */
export function tryRegisterLaunched(text: string): void {
  const match = LAUNCHED_RE.exec(text);
  if (!match) return;

  const runtimeId = match[1].trim();
  if (!runtimeId) return;

  // Extrair goal da mensagem para correlacionar com pendingBudgets
  // Formato: "Goal: <texto do goal>"
  const goalLineStart = text.indexOf("Goal: ");
  const goal = goalLineStart !== -1
    ? text.slice(goalLineStart + 6).split("\n")[0]?.trim() ?? ""
    : "";

  const goalHash = hashGoal(goal);
  const pending = pendingBudgets.get(goalHash);

  // Se não encontrar por hash exato, tentar o mais recente (fallback)
  const effectivePending = pending ?? getLatestPending();
  if (!effectivePending) return;

  pendingBudgets.delete(effectivePending.goalHash);

  colonyBudgets.set(runtimeId, {
    colonyId: runtimeId,  // será atualizado com stableId quando disponível
    runtimeId,
    goal: goal || effectivePending.goal,
    syntheticCostUsd: 0,
    reportedCostUsd: 0,
    maxCostUsd: effectivePending.maxCostUsd,
    alertsFired: new Set(),
    gateInProgress: false,
    tasksTotal: 0,
    tasksDone: 0,
    startedAt: Date.now(),
    alerts: [],
  });
}

function getLatestPending(): PendingBudgetEntry | null {
  if (pendingBudgets.size === 0) return null;
  let latest: PendingBudgetEntry | null = null;
  for (const entry of pendingBudgets.values()) {
    if (!latest || entry.createdAt > latest.createdAt) latest = entry;
  }
  return latest;
}

// ═══════════════════════════════════════════════════════════════
// Fase 3 — Acumular custo via usage:record
// ═══════════════════════════════════════════════════════════════

/**
 * Chamado pelo pi.events.on("usage:record") no index.ts.
 * Acumula custo sintético e verifica thresholds.
 */
export function processUsageRecord(data: AntUsageRecord, pi: ExtensionAPI): void {
  if (data.source !== "ant-colony") return;
  if (!data.colonyRuntimeId) return;

  const budget = colonyBudgets.get(data.colonyRuntimeId);
  if (!budget || budget.gateInProgress) return;

  // Acumular tokens
  const tokens: TokenUsage = {
    input: data.usage.input,
    output: data.usage.output,
    cacheRead: data.usage.cacheRead,
    cacheWrite: data.usage.cacheWrite,
  };

  const pricing = getPricing(data.model);
  const synCost = calculateSyntheticCost(tokens, pricing);
  budget.syntheticCostUsd += synCost;
  budget.reportedCostUsd += data.usage.costTotal;

  // Custo efetivo: usar sintético quando provider é subscription (cost=0)
  const effectiveCost =
    budget.reportedCostUsd > 0 ? budget.reportedCostUsd : budget.syntheticCostUsd;

  if (budget.maxCostUsd <= 0) return;
  const pct = (effectiveCost / budget.maxCostUsd) * 100;

  checkThresholds(budget, pct, effectiveCost, pi);
}

function checkThresholds(
  budget: ColonyBudgetEntry,
  pct: number,
  effectiveCost: number,
  pi: ExtensionAPI
): void {
  let policy: ResolvedPolicy;
  try {
    policy = getResolvedPolicy();
  } catch {
    return; // Policy ainda não carregada
  }

  const alertThresholds = policy.budgets.swarm.alerts;

  for (const threshold of alertThresholds) {
    if (pct < threshold) continue;
    if (budget.alertsFired.has(threshold)) continue;

    // Para 95%: só disparar se usuário escolheu "ignorar" no 90%
    if (threshold === 95) {
      const alert90 = budget.alerts.find(a => a.thresholdPct === 90);
      if (!alert90 || alert90.action !== "ignore") continue;
    }

    budget.alertsFired.add(threshold);
    const alert: BudgetAlert = {
      thresholdPct: threshold,
      triggeredAt: new Date().toISOString(),
      action: "info",
    };
    budget.alerts.push(alert);

    if (threshold <= 75) {
      // Alerta informativo — não bloqueia
      const progressText = budget.tasksTotal > 0
        ? ` | ${budget.tasksTotal > 0 ? `${budget.tasksDone}/${budget.tasksTotal} tasks` : ""}`
        : "";
      pi.sendMessage(
        {
          customType: "model-policy-budget-alert",
          content:
            `[⚠️ Budget ${threshold}%] Colony ${budget.runtimeId}: ` +
            `$${effectiveCost.toFixed(2)} / $${budget.maxCostUsd.toFixed(2)} (sintético)` +
            progressText,
          display: true,
        },
        { triggerTurn: false, deliverAs: "followUp" }
      );
    } else {
      // Gate bloqueante (90% ou 95%) — parar colony e acionar decisão
      budget.gateInProgress = true;
      alert.action = "stop"; // default, atualizado após decisão do usuário

      // Etapa 1: parar colony via steer (mais rápido que followUp)
      pi.sendUserMessage(`/colony-stop ${budget.runtimeId}`, { deliverAs: "steer" });

      // Etapa 2: injetar mensagem que triggeriza a tool de decisão
      pi.sendMessage(
        {
          customType: "model-policy-budget-gate",
          content:
            `[MODEL_POLICY:BUDGET_GATE] colony ${budget.runtimeId} at ${threshold}%\n` +
            `Consumido: $${effectiveCost.toFixed(2)} / $${budget.maxCostUsd.toFixed(2)} (${threshold.toFixed(1)}%)\n` +
            `Progresso: ${budget.tasksDone}/${budget.tasksTotal} tasks\n\n` +
            `Chame a tool model_policy_budget_decision com colonyId="${budget.runtimeId}" ` +
            `e pctUsed=${threshold} para apresentar as opções ao usuário.`,
          display: true,
        },
        { triggerTurn: true, deliverAs: "followUp" }
      );
    }

    // Só disparar um threshold por vez
    break;
  }
}

// ═══════════════════════════════════════════════════════════════
// Tool: model_policy_budget_decision
// ═══════════════════════════════════════════════════════════════

export async function executeBudgetDecision(
  params: { colonyId: string; pctUsed: number },
  ctx: ExtensionContext
): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
  const budget = colonyBudgets.get(params.colonyId);
  if (!budget) {
    return {
      content: [{ type: "text", text: `Budget gate: colony ${params.colonyId} não encontrada.` }],
      details: {},
    };
  }

  let policy: ResolvedPolicy;
  try {
    policy = getResolvedPolicy();
  } catch {
    return {
      content: [{ type: "text", text: "Budget gate: policy não carregada." }],
      details: {},
    };
  }

  const effectiveCost =
    budget.reportedCostUsd > 0 ? budget.reportedCostUsd : budget.syntheticCostUsd;
  const timeoutMs = policy.budgets.swarm.timeoutOnGateSec * 1000;

  // Estimar custo das tasks pendentes
  const pendingEstimate = estimatePendingTasks(budget, policy);
  const suggestedBudget = budget.maxCostUsd + pendingEstimate.suggestedBudgetIncrease;

  // Construir resumo de tasks pendentes para o UI
  const pendingLines = pendingEstimate.byRole
    .map(r => `  ${r.role} ×${r.count}  →  ~$${r.estimatedCostUsd.toFixed(2)}  (${r.contextPctAvg.toFixed(0)}% ctx)`)
    .join("\n");

  const title =
    `🛑 Budget ${params.pctUsed}% — Colony ${params.colonyId}\n` +
    `Consumido: $${effectiveCost.toFixed(2)} / $${budget.maxCostUsd.toFixed(2)}\n` +
    `Progresso: ${budget.tasksDone}/${budget.tasksTotal} tasks\n` +
    (pendingLines ? `\nTasks pendentes:\n${pendingLines}\n  Total adicional: ~$${pendingEstimate.totalEstimatedUsd.toFixed(2)}` : "");

  // Opções variam conforme o threshold (95% não tem opção "ignorar")
  const is95 = params.pctUsed >= 95;
  const options = is95
    ? [
        `Aumentar budget para $${suggestedBudget.toFixed(2)} (+$${pendingEstimate.suggestedBudgetIncrease.toFixed(2)})`,
        "Parar e documentar progresso (gerar handoff.md)",
        "Abortar",
      ]
    : [
        "Ignorar — continuar além do budget",
        `Aumentar budget para $${suggestedBudget.toFixed(2)} (+$${pendingEstimate.suggestedBudgetIncrease.toFixed(2)})`,
        "Parar e documentar progresso (gerar handoff.md)",
        "Abortar",
      ];

  const choice = await ctx.ui.select(title, options, { timeout: timeoutMs });

  // Determinar ação baseada na escolha (ou timeout)
  let action: BudgetGateAction = policy.budgets.swarm.defaultActionOnTimeout;
  let resultText = "";

  if (choice === undefined) {
    // Timeout — aplicar ação default
    action = policy.budgets.swarm.defaultActionOnTimeout;
    resultText = `Timeout: ação default "${action}" aplicada.`;
  } else if (!is95 && choice === "Ignorar — continuar além do budget") {
    action = "ignore";
    resultText = `Budget ignorado. Colony ${params.colonyId} retomada.`;
    // Retomar colony: editar state.json + /colony-resume
    await resumeColony(budget, budget.maxCostUsd);
    ctx.ui.notify(`Budget ignorado — colony ${params.colonyId} retomada.`, "warning");
  } else if (choice.startsWith("Aumentar budget")) {
    action = "increase_budget";
    resultText = `Budget aumentado para $${suggestedBudget.toFixed(2)}. Colony retomada.`;
    await resumeColony(budget, suggestedBudget);
    // Atualizar alert registrado
    const alert90 = budget.alerts.find(a => a.thresholdPct === params.pctUsed);
    if (alert90) {
      alert90.action = "increase_budget";
      alert90.budgetBefore = budget.maxCostUsd;
      alert90.budgetAfter = suggestedBudget;
    }
    budget.maxCostUsd = suggestedBudget;
    budget.gateInProgress = false;
    ctx.ui.notify(resultText, "info");
  } else if (choice.includes("documentar")) {
    action = "stop";
    resultText = `Colony parada. Gerando documento de handoff...`;
    // Emitir evento para handoff-doc.ts gerar o documento
    // (handoff-doc escuta 'model-policy:generate-handoff')
    ctx.ui.notify(resultText, "info");
  } else {
    // Abortar
    action = "abort";
    resultText = `Colony ${params.colonyId} abortada.`;
    budget.gateInProgress = false;
    ctx.ui.notify(resultText, "warning");
  }

  // Atualizar último alert com a ação efetiva
  const lastAlert = budget.alerts.find(a => a.thresholdPct === params.pctUsed);
  if (lastAlert) lastAlert.action = action;

  return {
    content: [{ type: "text", text: resultText }],
    details: { action, colonyId: params.colonyId, pctUsed: params.pctUsed },
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers — State.json e resume
// ═══════════════════════════════════════════════════════════════

function getMirroredCwd(cwd: string): string {
  const resolved = path.resolve(cwd);
  const parsed = path.parse(resolved);
  const rootSegment = parsed.root
    ? parsed.root.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "root"
    : "root";
  const relativeSegments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  return path.join(rootSegment, ...relativeSegments);
}

function getStateJsonPath(colonyId: string, cwd: string): string {
  const sharedRoot = path.join(os.homedir(), ".pi", "agent", "ant-colony", "root");
  const mirroredCwd = getMirroredCwd(cwd);
  return path.join(sharedRoot, mirroredCwd, "colonies", colonyId, "state.json");
}

function patchColonyState(
  stateJsonPath: string,
  patch: Partial<{ maxCost: number; status: string }>
): void {
  if (!fs.existsSync(stateJsonPath)) return;
  try {
    const state = JSON.parse(fs.readFileSync(stateJsonPath, "utf-8")) as Record<string, unknown>;
    if (patch.maxCost !== undefined) state.maxCost = patch.maxCost;
    if (patch.status !== undefined) state.status = patch.status;
    const tmp = stateJsonPath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, stateJsonPath);
  } catch {
    // Silencioso — colony já pode ter terminado
  }
}

async function resumeColony(budget: ColonyBudgetEntry, newMaxCost: number): Promise<void> {
  // Descobrir cwd a partir do stableId — tentar todos os cwds conhecidos
  // Simplificação: percorrer ~/.pi/agent/ant-colony/root/ buscando o colonyId
  const antColonyRoot = path.join(os.homedir(), ".pi", "agent", "ant-colony", "root");
  let stateJsonPath: string | null = null;

  try {
    // Busca recursiva limitada (2 níveis): root/<mirrored-cwd>/colonies/<colonyId>/state.json
    if (fs.existsSync(antColonyRoot)) {
      for (const mirroredCwd of fs.readdirSync(antColonyRoot)) {
        const coloniesDir = path.join(antColonyRoot, mirroredCwd, "colonies");
        if (!fs.existsSync(coloniesDir)) continue;
        const found = path.join(coloniesDir, budget.runtimeId, "state.json");
        if (fs.existsSync(found)) {
          stateJsonPath = found;
          break;
        }
      }
    }
  } catch {
    // Ignorar erros de filesystem
  }

  if (stateJsonPath) {
    patchColonyState(stateJsonPath, { maxCost: newMaxCost, status: "working" });
  }

  budget.gateInProgress = false;
}

// ═══════════════════════════════════════════════════════════════
// Estimativa de tasks pendentes
// ═══════════════════════════════════════════════════════════════

/** Heurísticas de tokens por caste para estimativa rápida */
const CASTE_TOKEN_ESTIMATES: Record<string, { input: number; output: number }> = {
  worker:  { input: 28_000, output: 4_000  },
  soldier: { input: 8_000,  output: 800    },
  drone:   { input: 2_000,  output: 100    },
  scout:   { input: 12_000, output: 2_000  },
};

export function estimatePendingTasks(
  entry: ColonyBudgetEntry,
  policy: ResolvedPolicy
): PendingTasksEstimate {
  // Tentar ler state.json do disco para obter tasks pendentes reais
  const antColonyRoot = path.join(os.homedir(), ".pi", "agent", "ant-colony", "root");
  let pendingTasks: Array<{ caste: string; workerClass?: string }> = [];

  try {
    if (fs.existsSync(antColonyRoot)) {
      for (const mirroredCwd of fs.readdirSync(antColonyRoot)) {
        const coloniesDir = path.join(antColonyRoot, mirroredCwd, "colonies");
        if (!fs.existsSync(coloniesDir)) continue;
        const tasksDir = path.join(coloniesDir, entry.runtimeId, "tasks");
        if (!fs.existsSync(tasksDir)) continue;
        for (const taskFile of fs.readdirSync(tasksDir)) {
          try {
            const task = JSON.parse(
              fs.readFileSync(path.join(tasksDir, taskFile), "utf-8")
            ) as { status: string; caste: string; workerClass?: string };
            if (task.status === "pending" || task.status === "claimed") {
              pendingTasks.push({ caste: task.caste, workerClass: task.workerClass });
            }
          } catch { /* skip */ }
        }
        break;
      }
    }
  } catch { /* silencioso */ }

  // Agrupar por role
  const roleGroups = new Map<string, { model: string; count: number; caste: string }>();
  for (const task of pendingTasks) {
    const wc = task.workerClass;
    const objectiveKey = wc
      ? (`swarm:${wc}` as keyof typeof policy.objectives)
      : (`swarm:${task.caste}` as keyof typeof policy.objectives);
    const model = policy.objectives[objectiveKey] ?? "anthropic/claude-sonnet-4.6";
    const role = wc ? `${task.caste}:${wc}` : task.caste;

    const existing = roleGroups.get(role);
    if (existing) {
      existing.count++;
    } else {
      roleGroups.set(role, { model, count: 1, caste: task.caste });
    }
  }

  const byRole = [];
  let totalEstimated = 0;

  for (const [role, { model, count, caste }] of roleGroups) {
    const tokenEst = CASTE_TOKEN_ESTIMATES[caste] ?? CASTE_TOKEN_ESTIMATES.worker;
    const pricing = getPricing(model);
    const costPerTask = calculateSyntheticCost(
      { input: tokenEst.input, output: tokenEst.output, cacheRead: 0, cacheWrite: 0 },
      pricing
    );
    const contextWindow = model.includes("gemini") ? 1_000_000 : 200_000;
    const contextPctAvg = (tokenEst.input / contextWindow) * 100;
    const totalCost = costPerTask * count;
    totalEstimated += totalCost;

    byRole.push({ role, model, count, estimatedCostUsd: totalCost, contextPctAvg });
  }

  // Margem de 20% sobre a estimativa
  const suggestedBudgetIncrease = Math.ceil(totalEstimated * 1.2 * 20) / 20;

  return { byRole, totalEstimatedUsd: totalEstimated, suggestedBudgetIncrease };
}

// ═══════════════════════════════════════════════════════════════
// Accessor público
// ═══════════════════════════════════════════════════════════════

export function getColonyBudget(runtimeId: string): ColonyBudgetEntry | undefined {
  return colonyBudgets.get(runtimeId);
}
