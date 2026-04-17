/**
 * model-policy — handoff-doc.ts
 *
 * Gera documento de handoff estruturado quando uma colony é pausada
 * por budget gate (opção "parar e documentar").
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type {
  HandoffContext,
  HandoffTask,
  PendingTasksEstimate,
  ResolvedPolicy,
} from "./types.js";
import { getColonyBudget, estimatePendingTasks } from "./budget-guard.js";
import { getResolvedPolicy } from "./config.js";

// ═══════════════════════════════════════════════════════════════
// Leitura do estado da colony no disco
// ═══════════════════════════════════════════════════════════════

function findColonyDir(runtimeId: string): string | null {
  const antColonyRoot = path.join(os.homedir(), ".pi", "agent", "ant-colony", "root");
  if (!fs.existsSync(antColonyRoot)) return null;
  try {
    for (const mirroredCwd of fs.readdirSync(antColonyRoot)) {
      const coloniesDir = path.join(antColonyRoot, mirroredCwd, "colonies");
      if (!fs.existsSync(coloniesDir)) continue;
      const candidate = path.join(coloniesDir, runtimeId);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch { /* ignorar */ }
  return null;
}

interface RawTask {
  id?: string;
  title?: string;
  caste?: string;
  workerClass?: string;
  priority?: number;
  files?: string[];
  status?: string;
  error?: string;
  createdAt?: number;
  startedAt?: number;
  finishedAt?: number;
}

function readTasks(colonyDir: string): RawTask[] {
  const tasksDir = path.join(colonyDir, "tasks");
  if (!fs.existsSync(tasksDir)) return [];
  const tasks: RawTask[] = [];
  try {
    for (const file of fs.readdirSync(tasksDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        tasks.push(
          JSON.parse(fs.readFileSync(path.join(tasksDir, file), "utf-8")) as RawTask
        );
      } catch { /* skip */ }
    }
  } catch { /* ignorar */ }
  return tasks;
}

function readPheromones(colonyDir: string, maxCount = 10): string {
  const dir = path.join(colonyDir, "pheromones");
  if (!fs.existsSync(dir)) return "(sem pheromones registrados)";
  interface RawP { type?: string; content?: string; createdAt?: number; }
  const items: RawP[] = [];
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as RawP;
        if (raw.type === "discovery" || raw.type === "warning" || raw.type === "progress") {
          items.push(raw);
        }
      } catch { /* skip */ }
    }
  } catch { /* ignorar */ }
  items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  const recent = items.slice(0, maxCount);
  if (recent.length === 0) return "(sem pheromones relevantes)";
  return recent.map(p => `[${p.type ?? "?"}] ${(p.content ?? "").slice(0, 300)}`).join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Construção do HandoffContext
// ═══════════════════════════════════════════════════════════════

export function buildHandoffContext(
  runtimeId: string,
  projectCwd: string
): HandoffContext | null {
  const budgetEntry = getColonyBudget(runtimeId);
  if (!budgetEntry) return null;

  let policy: ResolvedPolicy;
  try {
    policy = getResolvedPolicy();
  } catch {
    return null;
  }

  const colonyDir = findColonyDir(runtimeId);
  const stateFilePath = colonyDir ? path.join(colonyDir, "state.json") : "";
  const rawTasks = colonyDir ? readTasks(colonyDir) : [];
  const pheromones = colonyDir ? readPheromones(colonyDir) : "(colony dir nao encontrado)";

  const pendingEstimate: PendingTasksEstimate = estimatePendingTasks(budgetEntry, policy);
  const estimateByRole = new Map(
    pendingEstimate.byRole.map(r => [r.role, r.estimatedCostUsd / Math.max(r.count, 1)])
  );

  const toTask = (raw: RawTask, estimatedCostUsd?: number): HandoffTask => ({
    id: raw.id ?? "?",
    title: raw.title ?? "(sem titulo)",
    caste: raw.caste ?? "worker",
    workerClass: raw.workerClass,
    priority: raw.priority ?? 3,
    files: raw.files ?? [],
    status: raw.status ?? "?",
    error: raw.error,
    durationMs: raw.startedAt && raw.finishedAt ? raw.finishedAt - raw.startedAt : undefined,
    estimatedCostUsd,
  });

  const tasksCompleted = rawTasks
    .filter(t => t.status === "done")
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
    .map(t => toTask(t));

  const tasksPending = rawTasks
    .filter(t => t.status === "pending" || t.status === "claimed")
    .sort((a, b) => (a.priority ?? 3) - (b.priority ?? 3))
    .map(t => {
      const role = t.workerClass ? `${t.caste}:${t.workerClass}` : (t.caste ?? "worker");
      const est = estimateByRole.get(role) ?? estimateByRole.get(t.caste ?? "worker");
      return toTask(t, est);
    });

  return {
    colonyId: runtimeId,
    goal: budgetEntry.goal,
    budgetEntry,
    tasksCompleted,
    tasksPending,
    pheromones,
    pendingEstimate,
    stateFilePath,
    projectCwd,
  };
}

// ═══════════════════════════════════════════════════════════════
// Geração do markdown
// ═══════════════════════════════════════════════════════════════

