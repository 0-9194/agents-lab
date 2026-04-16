/**
 * handoff-advisor — deterministic control plane handoff advisor.
 *
 * Combines two independent signals into one unified handoff decision:
 *   1. Budget pressure (from quota-visibility / analyzeQuota)
 *   2. Provider availability (from provider-readiness matrix)
 *
 * Why this exists vs quota_visibility_route:
 *   - quota_visibility_route only uses budget signal.
 *   - handoff-advisor adds availability/health signal and produces an
 *     explicit switch command the human can confirm, not just a recommendation.
 *
 * noAutoSwitch invariant: this tool NEVER switches provider automatically.
 * It only recommends and produces a confirming command hint.
 *
 * @capability-id handoff-advisor
 * @capability-criticality high
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  analyzeQuota,
  buildRouteAdvisory,
  parseProviderBudgets,
  parseRouteModelRefs,
  safeNum,
  type RoutingProfile,
} from "./quota-visibility";
import { buildProviderReadinessMatrix } from "./provider-readiness";

// ---------------------------------------------------------------------------
// Score types
// ---------------------------------------------------------------------------

/** Lower = better. Combined budget + readiness score for provider selection. */
export interface ProviderHandoffScore {
  provider: string;
  modelRef: string | null;
  budgetState: "ok" | "warning" | "blocked" | "unknown";
  readiness: "ready" | "degraded" | "blocked" | "unconfigured";
  score: number;
  available: boolean;
}

export interface HandoffAdvisory {
  generatedAtIso: string;
  currentProvider: string | undefined;
  currentState: "ok" | "warn" | "block" | "unknown";
  recommended: {
    provider: string;
    modelRef: string;
    switchCommand: string;
    reason: string;
  } | null;
  candidates: ProviderHandoffScore[];
  blockedProviders: string[];
  noAutoSwitch: true;
}

function toRoutingProfile(raw?: string): RoutingProfile {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "cheap" || v === "reliable") return v;
  return "balanced";
}

// ---------------------------------------------------------------------------
// Score computation (pure, testable)
// ---------------------------------------------------------------------------

const BUDGET_SCORE: Record<string, number> = { ok: 0, warning: 1, blocked: 10, unknown: 5 };
const READINESS_SCORE: Record<string, number> = { ready: 0, degraded: 1, blocked: 10, unconfigured: 3 };

export function computeHandoffScore(
  budgetState: string,
  readiness: string,
): number {
  const bs = BUDGET_SCORE[budgetState] ?? 5;
  const rs = READINESS_SCORE[readiness] ?? 3;
  return bs + rs; // additive — blocked in either dimension → high score → deprioritized
}

export function isAvailable(budgetState: string, readiness: string): boolean {
  return budgetState !== "blocked" && readiness !== "blocked" && readiness !== "unconfigured";
}

export function selectNextProvider(
  candidates: ProviderHandoffScore[],
  currentProvider: string | undefined,
): ProviderHandoffScore | null {
  const eligible = candidates
    .filter((c) => c.available && c.provider !== currentProvider)
    .sort((a, b) => a.score - b.score || a.provider.localeCompare(b.provider));
  return eligible[0] ?? null;
}

// ---------------------------------------------------------------------------
// Advisory builder
// ---------------------------------------------------------------------------

