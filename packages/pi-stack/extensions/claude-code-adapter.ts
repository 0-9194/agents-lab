/**
 * claude-code-adapter — experimental external runtime bridge.
 * @capability-id claude-code-adapter
 * @capability-criticality medium
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export interface ClaudeCodeRuntimeStatus {
  available: boolean;
  binaryPath?: string;
  authStatus: "authenticated" | "unauthenticated" | "unknown";
  notes: string[];
}

export function parseWhichLikeOutput(stdout: string): string | undefined {
  const line = (stdout ?? "").split(/\r?\n/).map((x) => x.trim()).find(Boolean);
  return line && line.length > 0 ? line : undefined;
}

async function detectClaudeBinary(pi: ExtensionAPI): Promise<string | undefined> {
  const candidates = process.platform === "win32"
    ? [["where", ["claude"]], ["where", ["claude-code"]]]
    : [["which", ["claude"]], ["which", ["claude-code"]]];

  for (const [cmd, args] of candidates) {
    try {
      const r = await pi.exec(cmd, args, { timeout: 5000 });
      if (r.code !== 0) continue;
      const path = parseWhichLikeOutput(r.stdout ?? "");
      if (path) return path;
    } catch {
      // ignore probe failures
    }
  }

  return undefined;
}

async function detectClaudeAuth(pi: ExtensionAPI, binaryPath: string): Promise<ClaudeCodeRuntimeStatus["authStatus"]> {
  const cmd = binaryPath.toLowerCase().endsWith(".exe") ? binaryPath : "claude";
  try {
    const r = await pi.exec(cmd, ["auth", "status"], { timeout: 8000 });
    if (r.code !== 0) return "unauthenticated";
    const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.toLowerCase();
    if (out.includes("not logged") || out.includes("unauth")) return "unauthenticated";
    return "authenticated";
  } catch {
    return "unknown";
  }
}

export default function claudeCodeAdapterExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "claude_code_adapter_status",
    label: "Claude Code Adapter Status",
    description: "Experimental Claude Code adapter health (binary + auth-status).",
    parameters: Type.Object({}),
    async execute() {
      const binaryPath = await detectClaudeBinary(pi);
      const available = Boolean(binaryPath);
      const authStatus = binaryPath ? await detectClaudeAuth(pi, binaryPath) : "unknown";
      const notes: string[] = [];

      if (!available) notes.push("Claude Code binary not found (expected: claude/claude-code in PATH).");
      if (available && authStatus !== "authenticated") {
        notes.push("Use official CLI auth flow: 'claude auth login'.");
        notes.push("Browser automation (CDP/Puppeteer) should remain local opt-in fallback only.");
      }

      const payload: ClaudeCodeRuntimeStatus = { available, binaryPath, authStatus, notes };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        details: payload,
      };
    },
  });

  pi.registerCommand("claude-code", {
    description: "Experimental Claude Code runtime bridge (status/auth/login guidance).",
    handler: async (args, ctx) => {
      const cmd = (args ?? "status").trim().toLowerCase();
      const binaryPath = await detectClaudeBinary(pi);
      const available = Boolean(binaryPath);

      if (cmd === "status" || !cmd) {
        const authStatus = binaryPath ? await detectClaudeAuth(pi, binaryPath) : "unknown";
        ctx.ui.notify(
          [
            "claude-code adapter",
            `available: ${available ? "yes" : "no"}`,
            `binary: ${binaryPath ?? "(not found)"}`,
            `authStatus: ${authStatus}`,
            "credentials: never persisted by this adapter",
          ].join("\n"),
          available ? "info" : "warning"
        );
        return;
      }

      if (cmd === "login") {
        ctx.ui.notify(
          [
            "claude-code login bridge",
            "Use official login flow:",
            "  claude auth login",
            "Fallback: execute manually in your terminal if browser automation fails.",
            "No credentials are stored by pi-stack.",
          ].join("\n"),
          "info"
        );
        ctx.ui.setEditorText?.("claude auth login");
        return;
      }

      if (cmd === "auth-status") {
        const authStatus = binaryPath ? await detectClaudeAuth(pi, binaryPath) : "unknown";
        ctx.ui.notify(`claude-code auth-status: ${authStatus}`, authStatus === "authenticated" ? "info" : "warning");
        return;
      }

      ctx.ui.notify("Usage: /claude-code <status|login|auth-status>", "warning");
    },
  });
}