export function generateHandoffDoc(ctx: HandoffContext): string {
  const b = ctx.budgetEntry;
  const effectiveCost = b.reportedCostUsd > 0 ? b.reportedCostUsd : b.syntheticCostUsd;
  const pct = b.maxCostUsd > 0 ? (effectiveCost / b.maxCostUsd) * 100 : 0;
  const totalTasks = ctx.tasksCompleted.length + ctx.tasksPending.length;
  const providerNote = b.reportedCostUsd === 0 ? " [custo sintetico — subscription]" : "";

  const lines: string[] = [
    `# Handoff: ${ctx.goal.slice(0, 80)}${ctx.goal.length > 80 ? "..." : ""}`,
    "",
    `**Gerado:** ${new Date().toISOString()}`,
    `**Colony:** ${ctx.colonyId}`,
    `**Budget consumido:** $${effectiveCost.toFixed(2)} / $${b.maxCostUsd.toFixed(2)} (${pct.toFixed(1)}%)${providerNote}`,
    `**Progresso:** ${ctx.tasksCompleted.length}/${totalTasks} tasks (${Math.round(ctx.tasksCompleted.length / Math.max(totalTasks, 1) * 100)}%)`,
    `**Motivo de parada:** Budget ${pct.toFixed(0)}% — decisao do usuario`,
    "",
    "---",
    "",
    "## Objetivo original",
    "",
    ctx.goal,
    "",
    `## Tasks concluidas (${ctx.tasksCompleted.length})`,
    "",
  ];

  if (ctx.tasksCompleted.length > 0) {
    lines.push("| # | Task | Caste | Duracao |");
    lines.push("|---|------|-------|---------|");
    ctx.tasksCompleted.forEach((t, i) => {
      const dur = t.durationMs ? `${(t.durationMs / 1000).toFixed(1)}s` : "-";
      const caste = t.workerClass ? `${t.caste}:${t.workerClass}` : t.caste;
      lines.push(`| ${i + 1} | ${t.title} | ${caste} | ${dur} |`);
    });
  } else {
    lines.push("_Nenhuma task concluida._");
  }

  lines.push("", `## Tasks pendentes (${ctx.tasksPending.length})`, "");

  if (ctx.tasksPending.length > 0) {
    lines.push("| # | Task | Caste | Pri | Arquivos | Est. custo |");
    lines.push("|---|------|-------|-----|----------|-----------|");
    ctx.tasksPending.forEach((t, i) => {
      const caste = t.workerClass ? `${t.caste}:${t.workerClass}` : t.caste;
      const files = t.files.slice(0, 2).join(", ") + (t.files.length > 2 ? "..." : "");
      const est = t.estimatedCostUsd != null ? `~$${t.estimatedCostUsd.toFixed(3)}` : "-";
      lines.push(`| ${i + 1} | ${t.title} | ${caste} | ${t.priority} | ${files || "-"} | ${est} |`);
    });
  } else {
    lines.push("_Nenhuma task pendente._");
  }

  if (ctx.pendingEstimate && ctx.pendingEstimate.byRole.length > 0) {
    lines.push("", "## Estimativa para completar", "");
    for (const r of ctx.pendingEstimate.byRole) {
      lines.push(`- ${r.role} x${r.count}  ->  ~$${r.estimatedCostUsd.toFixed(3)}  (${r.contextPctAvg.toFixed(0)}% ctx)`);
    }
    lines.push(`- **Total adicional: ~$${ctx.pendingEstimate.totalEstimatedUsd.toFixed(2)}**`);
    lines.push(`- Budget adicional sugerido: $${ctx.pendingEstimate.suggestedBudgetIncrease.toFixed(2)} (+20% margem)`);
  }

  lines.push(
    "", "## Descobertas relevantes (pheromones)", "", "```", ctx.pheromones, "```",
    "",
    "## Como retomar",
    "",
    "```bash",
    "# Opcao A: retomar colony existente",
    `/colony-resume ${ctx.colonyId}`,
    "",
    "# Opcao B: nova colony com contexto",
    `# ant_colony goal: \"Continuar: ${ctx.goal.slice(0, 60)}... [ver tasks pendentes acima]\"`,
    "```",
    "",
    "**Recomendacoes:**",
  );

  if (ctx.pendingEstimate) {
    lines.push(`- Budget adicional sugerido: $${ctx.pendingEstimate.suggestedBudgetIncrease.toFixed(2)}`);
  }
  if (ctx.tasksPending.length > 0 && ctx.tasksPending[0]) {
    lines.push(`- Prioridade 1: "${ctx.tasksPending[0].title}"`);
  }
  lines.push("- Considere modelo mais barato para tasks restantes se possivel");

  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════
// Persistência
// ═══════════════════════════════════════════════════════════════

/**
 * Gera e salva o documento de handoff.
 * Tenta .pi/handoffs/ no projeto, fallback em ~/.pi/handoffs/.
 * Retorna o path do arquivo criado, ou null em caso de erro.
 */
export function saveHandoffDoc(runtimeId: string, projectCwd: string): string | null {
  const ctx = buildHandoffContext(runtimeId, projectCwd);
  if (!ctx) return null;

  const content = generateHandoffDoc(ctx);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `handoff-${runtimeId}-${timestamp}.md`;

  const dirs = [
    path.join(projectCwd, ".pi", "handoffs"),
    path.join(os.homedir(), ".pi", "handoffs"),
  ];

  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, content, "utf-8");
      return filePath;
    } catch { /* tentar proximo */ }
  }
  return null;
}
