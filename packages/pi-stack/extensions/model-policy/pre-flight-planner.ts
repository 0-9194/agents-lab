/**
 * model-policy — pre-flight-planner.ts
 *
 * Quality gate e goal enrichment antes de lançar uma colony.
 * Nível light (default): quality gate + detecção de arquivos relevantes.
 * Nível full (opt-in): light + estimativa de custo com confirmação.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ResolvedPolicy } from "./types.js";
import { getResolvedPolicy } from "./config.js";
import { estimateFromGoal, formatPlanEstimate } from "./cost-estimator.js";

// ═══════════════════════════════════════════════════════════════
// Quality gate — validação do goal
// ═══════════════════════════════════════════════════════════════

export interface QualityGateResult {
  passed: boolean;
  warnings: string[];
  wordCount: number;
}

export function runQualityGate(goal: string): QualityGateResult {
  const warnings: string[] = [];
  const words = goal.trim().split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount < 20) {
    warnings.push(`Goal muito curto (${wordCount} palavras — mínimo recomendado: 20). Goals vagos geram tasks imprecisas.`);
  }

  // Verificar se contém verbo de ação (heurística simples)
  const actionVerbs = /\b(implement|add|create|refactor|fix|update|migrate|extract|remove|rename|move|test|document|analis|implement|adicionar|criar|refatorar|corrigir|atualizar|migrar|extrair|remover|renomear|mover|testar|documentar|analisar|implementar)\b/i;
  if (!actionVerbs.test(goal)) {
    warnings.push("Goal não contém verbo de ação claro. Adicione o que deve ser feito (ex: 'implementar', 'refatorar', 'migrar').");
  }

  // Verificar se há critério de sucesso ou escopo
  const hasCriteria = /\b(para que|de modo que|garantindo|sem quebrar|mantendo|compatível|passando|until|so that|ensuring|without breaking|maintaining)\b/i;
  if (!hasCriteria.test(goal) && wordCount > 20) {
    // Aviso leve — não impede, só sugere
    warnings.push("Considere adicionar critério de sucesso (ex: 'sem quebrar a API pública', 'todos os testes passando').");
  }

  return { passed: warnings.filter(w => w.includes("muito curto") || w.includes("verbo")).length === 0, warnings, wordCount };
}

// ═══════════════════════════════════════════════════════════════
// Goal enrichment — detecção de contexto do codebase
// ═══════════════════════════════════════════════════════════════

export async function enrichGoal(
  goal: string,
  cwd: string,
  pi: ExtensionAPI
): Promise<string> {
  const contextLines: string[] = [];

  // 1. Detectar linguagem dominante
  const fileTypes: Record<string, string> = {};
  const extPatterns = [
    { ext: "*.ts", lang: "TypeScript" },
    { ext: "*.py", lang: "Python" },
    { ext: "*.go", lang: "Go" },
    { ext: "*.rs", lang: "Rust" },
    { ext: "*.java", lang: "Java" },
    { ext: "*.rb", lang: "Ruby" },
  ];

  for (const { ext, lang } of extPatterns) {
    try {
      const result = await pi.exec("find", [".", "-name", ext, "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.git/*"], { timeout: 3000 });
      const count = (result.stdout ?? "").split("\n").filter(Boolean).length;
      if (count > 0) fileTypes[lang] = String(count);
    } catch { /* ignorar */ }
  }

  const dominant = Object.entries(fileTypes).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  if (dominant) {
    contextLines.push(`- Linguagem dominante: ${dominant[0]} (${dominant[1]} arquivos)`);
  }

  // 2. Detectar framework via package.json / go.mod / Cargo.toml
  try {
    const pkgResult = await pi.exec("cat", ["package.json"], { timeout: 2000 });
    if (pkgResult.code === 0 && pkgResult.stdout) {
      const pkg = JSON.parse(pkgResult.stdout) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      const frameworks = [];
      if (allDeps["@nestjs/core"]) frameworks.push("NestJS");
      else if (allDeps["express"]) frameworks.push("Express");
      else if (allDeps["fastify"]) frameworks.push("Fastify");
      if (allDeps["react"]) frameworks.push("React");
      if (allDeps["vue"]) frameworks.push("Vue");
      if (allDeps["next"]) frameworks.push("Next.js");
      if (frameworks.length > 0) contextLines.push(`- Framework detectado: ${frameworks.join(", ")}`);
    }
  } catch { /* ignorar */ }

  // 3. Encontrar arquivos relevantes para o goal
  const keywords = goal
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 4 && !/^(para|com|que|uma|este|essa|deve|não|mais|como|isso|pelo|pela)$/.test(w))
    .slice(0, 3);

  if (keywords.length > 0) {
    try {
      const rgArgs = ["-l", "--max-count=1", "--glob", "!node_modules", "--glob", "!.git", keywords[0] ?? ""];
      const result = await pi.exec("rg", rgArgs, { timeout: 4000 });
      const files = (result.stdout ?? "").split("\n").filter(Boolean).slice(0, 8);
      if (files.length > 0) {
        contextLines.push(`- Arquivos potencialmente relevantes (keyword "${keywords[0]}"):`);
        for (const f of files) contextLines.push(`  ${f}`);
      }
    } catch { /* rg não disponível — ignorar */ }
  }

  if (contextLines.length === 0) return goal;

  const enrichmentBlock = [
    "",
    "## Contexto de codebase (auto-detectado pelo model-policy)",
    ...contextLines,
  ].join("\n");

  return goal + enrichmentBlock;
}

