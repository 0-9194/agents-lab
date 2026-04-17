#!/usr/bin/env node

/**
 * pi pilot profile toggle
 *
 * Explicitly manages the third-party capability overlay required for colony pilot:
 * - @davidorex/pi-project-workflows  -> /monitors
 * - @ifi/pi-web-remote               -> /remote
 * - @ifi/oh-pi-ant-colony            -> /colony, /colony-stop
 *
 * Usage:
 *   node scripts/pi-pilot-profile.mjs status [--project|-l]
 *   node scripts/pi-pilot-profile.mjs on [--project|-l]
 *   node scripts/pi-pilot-profile.mjs off [--project|-l]
 *
 * Default scope is user (~/.pi/agent/settings.json) to avoid dirtying repo files.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const IS_WINDOWS = process.platform === "win32";

function getSettingsPath(scope) {
  if (scope === "project") return join(process.cwd(), ".pi", "settings.json");
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(agentDir, "settings.json");
}

const PILOT_PACKAGES = [
  "@davidorex/pi-project-workflows",
  "@ifi/pi-web-remote",
  "@ifi/oh-pi-ant-colony",
];

function runCommand(cmd, args, options = {}) {
  if (IS_WINDOWS) {
    // Avoid Node DEP0190 warning by passing a single command string when shell=true.
    // Args used by this script are fixed and controlled (no untrusted user input).
    const commandLine = [cmd, ...args].join(" ");
    return execFileSync(commandLine, {
      shell: true,
      ...options,
    });
  }

  return execFileSync(cmd, args, {
    shell: false,
    ...options,
  });
}

function findPi() {
  const candidates = IS_WINDOWS ? ["pi.cmd", "pi"] : ["pi"];
  for (const cmd of candidates) {
    try {
      runCommand(cmd, ["--version"], { stdio: "ignore" });
      return cmd;
    } catch {
      // continue
    }
  }

  throw new Error("pi command not found in PATH");
}

function parseArgs(argv) {
  const mode = argv[2] ?? "status";
  if (!["status", "on", "off"].includes(mode)) {
    throw new Error(`invalid mode: ${mode}`);
  }

  const scope = argv.includes("--project") || argv.includes("-l") ? "project" : "user";
  return { mode, scope };
}

function extractSource(entry) {
  return typeof entry === "string" ? entry : entry?.source;
}

function extractPkg(source) {
  if (typeof source !== "string" || !source.startsWith("npm:")) return undefined;
  const spec = source.slice(4);

  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash === -1) return undefined;
    const at = spec.indexOf("@", slash + 1);
    return at === -1 ? spec : spec.slice(0, at);
  }

  const at = spec.indexOf("@");
  return at === -1 ? spec : spec.slice(0, at);
}

function getConfiguredPilotPackages(scope) {
  const settingsPath = getSettingsPath(scope);
  if (!existsSync(settingsPath)) return new Set();
  const json = JSON.parse(readFileSync(settingsPath, "utf8"));
  const entries = Array.isArray(json.packages) ? json.packages : [];

  const found = new Set();
  for (const entry of entries) {
    const pkg = extractPkg(extractSource(entry));
    if (pkg && PILOT_PACKAGES.includes(pkg)) {
      found.add(pkg);
    }
  }
  return found;
}

function runPi(pi, args, label) {
  process.stdout.write(`  ${label} ... `);
  try {
    runCommand(pi, args, {
      stdio: "pipe",
      timeout: 120_000,
    });
    console.log("✓");
    return true;
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    if (/already installed|already exists|not installed|not found|No such/i.test(stderr)) {
      console.log("✓");
      return true;
    }
    console.log("✗");
    if (stderr.trim()) {
      console.log(`    ${stderr.trim().split("\n")[0]}`);
    }
    return false;
  }
}

function printStatus(scope) {
  const configured = getConfiguredPilotPackages(scope);
  const settingsPath = getSettingsPath(scope);
  console.log(`\npi pilot profile (${scope} scope):`);
  console.log(`settings: ${settingsPath}\n`);

  for (const pkg of PILOT_PACKAGES) {
    const marker = configured.has(pkg) ? "✓" : "-";
    console.log(`  ${marker} ${pkg}`);
  }

  console.log("\nTip: after changing profile, run /reload in pi session.");
}

function ensureOn(pi, scope) {
  console.log(`\nEnabling pilot profile (${scope} scope) ...\n`);
  let failures = 0;

  for (const pkg of PILOT_PACKAGES) {
    const args = ["install", `npm:${pkg}`];
    if (scope === "project") args.push("-l");
    const ok = runPi(pi, args, pkg);
    if (!ok) failures++;
  }

  if (failures === 0) {
    console.log("\n✅ Pilot profile enabled. Run /reload in pi.");
  } else {
    console.log(`\n⚠️  ${failures} package(s) failed.`);
    process.exitCode = 1;
  }
}

function ensureOff(pi, scope) {
  console.log(`\nDisabling pilot profile (${scope} scope) ...\n`);
  let failures = 0;

  for (const pkg of PILOT_PACKAGES) {
    const args = ["remove", `npm:${pkg}`];
    if (scope === "project") args.push("-l");
    const ok = runPi(pi, args, pkg);
    if (!ok) failures++;
  }

  if (failures === 0) {
    console.log("\n✅ Pilot profile disabled. Run /reload in pi.");
  } else {
    console.log(`\n⚠️  ${failures} package(s) failed.`);
    process.exitCode = 1;
  }
}

const { mode, scope } = parseArgs(process.argv);

if (mode === "status") {
  printStatus(scope);
  process.exit(0);
}

const pi = findPi();

if (mode === "on") {
  ensureOn(pi, scope);
} else {
  ensureOff(pi, scope);
}
