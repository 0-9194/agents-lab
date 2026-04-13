/**
 * monitor-provider-patch — Automatically patches behavior monitor classifiers
 * when the default provider is github-copilot.
 *
 * Problem: @davidorex/pi-behavior-monitors ships classifier agents with
 * `model: claude-sonnet-4-6` (bare model name, no provider prefix).
 * When the user's defaultProvider is github-copilot, pi cannot resolve
 * this bare name and monitors silently fail to load.
 *
 * Solution: On session_start, detect if github-copilot is the default
 * provider and create .pi/agents/ overrides with the correct model spec.
 * Never overwrites existing overrides (respects user customization).
 * Does nothing for other providers — only github-copilot needs this patch.
 *
 * Upstream issue: https://github.com/davidorex/pi-project-workflows/issues/1
 */

// Hedge monitor note: conversation_history is patched separately by
// ensureHedgeMonitorContext to keep context windows lean by default.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Classifier names from @davidorex/pi-behavior-monitors */
const CLASSIFIERS = [
  "commit-hygiene-classifier",
  "fragility-classifier",
  "hedge-classifier",
  "unauthorized-action-classifier",
  "work-quality-classifier",
] as const;

/** Model to use when patching for github-copilot */
const COPILOT_MODEL = "github-copilot/claude-haiku-4.5";

/**
 * Settings key that controls whether conversation_history is included in the
 * hedge monitor context. Defaults to false (excluded).
 * Set `extensions.monitorProviderPatch.hedgeConversationHistory = true` to opt in.
 */
const HEDGE_HISTORY_SETTING_PATH = ["extensions", "monitorProviderPatch", "hedgeConversationHistory"];

/**
 * Reads a nested boolean setting from pi settings (project → global cascade).
 * Returns the boolean value, or `undefined` if not set.
 */
export function detectBooleanSetting(cwd: string, path: string[]): boolean | undefined {
  const candidates = [
    join(cwd, ".pi", "settings.json"),
    join(homedir(), ".pi", "agent", "settings.json"),
  ];

  for (const settingsPath of candidates) {
    if (!existsSync(settingsPath)) continue;
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let cursor: any = settings;
      for (const key of path) {
        if (cursor == null || typeof cursor !== "object") { cursor = undefined; break; }
        cursor = cursor[key];
      }
      if (typeof cursor === "boolean") return cursor;
    } catch {
      // Corrupted settings — skip
    }
  }
  return undefined;
}

/**
 * Reads defaultProvider from pi settings (project → global).
 * Returns undefined if not set.
 */
export function detectDefaultProvider(cwd: string): string | undefined {
  const candidates = [
    join(cwd, ".pi", "settings.json"),
    join(homedir(), ".pi", "agent", "settings.json"),
  ];

  for (const settingsPath of candidates) {
    if (!existsSync(settingsPath)) continue;
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      if (settings.defaultProvider) return settings.defaultProvider;
    } catch {
      // Corrupted settings — skip
    }
  }
  return undefined;
}

/**
 * Generates agent YAML override content for a classifier.
 */
export function generateAgentYaml(classifierName: string, model: string): string {
  const monitorName = classifierName.replace("-classifier", "");
  const descriptions: Record<string, string> = {
    "commit-hygiene": "Classifies whether agent committed changes with proper hygiene",
    fragility: "Classifies whether agent left unaddressed fragilities",
    hedge: "Classifies whether assistant deviated from user intent",
    "unauthorized-action": "Classifies whether agent is about to take an unauthorized action",
    "work-quality": "Classifies work quality issues in agent output",
  };

  return [
    `name: ${classifierName}`,
    `role: sensor`,
    `description: ${descriptions[monitorName] ?? `Classifier for ${monitorName}`}`,
    `model: ${model}`,
    `thinking: "off"`,
    `output:`,
    `  format: json`,
    `  schema: ../schemas/verdict.schema.json`,
    `prompt:`,
    `  task:`,
    `    template: ${monitorName}/classify.md`,
    ``,
  ].join("\n");
}

/**
 * Ensures .pi/agents/ overrides exist for all classifiers.
 * Returns the number of files created.
 */
export function ensureOverrides(cwd: string, model: string): { created: string[]; skipped: string[] } {
  const agentsDir = join(cwd, ".pi", "agents");
  const created: string[] = [];
  const skipped: string[] = [];

  for (const classifier of CLASSIFIERS) {
    const filePath = join(agentsDir, `${classifier}.agent.yaml`);
    if (existsSync(filePath)) {
      skipped.push(classifier);
      continue;
    }
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(filePath, generateAgentYaml(classifier, model), "utf8");
    created.push(classifier);
  }

  return { created, skipped };
}

/**
 * Ensures the hedge monitor context includes or excludes conversation_history.
 * When `includeConversationHistory` is false (default), the field is removed.
 * When true, an empty array placeholder is added if the field is absent.
 * Returns true if the file was modified.
 */
export function ensureHedgeMonitorContext(
  cwd: string,
  includeConversationHistory: boolean
): boolean {
  const monitorPath = join(cwd, ".pi", "monitors", "hedge.monitor.json");
  if (!existsSync(monitorPath)) return false;

  let monitor: Record<string, unknown>;
  try {
    monitor = JSON.parse(readFileSync(monitorPath, "utf8"));
  } catch {
    return false;
  }

  const hasHistory = "conversation_history" in monitor;

  if (!includeConversationHistory && hasHistory) {
    delete monitor["conversation_history"];
    writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
    return true;
  }

  if (includeConversationHistory && !hasHistory) {
    monitor["conversation_history"] = [];
    writeFileSync(monitorPath, JSON.stringify(monitor, null, 2) + "\n", "utf8");
    return true;
  }

  return false;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const includeHistory = detectBooleanSetting(ctx.cwd, HEDGE_HISTORY_SETTING_PATH) ?? false;
    const hedgeChanged = ensureHedgeMonitorContext(ctx.cwd, includeHistory);

    const provider = detectDefaultProvider(ctx.cwd);
    if (provider !== "github-copilot") return;

    const { created } = ensureOverrides(ctx.cwd, COPILOT_MODEL);

    const details: string[] = [];
    if (created.length > 0) details.push(`criou ${created.length} override(s) para ${provider}`);
    if (hedgeChanged) details.push(`hedge: conversation_history ${includeHistory ? "habilitado" : "removido"}`);

    if (details.length > 0) {
      ctx.ui?.notify?.(
        `monitor-provider-patch: ${details.join(", ")}`,
        "info"
      );
    }
  });
}