// ═══════════════════════════════════════════════════════════════
// API pública — executar pre-flight em tool_call
// ═══════════════════════════════════════════════════════════════

/**
 * Executa o pre-flight para uma colony.
 * Muta `input.goal` se enrichment estiver habilitado.
 * Retorna { block: true } se o usuário cancelar no quality gate.
 * Retorna undefined para continuar normalmente.
 */
export async function runPreFlight(
  input: Record<string, unknown>,
  ctx: ExtensionContext,
  pi: ExtensionAPI
): Promise<{ block: true; reason: string } | undefined> {
  let policy: ResolvedPolicy;
  try {
    policy = getResolvedPolicy();
  } catch {
    return undefined; // Se policy não carregada, não bloquear
  }

  if (!policy.planning.enabled || policy.planning.level === "off") return undefined;

  const goal = typeof input.goal === "string" ? input.goal : "";
  if (!goal) return undefined;

  // ── Nível light: quality gate + enrichment ──────────────────
  const gate = runQualityGate(goal);

  if (!gate.passed) {
    const warningText = gate.warnings.join("\n");
    const ok = await ctx.ui.confirm(
      "⚠️ Goal incompleto — model-policy",
      `${warningText}\n\nProsseguir mesmo assim?`
    );
    if (!ok) {
      return { block: true, reason: `Goal rejeitado pelo pre-flight: ${gate.warnings[0]}` };
    }
  } else if (gate.warnings.length > 0 && ctx.hasUI) {
    // Avisos não-bloqueantes
    ctx.ui.notify(`model-policy pre-flight: ${gate.warnings[0]}`, "info");
  }

  // Goal enrichment
  try {
    const enrichedGoal = await enrichGoal(goal, ctx.cwd, pi);
    if (enrichedGoal !== goal) {
      input.goal = enrichedGoal;
    }
  } catch { /* ignorar falhas de enrichment */ }

  // ── Nível full: estimativa de custo com confirmação ─────────
  if (policy.planning.level === "full") {
    const estimate = estimateFromGoal(goal, policy);
    const budgetUsd = policy.budgets.swarm.maxCostUsd;
    const pct = budgetUsd > 0 ? (estimate.estimatedCostUsd / budgetUsd) * 100 : 0;

    const summary =
      `📊 Estimativa de custo (model-policy)\n` +
      `Tasks estimadas: baseado em histórico\n` +
      `Custo estimado: $${estimate.rangeLow.toFixed(2)} – $${estimate.rangeHigh.toFixed(2)} (${pct.toFixed(0)}% do budget $${budgetUsd.toFixed(2)})\n` +
      `Confiança: ${estimate.confidence}\n${estimate.reasoning}\n\nLançar colony?`;

    const ok = await ctx.ui.confirm("📊 Pre-flight estimativa", summary);
    if (!ok) {
      return { block: true, reason: "Colony cancelada pelo usuário após estimativa de custo." };
    }
  }

  return undefined;
}
