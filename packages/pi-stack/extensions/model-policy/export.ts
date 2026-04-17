/**
 * model-policy — export.ts
 * Export de benchmarks em CSV, JSON flat, Vega-Lite e HTML standalone.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { BenchmarkRecord, ByRoleEntry } from "./types.js";
import { loadBenchmarks, benchmarkFilePath } from "./benchmark-recorder.js";

function exportsDir(projectCwd?: string): string {
  const base = projectCwd
    ? path.join(projectCwd, ".pi", "exports")
    : path.join(os.homedir(), ".pi", "exports");
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return base;
}

function ts(): string { return new Date().toISOString().slice(0, 10); }

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

// ═══════════════════════════════════════════════════════════════
// CSV flat
// ═══════════════════════════════════════════════════════════════

const CSV_HEADER = [
  "recordedAt","runType","runId","outcome","durationMs",
  "reportedCostUsd","syntheticCostUsd","effectiveCostUsd","budgetConsumedPct",
  "estimatedCostUsd","estimateAccuracyPct","tasksTotal","tasksDone","tasksFailed",
  "totalTokens","tasksPerMinute","role","model","provider","tasksExecuted",
  "costPerTask","durationMsAvg","failureRate","contextPctAvg",
  "experimentGroup","providerType","projectCwd",
].join(",");

function toCSVRows(r: BenchmarkRecord): string[] {
  const base = [
    r.recordedAt, r.runType, r.runId, r.outcome, r.durationMs,
    r.reportedCostUsd, r.syntheticCostUsd, r.effectiveCostUsd,
    r.budgetConsumedPct.toFixed(1), r.estimatedCostUsd ?? "",
    r.estimateAccuracyPct?.toFixed(1) ?? "",
    r.tasks.total, r.tasks.done, r.tasks.failed,
    r.tokens.totalTokens, r.throughput.tasksPerMinute.toFixed(2),
  ];
  if (r.byRole.length === 0) {
    return [[...base, "", "", "", "", "", "", "", "", "", r.env.providerType, r.projectCwd].map(esc).join(",")];
  }
  return r.byRole.map((e: ByRoleEntry) =>
    [...base,
      e.role, e.model, e.provider, e.tasksExecuted,
      e.costPerTask.toFixed(5), e.durationMsAvg.toFixed(0),
      e.failureRate.toFixed(4), e.contextPctAvg.toFixed(1),
      e.experimentGroup ?? "", r.env.providerType, r.projectCwd,
    ].map(esc).join(",")
  );
}

export function exportCSV(options?: { maxRecords?: number; projectCwd?: string; outputDir?: string }): string {
  const records = loadBenchmarks({ maxRecords: options?.maxRecords ?? 1000, projectCwd: options?.projectCwd });
  const rows = [CSV_HEADER];
  for (const r of records) rows.push(...toCSVRows(r));
  const f = path.join(exportsDir(options?.outputDir), `benchmark-${ts()}.csv`);
  fs.writeFileSync(f, rows.join("\n"), "utf-8");
  return f;
}

// ═══════════════════════════════════════════════════════════════
// JSON flat
// ═══════════════════════════════════════════════════════════════

export function exportJSONFlat(options?: { maxRecords?: number; projectCwd?: string; outputDir?: string }): string {
  const records = loadBenchmarks({ maxRecords: options?.maxRecords ?? 1000, projectCwd: options?.projectCwd });
  const flat: Record<string, unknown>[] = [];

  for (const r of records) {
    const base: Record<string, unknown> = {
      recordedAt: r.recordedAt, runType: r.runType, runId: r.runId,
      outcome: r.outcome, durationMs: r.durationMs,
      reportedCostUsd: r.reportedCostUsd, syntheticCostUsd: r.syntheticCostUsd,
      effectiveCostUsd: r.effectiveCostUsd, budgetConsumedPct: r.budgetConsumedPct,
      estimatedCostUsd: r.estimatedCostUsd, estimateAccuracyPct: r.estimateAccuracyPct,
      estimateMethod: r.estimateMethod, estimateSamples: r.estimateSamples,
      tasksTotal: r.tasks.total, tasksDone: r.tasks.done, tasksFailed: r.tasks.failed,
      subTasksSpawned: r.tasks.subTasksSpawned,
      inputTotal: r.tokens.inputTotal, outputTotal: r.tokens.outputTotal,
      cacheReadTotal: r.tokens.cacheReadTotal, totalTokens: r.tokens.totalTokens,
      tasksPerMinute: r.throughput.tasksPerMinute,
      tasksPerMinutePeak: r.throughput.tasksPerMinutePeak,
      tokensPerSecond: r.throughput.tokensPerSecond,
      budgetConfiguredUsd: r.policy.budgetConfiguredUsd,
      policySource: r.policy.source,
      experimentRole: r.experiment?.role ?? null,
      experimentGroup: r.experiment?.group ?? null,
      providerType: r.env.providerType,
      workspaceMode: r.env.workspaceMode,
      piVersion: r.env.piVersion,
      projectCwd: r.projectCwd,
      goal: r.goal,
    };
    if (r.byRole.length === 0) { flat.push(base); continue; }
    for (const e of r.byRole) {
      flat.push({
        ...base,
        role: e.role, model: e.model, provider: e.provider,
        tasksExecuted: e.tasksExecuted, costPerTask: e.costPerTask,
        durationMsAvg: e.durationMsAvg, failureRate: e.failureRate,
        contextPctAvg: e.contextPctAvg,
        roleInputTokens: e.inputTokens, roleOutputTokens: e.outputTokens,
        roleSyntheticCostUsd: e.syntheticCostUsd,
        roleExperimentGroup: e.experimentGroup ?? null,
      });
    }
  }

  const f = path.join(exportsDir(options?.outputDir), `benchmark-${ts()}.json`);
  fs.writeFileSync(f, JSON.stringify(flat, null, 2), "utf-8");
  return f;
}

// ═══════════════════════════════════════════════════════════════
// Vega-Lite spec
// ═══════════════════════════════════════════════════════════════

export function exportVegaLite(options?: { maxRecords?: number; projectCwd?: string; outputDir?: string }): string {
  const records = loadBenchmarks({ maxRecords: options?.maxRecords ?? 500, projectCwd: options?.projectCwd });
  const data: Record<string, unknown>[] = [];

  for (const r of records) {
    for (const e of r.byRole) {
      data.push({
        recordedAt: r.recordedAt, runId: r.runId, outcome: r.outcome,
        effectiveCostUsd: r.effectiveCostUsd, estimatedCostUsd: r.estimatedCostUsd,
        role: e.role,
        model: e.model.split("/")[1] ?? e.model,
        costPerTask: e.costPerTask,
        durationSec: e.durationMsAvg / 1000,
        failureRatePct: e.failureRate * 100,
        contextPctAvg: e.contextPctAvg,
        experimentGroup: e.experimentGroup ?? "none",
      });
    }
  }

  const spec = {
    $schema: "https://vega.github.io/schema/vega-lite/v5.json",
    title: "model-policy Benchmark Report",
    data: { values: data },
    vconcat: [
      {
        title: "Custo por task ao longo do tempo (por modelo)",
        mark: "line", width: 600, height: 180,
        encoding: {
          x: { field: "recordedAt", type: "temporal", title: "Data" },
          y: { field: "costPerTask", type: "quantitative", title: "$/task" },
          color: { field: "model", type: "nominal" },
          strokeDash: { field: "experimentGroup", type: "nominal" },
        },
      },
      {
        title: "Latência média por role",
        mark: "bar", width: 600, height: 160,
        encoding: {
          x: { field: "role", type: "nominal", sort: "-y" },
          y: { field: "durationSec", type: "quantitative", title: "s/task" },
          color: { field: "model", type: "nominal" },
          xOffset: { field: "model" },
        },
      },
      {
        title: "Failure rate por modelo",
        mark: "bar", width: 600, height: 140,
        encoding: {
          x: { field: "model", type: "nominal", sort: "-y" },
          y: { field: "failureRatePct", type: "quantitative", title: "Fail %" },
          color: { field: "role", type: "nominal" },
        },
      },
      {
        title: "Acurácia do estimador (estimado vs real)",
        mark: "point", width: 400, height: 260,
        encoding: {
          x: { field: "estimatedCostUsd", type: "quantitative", title: "Estimado ($)" },
          y: { field: "effectiveCostUsd", type: "quantitative", title: "Real ($)" },
          color: { field: "outcome", type: "nominal" },
          tooltip: [{ field: "runId" }, { field: "estimatedCostUsd" }, { field: "effectiveCostUsd" }],
        },
      },
    ],
  };

  const f = path.join(exportsDir(options?.outputDir), `benchmark-charts-${ts()}.vl.json`);
  fs.writeFileSync(f, JSON.stringify(spec, null, 2), "utf-8");
  return f;
}

// ═══════════════════════════════════════════════════════════════
// HTML standalone
// ═══════════════════════════════════════════════════════════════

export function exportHTML(options?: { maxRecords?: number; projectCwd?: string; outputDir?: string }): string {
  const tmpVL = exportVegaLite({ ...options, outputDir: os.tmpdir() });
  const spec = fs.readFileSync(tmpVL, "utf-8");
  try { fs.unlinkSync(tmpVL); } catch { /* ignorar */ }

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>model-policy Benchmark ${ts()}</title>
  <script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; background: #f9f9f9; }
    h1 { color: #333; border-bottom: 2px solid #ddd; padding-bottom: .5rem; }
    #vis { background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
    .meta { color: #666; font-size: .875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <h1>📊 model-policy Benchmark Report</h1>
  <p class="meta">Gerado: ${new Date().toISOString()} | Fonte: ${benchmarkFilePath()}</p>
  <div id="vis"></div>
  <script>vegaEmbed('#vis', ${spec}, { actions: { export: true, source: false } });</script>
</body>
</html>`;

  const f = path.join(exportsDir(options?.outputDir), `benchmark-report-${ts()}.html`);
  fs.writeFileSync(f, html, "utf-8");
  return f;
}

// ═══════════════════════════════════════════════════════════════
// Entry point unificado
// ═══════════════════════════════════════════════════════════════

export type ExportFormat = "csv" | "json-flat" | "vega-lite" | "html";

export function exportBenchmarks(
  format: ExportFormat,
  options?: { maxRecords?: number; projectCwd?: string; outputDir?: string }
): string {
  switch (format) {
    case "csv":        return exportCSV(options);
    case "json-flat":  return exportJSONFlat(options);
    case "vega-lite":  return exportVegaLite(options);
    case "html":       return exportHTML(options);
    default:           return exportCSV(options);
  }
}
