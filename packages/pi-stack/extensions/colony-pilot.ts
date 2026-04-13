/**
 * colony-pilot — Session visibility + colony runtime orchestration primitive.
 *
 * Goals:
 * - Give one first-party command surface to orchestrate colony pilot runs
 * - Make "web server running" and "background colony running" states visible
 * - Keep behavior generic (not tightly coupled to one package internals)
 *
 * Current bridge strategy:
 * - Delegates execution to existing slash commands (/monitors, /remote, /colony)
 * - Tracks state heuristically from emitted messages and tool outputs
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

type MonitorMode = "on" | "off" | "unknown";

type ColonyPhase =
  | "launched"
  | "task_done"
  | "completed"
  | "failed"
  | "aborted"
  | "scouting"
  | "running"
  | "unknown";

interface ColonyState {
  id: string;
  phase: ColonyPhase;
  updatedAt: number;
}

export interface PilotState {
  monitorMode: MonitorMode;
  remoteActive: boolean;
  remoteUrl?: string;
  remoteClients?: number;
  colonies: Map<string, ColonyState>;
  lastSessionFile?: string;
}

const COLONY_SIGNAL_RE = /\[COLONY_SIGNAL:([A-Z_]+)\]\s*\[([^\]]+)\]/i;
const REMOTE_URL_RE = /(https?:\/\/[^\s]+\?t=[^\s]+)/i;
const REMOTE_CLIENTS_RE = /Remote active\s*·\s*(\d+) client/i;

export function createPilotState(): PilotState {
  return {
    monitorMode: "unknown",
    remoteActive: false,
    colonies: new Map(),
  };
}

export function parseColonySignal(text: string): { phase: ColonyPhase; id: string } | undefined {
  const m = text.match(COLONY_SIGNAL_RE);
  if (!m) return undefined;

  const raw = m[1].toLowerCase();
  const id = m[2].trim();

  const phase: ColonyPhase =
    raw === "launched"
      ? "launched"
      : raw === "task_done"
        ? "task_done"
        : raw === "completed"
          ? "completed"
          : raw === "failed"
            ? "failed"
            : raw === "aborted"
              ? "aborted"
              : raw === "scouting"
                ? "scouting"
                : raw === "running"
                  ? "running"
                  : "unknown";

  return { phase, id };
}

export function parseRemoteAccessUrl(text: string): string | undefined {
  const m = text.match(REMOTE_URL_RE);
  return m?.[1];
}

export function buildColonyRunSequence(goal: string): string[] {
  return ["/monitors off", "/remote", `/colony ${goal}`];
}

export function buildColonyStopSequence(options?: { restoreMonitors?: boolean }): string[] {
  const out = ["/colony-stop all", "/remote stop"];
  if (options?.restoreMonitors) out.push("/monitors on");
  return out;
}

function extractText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as { content?: unknown };
  const { content } = msg;

  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: string };
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    }
  }
  return parts.join("\n");
}

function renderStatus(state: PilotState): string | undefined {
  const colonies = state.colonies.size;
  if (!state.remoteActive && colonies === 0 && state.monitorMode === "unknown") return undefined;

  const monitors = `monitors=${state.monitorMode}`;
  const web = `web=${state.remoteActive ? "on" : "off"}`;
  const ants = `colonies=${colonies}`;
  return `[pilot] ${monitors} · ${web} · ${ants}`;
}

function formatSnapshot(state: PilotState): string {
  const colonyRows = [...state.colonies.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => `  - ${c.id}: ${c.phase} (${new Date(c.updatedAt).toLocaleTimeString()})`);

  return [
    "colony-pilot status",
    `monitorMode: ${state.monitorMode}`,
    `remote: ${state.remoteActive ? "active" : "inactive"}`,
    `remoteUrl: ${state.remoteUrl ?? "(none)"}`,
    `remoteClients: ${state.remoteClients ?? 0}`,
    `sessionFile: ${state.lastSessionFile ?? "(ephemeral)"}`,
    `colonies: ${state.colonies.size}`,
    ...(colonyRows.length > 0 ? ["", ...colonyRows] : []),
  ].join("\n");
}

function updateStatusUI(ctx: ExtensionContext | undefined, state: PilotState) {
  ctx?.ui?.setStatus?.("colony-pilot", renderStatus(state));
}

function trackFromText(text: string, state: PilotState): boolean {
  let changed = false;

  const signal = parseColonySignal(text);
  if (signal) {
    const current = state.colonies.get(signal.id);
    state.colonies.set(signal.id, {
      id: signal.id,
      phase: signal.phase,
      updatedAt: Date.now(),
    });

    if (
      signal.phase === "completed" ||
      signal.phase === "failed" ||
      signal.phase === "aborted"
    ) {
      // Keep short-term completion visibility; can be pruned later if needed.
    }

    changed = !current || current.phase !== signal.phase;
  }

  const remoteUrl = parseRemoteAccessUrl(text);
  if (remoteUrl) {
    state.remoteActive = true;
    state.remoteUrl = remoteUrl;
    changed = true;
  }

  const clients = text.match(REMOTE_CLIENTS_RE)?.[1];
  if (clients) {
    const count = Number.parseInt(clients, 10);
    if (!Number.isNaN(count)) {
      state.remoteClients = count;
      state.remoteActive = true;
      changed = true;
    }
  }

  if (/Remote access stopped/i.test(text)) {
    state.remoteActive = false;
    state.remoteClients = 0;
    changed = true;
  }

  return changed;
}

export function applyTelemetryText(state: PilotState, text: string): boolean {
  return trackFromText(text, state);
}

export function snapshotPilotState(state: PilotState) {
  return {
    monitorMode: state.monitorMode,
    remoteActive: state.remoteActive,
    remoteUrl: state.remoteUrl,
    remoteClients: state.remoteClients ?? 0,
    sessionFile: state.lastSessionFile,
    colonies: [...state.colonies.values()].map((c) => ({
      id: c.id,
      phase: c.phase,
      updatedAt: c.updatedAt,
    })),
  };
}

function queueSlashCommands(pi: ExtensionAPI, commands: string[]) {
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    if (i === 0) {
      pi.sendUserMessage(command);
    } else {
      pi.sendUserMessage(command, { deliverAs: "followUp" });
    }
  }
}

async function tryOpenUrl(pi: ExtensionAPI, url: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const r = await pi.exec("cmd", ["/c", "start", "", url], { timeout: 5000 });
      return r.code === 0;
    }
    if (process.platform === "darwin") {
      const r = await pi.exec("open", [url], { timeout: 5000 });
      return r.code === 0;
    }

    const r = await pi.exec("xdg-open", [url], { timeout: 5000 });
    return r.code === 0;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  const state: PilotState = createPilotState();

  let currentCtx: ExtensionContext | undefined;

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    state.colonies.clear();
    state.remoteActive = false;
    state.remoteUrl = undefined;
    state.remoteClients = 0;
    state.monitorMode = "unknown";
    state.lastSessionFile = ctx.sessionManager.getSessionFile?.() ?? undefined;
    updateStatusUI(ctx, state);
  });

  pi.on("message_end", (event, ctx) => {
    const text = extractText((event as { message?: unknown }).message);
    if (!text) return;
    if (trackFromText(text, state)) updateStatusUI(ctx, state);
  });

  pi.on("tool_result", (event, ctx) => {
    const text = extractText(event);
    if (!text) return;
    if (trackFromText(text, state)) updateStatusUI(ctx, state);
  });

  pi.registerTool({
    name: "colony_pilot_status",
    label: "Colony Pilot Status",
    description: "Mostra o estado atual do pilot: monitores, remote web e colonies em background.",
    parameters: Type.Object({}),
    async execute() {
      const snapshot = snapshotPilotState(state);

      return {
        content: [{ type: "text", text: JSON.stringify(snapshot, null, 2) }],
        details: snapshot,
      };
    },
  });

  pi.registerCommand("colony-pilot", {
    description: "Orquestra pilot de colony + web inspect + profile de monitores (run/status/stop/web).",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const input = (args ?? "").trim();
      const [cmd, ...rest] = input.length > 0 ? input.split(/\s+/) : [];

      if (!cmd || cmd === "help") {
        ctx.ui.notify(
          [
            "Usage: /colony-pilot <command>",
            "",
            "Commands:",
            "  prep                          Mostrar plano recomendado do pilot",
            "  run <goal>                    Despacha: /monitors off -> /remote -> /colony <goal>",
            "  stop [--restore-monitors]     Despacha: /colony-stop all -> /remote stop [-> /monitors on]",
            "  monitors <on|off>             Alterna profile de monitores da sessão atual",
            "  web <start|stop|open|status>  Controla/inspeciona sessão web",
            "  tui                           Mostra como entrar/retomar sessão no TUI",
            "  status                        Snapshot consolidado",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "prep") {
        ctx.ui.notify(
          [
            "Pilot direction:",
            "- colony run com monitores gerais OFF",
            "- governança principal: mecanismos da colony (inclui soldier)",
            "- inspeção ativa por web remote + TUI status",
            "",
            "Comandos base:",
            "  /monitors off",
            "  /remote",
            "  /colony <goal>",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (cmd === "status") {
        ctx.ui.notify(formatSnapshot(state), "info");
        return;
      }

      if (cmd === "run") {
        const goal = rest.join(" ").trim();
        if (!goal) {
          ctx.ui.notify("Usage: /colony-pilot run <goal>", "warning");
          return;
        }

        const sequence = buildColonyRunSequence(goal);
        queueSlashCommands(pi, sequence);
        state.monitorMode = "off";
        updateStatusUI(ctx, state);

        ctx.ui.notify(
          `Pilot run despachado (${sequence.length} passos):\n${sequence.map((s) => `  - ${s}`).join("\n")}`,
          "info"
        );
        return;
      }

      if (cmd === "stop") {
        const restore = rest.includes("--restore-monitors");
        const sequence = buildColonyStopSequence({ restoreMonitors: restore });
        queueSlashCommands(pi, sequence);
        if (restore) state.monitorMode = "on";
        updateStatusUI(ctx, state);
        ctx.ui.notify(
          `Pilot stop despachado:\n${sequence.map((s) => `  - ${s}`).join("\n")}`,
          "warning"
        );
        return;
      }

      if (cmd === "monitors") {
        const mode = rest[0];
        if (mode !== "on" && mode !== "off") {
          ctx.ui.notify("Usage: /colony-pilot monitors <on|off>", "warning");
          return;
        }

        queueSlashCommands(pi, [`/monitors ${mode}`]);
        state.monitorMode = mode;
        updateStatusUI(ctx, state);
        ctx.ui.notify(`Profile de monitores despachado: ${mode.toUpperCase()}`, "info");
        return;
      }

      if (cmd === "web") {
        const action = rest[0] ?? "status";

        if (action === "start") {
          queueSlashCommands(pi, ["/remote"]);
          ctx.ui.notify("Solicitado start do remote web server (/remote).", "info");
          return;
        }

        if (action === "stop") {
          queueSlashCommands(pi, ["/remote stop"]);
          state.remoteActive = false;
          state.remoteClients = 0;
          updateStatusUI(ctx, state);
          ctx.ui.notify("Solicitado stop do remote web server (/remote stop).", "warning");
          return;
        }

        if (action === "open") {
          if (!state.remoteUrl) {
            ctx.ui.notify("Nenhuma URL remote detectada ainda. Rode /colony-pilot web start e depois /colony-pilot status.", "warning");
            return;
          }

          const ok = await tryOpenUrl(pi, state.remoteUrl);
          if (ok) {
            ctx.ui.notify(`Abrindo browser: ${state.remoteUrl}`, "info");
          } else {
            ctx.ui.notify(`Nao consegui abrir automaticamente. URL: ${state.remoteUrl}`, "warning");
          }
          return;
        }

        if (action === "status") {
          const lines = [
            `remote: ${state.remoteActive ? "active" : "inactive"}`,
            `clients: ${state.remoteClients ?? 0}`,
            `url: ${state.remoteUrl ?? "(none)"}`,
          ];
          ctx.ui.notify(lines.join("\n"), "info");
          return;
        }

        ctx.ui.notify("Usage: /colony-pilot web <start|stop|open|status>", "warning");
        return;
      }

      if (cmd === "tui") {
        ctx.ui.notify(
          [
            "TUI session access:",
            "- Nesta instância você já está na sessão ativa.",
            "- Em outro terminal, abra `pi` e use `/resume` para entrar nesta sessão.",
            `- Session file atual: ${state.lastSessionFile ?? "(ephemeral / sem arquivo)"}`,
          ].join("\n"),
          "info"
        );
        return;
      }

      ctx.ui.notify(`Comando desconhecido: ${cmd}. Use /colony-pilot help`, "warning");
    },
  });

  pi.on("session_shutdown", () => {
    updateStatusUI(currentCtx, {
      ...state,
      monitorMode: "unknown",
      remoteActive: false,
      colonies: new Map(),
    });
  });
}