function readPiStackSettings(cwd: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf8")) as Record<string, unknown>;
    return (raw.piStack ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function buildHandoffAdvisory(
  cwd: string,
  currentProvider: string | undefined,
): Promise<HandoffAdvisory> {
  const piStack = readPiStackSettings(cwd);
  const qv = (piStack.quotaVisibility ?? {}) as Record<string, unknown>;
  const routeModelRefs = parseRouteModelRefs(qv.routeModelRefs);
  const providerBudgets = parseProviderBudgets(qv.providerBudgets);

  // Build readiness matrix (includes budget state from session history)
  const matrix = await buildProviderReadinessMatrix(cwd);

  // Build route advisory for budget pressure
  let routeAdvisory;
  try {
    const days = safeNum(qv.defaultDays) || 30;
    const status = await analyzeQuota({ days, providerBudgets, providerWindowHours: {} });
    routeAdvisory = buildRouteAdvisory(status, toRoutingProfile(undefined));
  } catch {
    routeAdvisory = null;
  }

  const budgetStateByProvider: Record<string, string> = {};
  if (routeAdvisory) {
    for (const c of routeAdvisory.consideredProviders) {
      budgetStateByProvider[c.provider] = c.state;
    }
  }

  // Combine readiness + budget into unified candidates list
  const candidates: ProviderHandoffScore[] = matrix.entries.map((entry) => {
    const budgetState = (budgetStateByProvider[entry.provider] ?? entry.budgetState) as string;
    const score = computeHandoffScore(budgetState, entry.readiness);
    return {
      provider: entry.provider,
      modelRef: entry.modelRef,
      budgetState: budgetState as ProviderHandoffScore["budgetState"],
      readiness: entry.readiness,
      score,
      available: isAvailable(budgetState, entry.readiness),
    };
  });

  // Sort by score (ascending = best first)
  candidates.sort((a, b) => a.score - b.score || a.provider.localeCompare(b.provider));

  const blockedProviders = candidates
    .filter((c) => !c.available)
    .map((c) => c.provider);

  const next = selectNextProvider(candidates, currentProvider);
  const currentEntry = candidates.find((c) => c.provider === currentProvider);

  const currentState: HandoffAdvisory["currentState"] = currentEntry
    ? currentEntry.budgetState === "blocked"
      ? "block"
      : currentEntry.budgetState === "warning"
        ? "warn"
        : currentEntry.readiness === "degraded" || currentEntry.readiness === "unconfigured"
          ? "warn"
          : "ok"
    : "unknown";

  let recommended: HandoffAdvisory["recommended"] = null;
  if (next?.modelRef) {
    const [provider, modelId] = next.modelRef.split("/");
    recommended = {
      provider: next.provider,
      modelRef: next.modelRef,
      // Explicit switch hint — human confirms before running
      switchCommand: `quota_visibility_route({ "profile": "balanced", "execute": true })`,
      reason: [
        `${next.provider} has lowest combined score (budget:${next.budgetState} + readiness:${next.readiness} = ${next.score}).`,
        `modelRef: ${next.modelRef}`,
        `Confirm: update defaultProvider/defaultModel or run the switch command above.`,
      ].join(" "),
    };
    void provider; void modelId; // used via modelRef destructuring above
  } else if (next) {
    recommended = {
      provider: next.provider,
      modelRef: "(no routeModelRef configured)",
      switchCommand: `Add piStack.quotaVisibility.routeModelRefs["${next.provider}"] to .pi/settings.json`,
      reason: `${next.provider} is best available but has no routeModelRef configured.`,
    };
  }

  return {
    generatedAtIso: new Date().toISOString(),
    currentProvider,
    currentState,
    recommended,
    candidates,
    blockedProviders,
    noAutoSwitch: true,
  };
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function handoffAdvisorExtension(pi: ExtensionAPI) {
  // ---- tool: handoff_advisor -------------------------------------------

  pi.registerTool({
    name: "handoff_advisor",
    label: "Handoff Advisor",
    description: [
      "Deterministic control plane handoff advisor.",
      "Combines budget pressure (quota-visibility) + provider availability (provider-readiness)",
      "to recommend the next provider when current is at WARN/BLOCK.",
      "noAutoSwitch: true — never switches automatically; produces a confirming command for human approval.",
    ].join(" "),
    parameters: Type.Object({
      current_provider: Type.Optional(
        Type.String({ description: "Currently active provider (used to exclude from candidates). Optional." })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const p = params as { current_provider?: string };
      const advisory = await buildHandoffAdvisory(ctx.cwd, p.current_provider);
      return {
        content: [{ type: "text", text: JSON.stringify(advisory, null, 2) }],
        details: advisory,
      };
    },
  });

  // ---- command: /handoff -----------------------------------------------

  pi.registerCommand("handoff", {
    description: "Control plane handoff advisor. Usage: /handoff [current_provider]",
    handler: async (args, ctx) => {
      const currentProvider = (args ?? "").trim() || undefined;
      const advisory = await buildHandoffAdvisory(ctx.cwd, currentProvider);

      const lines: string[] = [
        "handoff advisor",
        `generated: ${advisory.generatedAtIso.slice(0, 19)}Z`,
        `current: ${advisory.currentProvider ?? "(unknown)"} [${advisory.currentState}]`,
        "",
      ];

      if (advisory.recommended) {
        lines.push("RECOMMENDATION:");
        lines.push(`  next:    ${advisory.recommended.provider}`);
        lines.push(`  model:   ${advisory.recommended.modelRef}`);
        lines.push(`  switch:  ${advisory.recommended.switchCommand}`);
        lines.push(`  reason:  ${advisory.recommended.reason.slice(0, 120)}`);
      } else {
        lines.push("No available provider found.");
        if (advisory.blockedProviders.length > 0) {
          lines.push(`Blocked: ${advisory.blockedProviders.join(", ")}`);
        }
        lines.push("Action: configure routeModelRefs or adjust budgets in .pi/settings.json.");
      }

      lines.push("", "candidates:");
      for (const c of advisory.candidates) {
        const avail = c.available ? "avail" : "unavail";
        lines.push(
          `  ${c.provider.padEnd(24)} score=${c.score} budget=${c.budgetState} readiness=${c.readiness} [${avail}]`
        );
      }

      lines.push("", "noAutoSwitch: true — confirm before switching.");

      ctx.ui.notify(
        lines.join("\n"),
        advisory.currentState === "block" ? "error"
          : advisory.currentState === "warn" ? "warning"
            : "info"
      );
    },
  });
}
