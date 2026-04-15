#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_ANNOTATION_FILES = [
  "packages/pi-stack/extensions/guardrails-core.ts",
  "packages/pi-stack/extensions/colony-pilot.ts",
  "packages/pi-stack/extensions/web-session-gateway.ts",
  "packages/pi-stack/extensions/quota-visibility.ts",
  "packages/pi-stack/extensions/environment-doctor.ts",
  "packages/pi-stack/extensions/scheduler-governance.ts",
  "packages/pi-stack/extensions/monitor-provider-patch.ts",
  "packages/pi-stack/extensions/stack-sovereignty.ts",
];

export function parseArgs(argv) {
  const out = {
    base: process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main",
    registry: "packages/pi-stack/extensions/data/capability-owners.json",
    strict: true,
  };

  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--base") out.base = args[++i] ?? out.base;
    else if (a === "--registry") out.registry = args[++i] ?? out.registry;
    else if (a === "--no-strict") out.strict = false;
    else if (a === "--strict") out.strict = true;
  }

  out.registry = resolve(out.registry);
  return out;
}

export function readRegistry(path) {
  if (!existsSync(path)) return { version: "unknown", capabilities: [] };
  try {
    const json = JSON.parse(readFileSync(path, "utf8"));
    const capabilities = Array.isArray(json?.capabilities) ? json.capabilities : [];
    return {
      version: typeof json?.version === "string" ? json.version : "unknown",
      capabilities,
    };
  } catch {
    return { version: "unknown", capabilities: [] };
  }
}

export function listChangedEntries(baseRef) {
  const tries = [
    `git diff --name-status ${baseRef}...HEAD`,
    "git diff --name-status HEAD~1..HEAD",
    "git diff --name-status",
  ];

  for (const cmd of tries) {
    try {
      const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString("utf8").trim();
      if (!out) continue;
      return out
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const [status, ...rest] = line.split(/\s+/);
          const file = rest.at(-1);
          return { status: (status ?? "").toUpperCase(), file };
        })
        .filter((r) => typeof r.file === "string" && r.file.length > 0);
    } catch {
      // try next strategy
    }
  }

  return [];
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export function parseCapabilityAnnotations(content) {
  const id = content.match(/@capability-id\s+([a-z0-9-]+)/i)?.[1];
  const criticality = content.match(/@capability-criticality\s+(high|medium|low)/i)?.[1]?.toLowerCase();
  return { id, criticality };
}

export function isExtensionFile(file) {
  return /^packages\/pi-stack\/extensions\/.+\.ts$/i.test(file.replace(/\\/g, "/"));
}

export function maybeCapabilityBearing(content) {
  return /registerCommand\(|registerTool\(|pi\.on\(/.test(content);
}

export function evaluateDiffGate({ changedEntries, registry, filesContent }) {
  const registryById = new Map(
    (registry.capabilities ?? [])
      .filter((c) => c && typeof c.id === "string")
      .map((c) => [c.id, c])
  );

  const changed = changedEntries.map((e) => e.file);
  const extensionFiles = changed.filter(isExtensionFile);
  const addedExtensionFiles = new Set(
    changedEntries
      .filter((e) => /^A/.test(e.status) && isExtensionFile(e.file))
      .map((e) => e.file)
  );

  const blockers = [];
  const notes = [];

  for (const file of extensionFiles) {
    if (!(file in filesContent)) continue;
    const content = filesContent[file] ?? "";
    if (!maybeCapabilityBearing(content)) continue;

    const ann = parseCapabilityAnnotations(content);
    if (!ann.id || !ann.criticality) {
      const normalizedFile = file.replace(/\\/g, "/");
      // Final enforcement: all changed capability-bearing extensions must be annotated.
      blockers.push(`${file}: missing capability annotations (required)`);
      if (addedExtensionFiles.has(file) || REQUIRED_ANNOTATION_FILES.includes(normalizedFile)) {
        // already blocker; kept for explicit semantics
      }
      continue;
    }

    const reg = registryById.get(ann.id);
    if (!reg) {
      if (ann.criticality === "high") {
        blockers.push(`${file}: high critical capability '${ann.id}' is not present in capability-owners.json`);
      } else {
        notes.push(`${file}: capability '${ann.id}' not found in registry`);
      }
      continue;
    }

    const regCrit = String(reg.criticality ?? "medium").toLowerCase();
    if (regCrit !== ann.criticality) {
      blockers.push(`${file}: criticality mismatch for '${ann.id}' (code=${ann.criticality}, registry=${regCrit})`);
    }
  }

  return {
    changedCount: changed.length,
    extensionCount: extensionFiles.length,
    addedExtensionCount: addedExtensionFiles.size,
    blockers,
    notes,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const registry = readRegistry(args.registry);
  const changedEntries = listChangedEntries(args.base);

  const filesContent = {};
  for (const e of changedEntries) {
    if (!isExtensionFile(e.file)) continue;
    if (!existsSync(e.file)) continue;
    filesContent[e.file] = readText(e.file);
  }

  const result = evaluateDiffGate({ changedEntries, registry, filesContent });

  console.log(`[sovereignty-diff-gate] registry=${args.registry} version=${registry.version}`);
  console.log(
    `[sovereignty-diff-gate] changedFiles=${result.changedCount} extensionFiles=${result.extensionCount} addedExtensions=${result.addedExtensionCount}`
  );

  if (result.notes.length > 0) {
    console.log("[sovereignty-diff-gate] notes:");
    for (const n of result.notes) console.log(`  - ${n}`);
  }

  if (result.blockers.length > 0) {
    console.error("[sovereignty-diff-gate] blockers:");
    for (const b of result.blockers) console.error(`  - ${b}`);
    if (args.strict) process.exit(1);
  }

  console.log(`[sovereignty-diff-gate] ok (blockers=${result.blockers.length}, strict=${args.strict})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
