/**
 * model-policy extension — entry point (v1.0 — MVP completo)
 *
 * Orquestra todos os módulos da extensão model-policy.
 * Fases 0-5 implementadas.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ── Módulos P0 (Fase 1) ──────────────────────────────────────────────────────
import { loadConfig, getResolvedPolicy, formatPolicyReport, writeProjectPolicy, invalidateConfig } from "./config.js";
import { loadPricingTable, formatPricingTable } from "./pricing.js";
import { injectAntColonyOverrides, injectSubagentOverrides, applyExperimentSplit, hashGoal } from "./injector.js";

// ── Módulos P1 (Fase 2-3) ────────────────────────────────────────────────────
import { registerPendingBudget, tryRegisterLaunched, processUsageRecord, executeBudgetDecision, colonyBudgets } from "./budget-guard.js";
import { recordColonyRun, recordSubagentRun, formatBenchmarkInline, formatBenchmarkSummary, loadBenchmarks } from "./benchmark-recorder.js";
import { saveHandoffDoc } from "./handoff-doc.js";
import { generateSmartBudgetSuggestion, formatSmartBudgetSuggestion, applySmartBudgetSuggestion, projectHasPolicy } from "./smart-budget.js";

// ── Módulos P2 (Fase 4-5) ────────────────────────────────────────────────────
import { estimatePlanFromTasks, estimateFromGoal, formatPlanEstimate } from "./cost-estimator.js";
import { runPreFlight } from "./pre-flight-planner.js";
import { getExperimentStatus, checkExperimentResult, formatABTestResult, formatExperimentStatus } from "./ab-testing.js";
import { exportBenchmarks } from "./export.js";

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
      // Pre-flight: quality gate + goal enrichment
      const preFlightResult = await runPreFlight(
        event.input as Record<string, unknown>,
        _ctx,
        pi
      );
      if (preFlightResult?.block) return preFlightResult;
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
          const exportFlag = rest.find(a => a === "--csv" || a === "--json-flat" || a === "--vega-lite" || a === "--html");
          if (exportFlag) {
            const fmt = exportFlag.slice(2) as "csv" | "json-flat" | "vega-lite" | "html";
            const outPath = exportBenchmarks(fmt, { projectCwd: ctx.cwd });
            ctx.ui.notify(`Exportado: ${outPath}`, "info");
          } else {
            const bRecords = loadBenchmarks({ runType: "colony", maxRecords: 10 });
            if (bRecords.length === 0) {
              ctx.ui.notify("Nenhum benchmark registrado ainda. Execute uma colony primeiro.", "info");
            } else {
              ctx.ui.notify(formatBenchmarkSummary(bRecords), "info");
            }
          }
          break;
        case "dashboard":
          const bAll = loadBenchmarks({ maxRecords: 50, projectCwd: ctx.cwd });
          if (bAll.length === 0) {
            ctx.ui.notify("Sem dados de benchmark ainda. Execute uma colony ou subagent primeiro.", "info");
          } else {
            ctx.ui.notify(formatBenchmarkSummary(bAll), "info");
          }
          break;
        case "pricing":
          ctx.ui.notify(formatPricingTable(), "info");
          break;
        case "init":
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
          if (rest.length < 2) {
            ctx.ui.notify("Uso: /model-policy set <chave> <valor>\nEx: /model-policy set budgets.swarm.maxCostUsd 3.00\n     /model-policy set objectives.swarm:worker google/gemini-2.5-pro", "warning");
          } else {
            const [keyPath, ...valueParts] = rest;
            const rawValue = valueParts.join(" ");
            if (!keyPath) { ctx.ui.notify("Chave inválida.", "warning"); break; }
            // Parsear valor: tentar número, senão string
            const parsedValue: unknown = !isNaN(Number(rawValue)) && rawValue !== "" ? Number(rawValue) : rawValue;
            // Construir patch a partir do keyPath (ex: "budgets.swarm.maxCostUsd")
            const parts = keyPath.split(".");
            const patch: Record<string, unknown> = {};
            let cur: Record<string, unknown> = patch;
            for (let i = 0; i < parts.length - 1; i++) {
              const p = parts[i] as string;
              cur[p] = {};
              cur = cur[p] as Record<string, unknown>;
            }
            const lastKey = parts[parts.length - 1] as string;
            cur[lastKey] = parsedValue;
            writeProjectPolicy(ctx.cwd, patch as Parameters<typeof writeProjectPolicy>[1]);
            invalidateConfig();
            loadConfig(ctx.cwd);
            ctx.ui.notify(`✅ ${keyPath} = ${String(parsedValue)} (salvo em .pi/model-policy.json)`, "info");
          }
          break;
        case "test":
          try {
            const pol = getResolvedPolicy();
            const lines = [
              "Simulação de injeção para ant_colony:",
              "",
              `  scoutModel          → ${pol.objectives["swarm:scout"] ?? "(default)"}`,
              `  workerModel         → ${pol.objectives["swarm:worker"] ?? "(default)"}`,
              `  soldierModel        → ${pol.objectives["swarm:soldier"] ?? "(default)"}`,
              `  designWorkerModel   → ${pol.objectives["swarm:design"] ?? "(default)"}`,
              `  backendWorkerModel  → ${pol.objectives["swarm:backend"] ?? "(default)"}`,
              `  multimodalModel     → ${pol.objectives["swarm:multimodal"] ?? "(default)"}`,
              `  reviewWorkerModel   → ${pol.objectives["swarm:review"] ?? "(default)"}`,
              `  maxCost             → $${pol.budgets.swarm.maxCostUsd.toFixed(2)}`,
              "",
              "Simulação para subagent:",
              `  model (default)     → ${pol.objectives["subagent:default"] ?? "(default)"}`,
              `  model (complex)     → ${pol.objectives["subagent:complex"] ?? "(default)"}`,
            ];
            ctx.ui.notify(lines.join("\n"), "info");
          } catch (e) {
            ctx.ui.notify("model-policy test: policy não carregada", "warning");
          }
          break;
        case "estimate":
          const goalArg = rest.join(" ").trim();
          if (!goalArg) {
            ctx.ui.notify("Uso: /model-policy estimate <goal>", "warning");
          } else {
            try {
              const pol = getResolvedPolicy();
              const est = (await import("./cost-estimator.js")).estimateFromGoal(goalArg, pol);
              const budgetUsd = pol.budgets.swarm.maxCostUsd;
              const pct = budgetUsd > 0 ? (est.estimatedCostUsd / budgetUsd) * 100 : 0;
              ctx.ui.notify(
                `📊 Estimativa para goal:\n` +
                `  Custo: $${est.rangeLow.toFixed(2)} – $${est.rangeHigh.toFixed(2)} (${pct.toFixed(0)}% do budget $${budgetUsd.toFixed(2)})\n` +
                `  Confiança: ${est.confidence}\n  ${est.reasoning}`,
                "info"
              );
            } catch {
              ctx.ui.notify("model-policy estimate: erro ao calcular estimativa", "warning");
            }
          }
          break;
        case "edit":
          const scope = rest[0] ?? "project";
          const editPath = scope === "global"
            ? (await import("./config.js")).globalPolicyPath()
            : (await import("./config.js")).projectPolicyPath(ctx.cwd);
          ctx.ui.notify(`Caminho do model-policy.json (${scope}):\n${editPath}`, "info");
          break;
        case "experiment":
          const expSub = rest[0] ?? "status";
          if (expSub === "status") {
            ctx.ui.notify(formatExperimentStatus(getExperimentStatus()), "info");
          } else if (expSub === "stop" && rest[1]) {
            const result = checkExperimentResult(rest[1]);
            if (result) {
              ctx.ui.notify(formatABTestResult(result), "info");
            } else {
              ctx.ui.notify(`Experimento '${rest[1]}': amostras insuficientes ou não encontrado.`, "warning");
            }
          } else {
            ctx.ui.notify("Uso: /model-policy experiment [status|stop <role>]", "info");
          }
          break;
        default:
          // Sem subcomando: mostra policy atual
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
