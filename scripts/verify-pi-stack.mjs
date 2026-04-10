#!/usr/bin/env node
/**
 * Verifica se packages/pi-stack/node_modules está corretamente populado.
 * Checa os entry points críticos que o pi precisa para carregar as extensions.
 *
 * Uso: node scripts/verify-pi-stack.mjs
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const root = "packages/pi-stack/node_modules";

const checks = [
  // Monitors — essencial, causa falha silenciosa se ausente
  ["@davidorex/pi-project-workflows/monitors-extension.ts", "monitors (hedge, fragility, etc.)"],
  ["@davidorex/pi-project-workflows/project-extension.ts", "project blocks (.project/)"],
  ["@davidorex/pi-project-workflows/workflows-extension.ts", "workflows YAML"],
  // Core extensions
  ["pi-lens/index.ts", "pi-lens (LSP, ast-grep)"],
  ["pi-web-access/index.ts", "pi-web-access (fetch, PDF)"],
  ["@ifi/oh-pi-extensions/extensions/safe-guard.ts", "safe-guard"],
  ["@ifi/oh-pi-extensions/extensions/bg-process.ts", "bg-process"],
  ["mitsupi/pi-extensions/multi-edit.ts", "multi-edit"],
  // Skills
  ["@ifi/oh-pi-skills/skills/debug-helper/SKILL.md", "debug-helper skill"],
  ["mitsupi/skills/web-browser/SKILL.md", "web-browser skill"],
];

let failed = 0;

for (const [path, label] of checks) {
  const full = join(root, path);
  if (existsSync(full)) {
    console.log(`  ✅ ${label}`);
  } else {
    console.error(`  ❌ ${label} — ausente: ${full}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} verificação(ões) falharam.`);
  console.error("Execute: npm install --prefix packages/pi-stack --no-workspaces");
  process.exit(1);
} else {
  console.log(`\n✅ pi-stack ok — ${checks.length} verificações passaram.`);
}
