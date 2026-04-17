/**
 * model-policy extension — entry point (esqueleto Fase 0)
 *
 * Orquestra todos os módulos da extensão.
 * Os módulos marcados com TODO serão implementados nas fases seguintes.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ── Módulos P0 (Fase 1) ──────────────────────────────────────────────────────
import { loadConfig, getResolvedPolicy, formatPolicyReport } from "./config.js";
import { loadPricingTable, formatPricingTable } from "./pricing.js";
import { injectAntColonyOverrides, injectSubagentOverrides, applyExperimentSplit, hashGoal } from "./injector.js";

// ── Módulos P1 (Fase 2-3) ────────────────────────────────────────────────────
import { registerPendingBudget, tryRegisterLaunched, processUsageRecord, executeBudgetDecision, colonyBudgets } from "./budget-guard.js";
import { recordColonyRun, recordSubagentRun, formatBenchmarkInline, formatBenchmarkSummary, loadBenchmarks } from "./benchmark-recorder.js";
import { saveHandoffDoc } from "./handoff-doc.js";
import { generateSmartBudgetSuggestion, formatSmartBudgetSuggestion, applySmartBudgetSuggestion, projectHasPolicy } from "./smart-budget.js";

// ── Módulos P2 (Fase 4-5) ────────────────────────────────────────────────────
// TODO: import { estimatePlan, estimateFromGoal } from "./cost-estimator.js";
// TODO: import { registerPreFlightPlanner } from "./pre-flight-planner.js";
// TODO: import { registerABTesting, getABReport } from "./ab-testing.js";
// TODO: import { exportBenchmarks } from "./export.js";

export default function modelPolicy(pi: ExtensionAPI) {
  // Mapa temporário: hash(goal) → goal text
  // Usado para correlacionar tool_call(ant_colony) com COLONY_SIGNAL:LAUNCHED
  // Populado em tool_call, consumido em message_end (Fase 2: budget-guard)
  const _pendingGoalHashes = new Map<string, string>();

  // ── Inicialização ──────────────────────────────────────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("model-policy", "model-policy: carregando...");
    const policy = loadConfig(ctx.cwd);
    loadPricingTable(policy.pricing);
    ctx.ui.setStatus("model-policy", undefined);
    // Se projeto não tem policy local, sugerir /model-policy init (silencioso)
    if (!projectHasPolicy(ctx.cwd)) {
      ctx.ui.setStatus("model-policy", "model-policy: sem policy local — use /model-policy init");
    }
  });

  // ── Hook: tool_call ────────────────────────────────────────────────────────
  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName === "ant_colony") {
      const policy = getResolvedPolicy();
      const input = event.input as Record<string, unknown>;

      // Injetar modelOverrides + maxCost
      const colonyInput = input as Parameters<typeof injectAntColonyOverrides>[0];
      const injectedFields = injectAntColonyOverrides(colonyInput, policy);

      // Aplicar split A/B (após injeção base)
      applyExperimentSplit(colonyInput, policy, (role, group, model) => {
        injectedFields.push(`[A/B] ${role}:${group}=${model}`);
      });

      // Registrar goal hash para correlação com LAUNCHED signal (Fase 2: budget-guard)
      const goal = typeof input.goal === "string" ? input.goal : "";
      _pendingGoalHashes.set(hashGoal(goal), goal);

      if (injectedFields.length > 0) {
        // Não notificar na UI — silencioso para não interromper o fluxo
        // Os valores injetados ficam registrados no benchmark (Fase 2)
      }

      // Budget-guard FASE 1: registrar pending budget antes de lançar
      if (goal) {
        registerPendingBudget(goal, policy.budgets.swarm.maxCostUsd);
      }
      // TODO (Fase 5): pre-flight-planner — quality gate + goal enrichment
      return undefined;
    }

    if (event.toolName === "subagent") {
      const policy = getResolvedPolicy();
      const subInput = event.input as Parameters<typeof injectSubagentOverrides>[0];
      injectSubagentOverrides(subInput, policy);
      return undefined;
    }

    return undefined;
  });

  // ── Hook: message_end ──────────────────────────────────────────────────────
  pi.on("message_end", (_event, _ctx) => {
    // Budget-guard FASE 2: vincular runtimeId ao pendingBudget
    const msgText = (() => {
      const msg = (event as { message?: unknown }).message;
      if (!msg || typeof msg !== "object") return "";
      const content = (msg as { content?: unknown }).content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content.map((c: unknown) => {
          if (typeof c === "string") return c;
          if (c && typeof c === "object") return (c as { text?: string }).text ?? "";
          return "";
        }).join("\n");
      }
      return "";
    })();

    if (msgText.includes("[COLONY_SIGNAL:LAUNCHED]")) {
      tryRegisterLaunched(msgText);
    }

    // Sinal terminal — acionar benchmark-recorder
    const terminalSignals = ["[COLONY_SIGNAL:COMPLETE]", "[COLONY_SIGNAL:FAILED]", "[COLONY_SIGNAL:BUDGET_EXCEEDED]", "[COLONY_SIGNAL:ABORTED]"];
    if (terminalSignals.some(s => msgText.includes(s))) {
      // Extrair colonyId do texto: "[COLONY_SIGNAL:XXX] [<runtimeId>|<stableId>]"
      const idMatch = /\[COLONY_SIGNAL:[A-Z_]+\]\s*\[([^\]|]+)/.exec(msgText);
      const runtimeId = idMatch ? idMatch[1].trim() : null;
      if (runtimeId) {
        const budget = colonyBudgets.get(runtimeId);
        if (budget) {
          const outcome = msgText.includes("COMPLETE") ? "done"
            : msgText.includes("BUDGET_EXCEEDED") ? "budget_exceeded"
            : msgText.includes("ABORTED") ? "aborted"
            : "failed";
          recordColonyRun({
            colonyId: budget.colonyId,
            runtimeId,
            goal: budget.goal,
            outcome,
            durationMs: Date.now() - budget.startedAt,
            tokensByRole: new Map(),
            budgetConfiguredUsd: budget.maxCostUsd,
            budgetAlerts: budget.alerts,
            reportedCostUsd: budget.reportedCostUsd,
            syntheticCostUsd: budget.syntheticCostUsd,
            estimatedCostUsd: null,
            maxAnts: 4,
            workspaceMode: "worktree",
            sessionFile: "",
            projectCwd: _ctx.cwd,
            piVersion: "0.67.6",
            experiment: null,
            tasksTotal: budget.tasksTotal,
            tasksDone: budget.tasksDone,
            tasksFailed: 0,
            subTasksSpawned: 0,
            throughputHistory: [],
          });
        }
      }
    }
  });

  // ── Hook: tool_result ─────────────────────────────────────────────────────
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName === "subagent") {
      const details = event.details as { results?: Array<{ usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number }; durationMs?: number; agent?: string }> } | null;
      const result = details?.results?.[0];
      if (result?.usage) {
        const u = result.usage;
        recordSubagentRun({
          runId: `subagent-${Date.now()}`,
          goal: (event.input as { task?: string }).task?.slice(0, 200) ?? "",
          model: (() => { try { return getResolvedPolicy().objectives["subagent:default"] ?? "unknown"; } catch { return "unknown"; } })(),
          provider: "unknown",
          outcome: event.isError ? "failed" : "done",
          durationMs: result.durationMs ?? 0,
          usage: { input: u.input ?? 0, output: u.output ?? 0, cacheRead: u.cacheRead ?? 0, cacheWrite: u.cacheWrite ?? 0, cost: u.cost ?? 0 },
          sessionFile: "",
          projectCwd: (ctx as { cwd: string }).cwd,
          piVersion: "0.67.6",
        });
      }
    }
  });

  // ── Event bus: usage:record ────────────────────────────────────────────────
  pi.events.on("usage:record", (_data: unknown) => {
    processUsageRecord(_data as Parameters<typeof processUsageRecord>[0], pi);
  });

  // ── Tool: model_policy_budget_decision ────────────────────────────────────
  pi.registerTool({
    name: "model_policy_budget_decision",
    label: "Budget Gate",
    description:
      "Apresenta gate de decisão ao usuário quando o budget de uma colony atinge 90% ou 95%. " +
      "Chame esta tool quando receber uma mensagem [MODEL_POLICY:BUDGET_GATE].",
    parameters: Type.Object({
      colonyId: Type.String({ description: "Runtime ID da colony (ex: c1)" }),
      pctUsed: Type.Number({ description: "Percentual do budget consumido (ex: 90)" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeBudgetDecision(params, ctx);
    },
  });

  // ── Comando: /model-policy ─────────────────────────────────────────────────
  pi.registerCommand("model-policy", {
    description:
      "Gerencia políticas de modelo por objetivo. " +
      "Subcomandos: benchmark, dashboard, pricing, experiment, init, set, test, estimate, edit",
    async handler(args, ctx) {
      const [sub, ...rest] = (args ?? "").trim().split(/\s+/);

      switch (sub) {
        case "benchmark":
          // TODO (Fase 5): benchmark-recorder query + export
          const bFilter = rest.find(a => a.startsWith("--role="))?.split("=")[1];
          const bRecords = loadBenchmarks({ runType: "colony", maxRecords: 10 });
          if (bRecords.length === 0) {
            ctx.ui.notify("Nenhum benchmark registrado ainda. Execute uma colony primeiro.", "info");
          } else {
            ctx.ui.notify(formatBenchmarkSummary(bRecords), "info");
          }
          break;
        case "dashboard":
          // TODO (Fase 5): dashboard consolidado
          ctx.ui.notify("model-policy dashboard: não implementado ainda", "info");
          break;
        case "pricing":
          // TODO (Fase 1): mostrar tabela de preços carregada
          ctx.ui.notify(formatPricingTable(), "info");
          break;
        case "init":
          // TODO (Fase 3): smart-budget suggestion
          const suggestion = generateSmartBudgetSuggestion();
          ctx.ui.notify(formatSmartBudgetSuggestion(suggestion), "info");
          const choices = ["Sim — criar .pi/model-policy.json com estas sugestoes", "Nao — apenas visualizar"];
          const choice = await ctx.ui.select("Aplicar sugestao de budget?", choices);
          if (choice === choices[0]) {
            applySmartBudgetSuggestion(ctx.cwd, suggestion);
            ctx.ui.notify("model-policy.json criado em .pi/", "info");
          }
          break;
        case "set":
          // TODO (Fase 5): editar chave no projeto
          if (rest.length < 2) {
            ctx.ui.notify("Uso: /model-policy set <chave> <valor>\nEx: /model-policy set budgets.swarm.maxCostUsd 3.00", "warning");
          } else {
            const [keyPath, ...valueParts] = rest;
            const value = valueParts.join(" ");
            ctx.ui.notify(`model-policy set ${keyPath ?? ""} = ${value} (nao implementado — use /model-policy edit)`, "info");
          }
          break;
        case "test":
          // TODO (Fase 5): simular injeção de modelos
          ctx.ui.notify("model-policy test: não implementado ainda", "info");
          break;
        case "estimate":
          // TODO (Fase 5): estimativa sem lançar colony
          ctx.ui.notify("model-policy estimate: não implementado ainda", "info");
          break;
        case "edit":
          // TODO (Fase 5): abrir model-policy.json no editor
          ctx.ui.notify("model-policy edit: não implementado ainda", "info");
          break;
        case "experiment":
          // TODO (Fase 5): A/B testing
          ctx.ui.notify("model-policy experiment: não implementado ainda", "info");
          break;
        default:
          // Sem subcomando: mostra policy atual
          // TODO (Fase 1): mostrar policy resolvida com origins
          try {
            const policy = getResolvedPolicy();
            ctx.ui.notify(formatPolicyReport(policy), "info");
          } catch {
            ctx.ui.notify(
              "model-policy: policy não carregada ainda (reinicie pi)\n" +
              "Subcomandos: benchmark, dashboard, pricing, init, set, test, estimate, edit, experiment",
              "warning"
            );
          }
      }
    },
  });
}
