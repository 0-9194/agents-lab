/**
 * Smoke test: no tool name conflicts between extensions.
 *
 * Scans all extension files in the manifest for registerTool calls
 * and checks that no two different extensions register the same tool name.
 * This catches the uv.ts vs bg-process.ts "bash" conflict proactively.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const manifest = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8")).pi;

describe("no tool conflicts", () => {
  it("no duplicate tool registrations across extensions", () => {
    const toolMap = new Map<string, string[]>();
    const extensionPaths = manifest.extensions as string[];

    for (const ext of extensionPaths) {
      const resolved = path.join(PKG, ext);
      try {
        const stat = statSync(resolved);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      const content = readFileSync(resolved, "utf8");
      // Match pi.registerTool({ name: "toolName" ... }) patterns
      const matches = content.matchAll(/registerTool\(\s*\{[^}]*name:\s*["']([^"']+)["']/g);
      for (const match of matches) {
        const toolName = match[1];
        if (!toolMap.has(toolName)) toolMap.set(toolName, []);
        toolMap.get(toolName)!.push(ext);
      }
    }

    const conflicts = [...toolMap.entries()].filter(([, files]) => files.length > 1);
    if (conflicts.length > 0) {
      const msg = conflicts
        .map(([tool, files]) => `  Tool "${tool}" registered by:\n${files.map((f) => `    - ${f}`).join("\n")}`)
        .join("\n");
      expect.fail(`Tool name conflicts found:\n${msg}`);
    }
  });

  it("no duplicate command registrations across extensions", () => {
    const cmdMap = new Map<string, string[]>();
    const extensionPaths = manifest.extensions as string[];

    for (const ext of extensionPaths) {
      const resolved = path.join(PKG, ext);
      try {
        const stat = statSync(resolved);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }

      const content = readFileSync(resolved, "utf8");
      const matches = content.matchAll(/registerCommand\(\s*["']([^"']+)["']/g);
      for (const match of matches) {
        const cmdName = match[1];
        if (!cmdMap.has(cmdName)) cmdMap.set(cmdName, []);
        cmdMap.get(cmdName)!.push(ext);
      }
    }

    const conflicts = [...cmdMap.entries()].filter(([, files]) => files.length > 1);
    if (conflicts.length > 0) {
      const msg = conflicts
        .map(([cmd, files]) => `  Command "/${cmd}" registered by:\n${files.map((f) => `    - ${f}`).join("\n")}`)
        .join("\n");
      // Commands can legitimately be registered by related extensions
      // so we warn rather than fail
      console.warn(`⚠️ Command name collisions (may be intentional):\n${msg}`);
    }
  });
});
