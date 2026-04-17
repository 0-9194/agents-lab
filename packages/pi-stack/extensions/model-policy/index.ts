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
// TODO: import { registerBudgetGuard, colonyBudgets, pendingBudgets } from "./budget-guard.js";
// TODO: import { registerBenchmarkRecorder } from "./benchmark-recorder.js";
// TODO: import { generateHandoffDoc } from "./handoff-doc.js";
// TODO: import { registerSmartBudget } from "./smart-budget.js";

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

      // TODO (Fase 2): budget-guard FASE 1 — registra pendingBudget
      // TODO (Fase 2): pre-flight-planner — quality gate + goal enrichment
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
    // TODO (Fase 2): budget-guard FASE 2 — parseia COLONY_SIGNAL:LAUNCHED
    //                vincula runtimeId ao pendingBudget
    // TODO (Fase 2): budget-guard — parseia COLONY_SIGNAL terminal (done/failed/budget_exceeded)
    //                aciona benchmark-recorder
  });

  // ── Hook: tool_result ─────────────────────────────────────────────────────
  pi.on("tool_result", async (_event, _ctx) => {
    // TODO (Fase 2): benchmark-recorder — captura métricas de subagent (toolName === "subagent")
  });

  // ── Event bus: usage:record ────────────────────────────────────────────────
  pi.events.on("usage:record", (_data: unknown) => {
    // TODO (Fase 2): budget-guard FASE 3 — acumula custo sintético
    //                checkThresholds → alertas 50/75/90/95
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
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      // TODO (Fase 2): implementar decisão interativa via ctx.ui.select()
      ctx.ui.notify("model-policy: budget-guard não implementado ainda", "warning");
      return {
        content: [{ type: "text" as const, text: "Budget gate: não implementado (Fase 0)" }],
        details: {},
      };
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
          ctx.ui.notify("model-policy benchmark: não implementado ainda", "info");
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
          ctx.ui.notify("model-policy init: não implementado ainda", "info");
          break;
        case "set":
          // TODO (Fase 5): editar chave no projeto
          ctx.ui.notify(`model-policy set ${rest.join(" ")}: não implementado ainda`, "info");
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
