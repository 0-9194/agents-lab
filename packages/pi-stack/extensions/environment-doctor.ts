/**
 * environment-doctor — Health check extension for pi-stack.
 *
 * On session_start, runs a quick environment check and shows a status
 * widget if tools are missing or unconfigured. Provides /doctor command
 * for deeper manual diagnostics.
 *
 * Never blocks — only informs and suggests.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface CheckResult {
  name: string;
  status: "ok" | "missing" | "unauth";
  message: string;
  fix?: string;
}

async function checkTool(
  pi: ExtensionAPI,
  name: string,
  command: string,
  versionArgs: string[],
  authCheck?: { command: string; args: string[]; failHint: string }
): Promise<CheckResult> {
  try {
    const result = await pi.exec(command, versionArgs, { timeout: 5000 });
    if (result.code !== 0) {
      return {
        name,
        status: "missing",
        message: `${name} não encontrado`,
        fix: `Instalar: https://github.com/cli/cli#installation`,
      };
    }

    if (authCheck) {
      try {
        const authResult = await pi.exec(authCheck.command, authCheck.args, { timeout: 5000 });
        if (authResult.code !== 0) {
          return {
            name,
            status: "unauth",
            message: `${name} instalado mas não autenticado`,
            fix: authCheck.failHint,
          };
        }
      } catch {
        return {
          name,
          status: "unauth",
          message: `${name} instalado mas autenticação não verificada`,
          fix: authCheck.failHint,
        };
      }
    }

    const version = result.stdout?.trim().split("\n")[0] ?? "";
    return { name, status: "ok", message: version };
  } catch {
    return {
      name,
      status: "missing",
      message: `${name} não encontrado no PATH`,
    };
  }
}

async function runChecks(pi: ExtensionAPI): Promise<CheckResult[]> {
  const checks = await Promise.all([
    checkTool(pi, "git", "git", ["--version"]),
    checkTool(pi, "gh", "gh", ["--version"], {
      command: "gh",
      args: ["auth", "status"],
      failHint: "Executar: gh auth login",
    }),
    checkTool(pi, "glab", "glab", ["--version"], {
      command: "glab",
      args: ["auth", "status"],
      failHint: "Executar: glab auth login",
    }),
    checkTool(pi, "node", "node", ["--version"]),
    checkTool(pi, "npm", "npm", ["--version"]),
  ]);

  return checks;
}

function formatResults(results: CheckResult[]): string {
  const lines: string[] = [];
  const issues = results.filter((r) => r.status !== "ok");

  if (issues.length === 0) {
    lines.push("✅ Ambiente completo — todas as ferramentas configuradas.");
    return lines.join("\n");
  }

  lines.push(`⚠️ ${issues.length} item(s) precisam de atenção:\n`);

  for (const issue of issues) {
    const icon = issue.status === "missing" ? "❌" : "🔑";
    lines.push(`${icon} ${issue.name}: ${issue.message}`);
    if (issue.fix) {
      lines.push(`   → ${issue.fix}`);
    }
  }

  lines.push("");
  lines.push("O pi não está bloqueado, mas funcionalidades que dependem dessas ferramentas serão limitadas.");

  return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
  // Quick check on session start — only notify if issues found
  pi.on("session_start", async (_event, ctx) => {
    const results = await runChecks(pi);
    const issues = results.filter((r) => r.status !== "ok");

    if (issues.length > 0) {
      const labels = issues.map((i) => {
        const icon = i.status === "missing" ? "❌" : "🔑";
        return `${icon} ${i.name}`;
      });
      ctx.ui?.setStatus?.(
        "env-doctor",
        `${labels.join("  ")} — /doctor para detalhes`
      );
    }
  });

  // Full diagnostics command
  pi.registerCommand("doctor", {
    description: "Diagnóstico do ambiente — verifica ferramentas e autenticações",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Verificando ambiente...", "info");
      const results = await runChecks(pi);
      const report = formatResults(results);

      // Show as notification lines
      const lines = report.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          ctx.ui.notify(line, "info");
        }
      }

      // Clear status if all OK
      const issues = results.filter((r) => r.status !== "ok");
      if (issues.length === 0) {
        ctx.ui.setStatus?.("env-doctor", undefined);
      }
    },
  });
}
