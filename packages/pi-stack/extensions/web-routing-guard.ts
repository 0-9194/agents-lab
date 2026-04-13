/**
 * web-routing-guard — Deterministic scoped routing guard for interactive web prompts.
 *
 * Stage A implementation:
 * 1) Pre-router: classify prompt deterministically before agent start.
 * 2) Enforcement: when strict mode is active, block disallowed bash scraping commands.
 *
 * Trigger for strict mode (both required):
 * - Interactive intent in prompt (open/navigate/click/fill/login/etc)
 * - Sensitive domain present (e.g. npmjs.com) OR Cloudflare/bot-block hints
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

const INTERACTIVE_TERMS = [
  "open",
  "abrir",
  "abra",
  "navigate",
  "navegar",
  "navegue",
  "click",
  "clicar",
  "clique",
  "fill",
  "preencher",
  "preencha",
  "login",
  "log in",
  "submit",
  "enviar",
  "envie",
  "form",
  "formulário",
  "formulario",
  "tab",
  "button",
  "botão",
  "botao",
];

const SENSITIVE_DOMAINS = ["npmjs.com"];

const SENSITIVE_HINTS = [
  "cloudflare",
  "bot block",
  "bloqueio",
  "captcha",
  "challenge",
];

const DISALLOWED_BASH_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /python(?:3)?\b[\s\S]*?requests/i,
  /r\.jina\.ai/i,
  /\bnpm\s+view\b/i,
  /registry\.npmjs\.org/i,
];

const CDP_SCRIPT_HINT = /web-browser[\/\\]scripts|scripts[\/\\](start|nav|eval|pick|screenshot|dismiss-cookies|watch|logs-tail|net-summary)\.js/i;

export interface RoutingDecision {
  interactive: boolean;
  sensitiveDomain: boolean;
  sensitiveHint: boolean;
  strictMode: boolean;
  domains: string[];
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

export function extractDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const domains: string[] = [];

  const urlMatches = lower.match(/https?:\/\/[^\s)"']+/g) ?? [];
  for (const raw of urlMatches) {
    try {
      const host = new URL(raw).hostname.replace(/^www\./, "");
      if (host) domains.push(host);
    } catch {
      // ignore malformed URLs
    }
  }

  const domainLikeMatches = lower.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/g) ?? [];
  for (const d of domainLikeMatches) {
    domains.push(d.replace(/^www\./, ""));
  }

  return uniq(domains);
}

export function hasInteractiveIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return INTERACTIVE_TERMS.some((term) => lower.includes(term));
}

export function classifyRouting(prompt: string): RoutingDecision {
  const lower = prompt.toLowerCase();
  const domains = extractDomains(lower);

  const interactive = hasInteractiveIntent(lower);
  const sensitiveDomain = domains.some((d) => SENSITIVE_DOMAINS.some((sd) => d === sd || d.endsWith(`.${sd}`)));
  const sensitiveHint = SENSITIVE_HINTS.some((hint) => lower.includes(hint));

  return {
    interactive,
    sensitiveDomain,
    sensitiveHint,
    strictMode: interactive && (sensitiveDomain || sensitiveHint),
    domains,
  };
}

export function isDisallowedBash(command: string): boolean {
  const lower = command.toLowerCase();
  if (CDP_SCRIPT_HINT.test(lower)) return false;
  return DISALLOWED_BASH_PATTERNS.some((p) => p.test(lower));
}

export default function (pi: ExtensionAPI) {
  let strictMode = false;

  pi.on("session_start", () => {
    strictMode = false;
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const decision = classifyRouting(event.prompt ?? "");
    strictMode = decision.strictMode;

    if (!strictMode) return undefined;

    const domains = decision.domains.length > 0 ? decision.domains.join(", ") : "(none)";
    ctx.ui?.setStatus?.("web-routing-guard", "[web-routing-guard] strict_interactive=on");
    ctx.ui?.notify?.(
      `web-routing-guard: strict mode ativo (interactive+sensitive). domains=${domains}`,
      "info"
    );

    const hardPrompt = [
      event.systemPrompt,
      "",
      "Scoped hard routing guard (deterministic) is active for this turn.",
      "- For this task, start with web-browser CDP scripts only.",
      "- Do not use curl/wget/python-requests/r.jina.ai/npm view/registry.npmjs.org as primary path.",
      "- If CDP path fails, explain failure explicitly before proposing fallback.",
    ].join("\n");

    return { systemPrompt: hardPrompt };
  });

  pi.on("tool_call", async (event) => {
    if (!strictMode) return undefined;
    if (!isToolCallEventType("bash", event)) return undefined;

    const command = event.input.command ?? "";
    if (!isDisallowedBash(command)) return undefined;

    return {
      block: true,
      reason:
        "Blocked by web-routing-guard (strict_interactive): use web-browser CDP scripts first for interactive sensitive-domain tasks.",
    };
  });

  pi.on("agent_end", (event, ctx) => {
    if (!strictMode) return;
    strictMode = false;
    ctx.ui?.setStatus?.("web-routing-guard", undefined);
  });
}
