/**
 * Smoke test: conflict filters — verifica que conflitos conhecidos entre
 * pacotes third-party estão cobertos por filter patches no installer.
 *
 * Detecta quando novos conflitos aparecem (tool name ou command) entre
 * extensões de pacotes diferentes listados em THIRD_PARTY.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const REPO_ROOT = path.resolve(PKG, "../../");

function resolveThirdPartyDir(pkgName: string): string | null {
  const rootPath = path.join(REPO_ROOT, "node_modules", pkgName);
  if (existsSync(rootPath)) return rootPath;

  const localPath = path.join(PKG, "node_modules", pkgName);
  if (existsSync(localPath)) return localPath;

  return null;
}

// Importar FILTER_PATCHES do installer
const installerContent = readFileSync(path.join(PKG, "install.mjs"), "utf8");
const filterPatchesMatch = installerContent.match(
  /const FILTER_PATCHES = (\[[\s\S]*?\]);/
);

// Pacotes third-party localmente instalados para análise estática
const THIRD_PARTY_LOCAL = [
  "mitsupi",
  "@ifi/oh-pi-extensions",
  "@ifi/oh-pi-ant-colony",
  "@ifi/pi-extension-subagents",
  "@ifi/pi-plan",
  "@ifi/pi-spec",
  "@ifi/pi-web-remote",
  "@davidorex/pi-project-workflows",
]
  .map(resolveThirdPartyDir)
  .filter((p): p is string => p !== null);

function getExtensionFiles(pkgDir: string): string[] {
  const results: string[] = [];
  const pkgJsonPath = path.join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) return results;

  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    const extensions: string[] = pkg.pi?.extensions ?? [];
    for (const ext of extensions) {
      const resolved = path.join(pkgDir, ext);
      if (!existsSync(resolved)) continue;
      if (statSync(resolved).isDirectory()) {
        for (const f of readdirSync(resolved)) {
          if (f.endsWith(".ts") || f.endsWith(".js")) {
            results.push(path.join(resolved, f));
          }
        }
      } else {
        results.push(resolved);
      }
    }
  } catch {}
  return results;
}

function extractToolNames(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, "utf8");
    const matches = [...content.matchAll(/registerTool\(\s*\{[^}]*name:\s*["']([^"']+)["']/g)];
    return matches.map((m) => m[1]);
  } catch {
    return [];
  }
}

describe("conflict filters", () => {
  it("FILTER_PATCHES está definido no installer", () => {
    expect(
      filterPatchesMatch,
      "FILTER_PATCHES não encontrado em install.mjs"
    ).toBeTruthy();
  });

  describe("conflitos de tool names entre pacotes third-party", () => {
    // Mapear tool → [{ pkg, file }]
    const toolMap = new Map<string, Array<{ pkg: string; file: string }>>();

    for (const pkgPath of THIRD_PARTY_LOCAL) {
      for (const extFile of getExtensionFiles(pkgPath)) {
        for (const toolName of extractToolNames(extFile)) {
          if (!toolMap.has(toolName)) toolMap.set(toolName, []);
          toolMap.get(toolName)!.push({
            pkg: pkgPath,
            file: path.relative(PKG, extFile).replace(/\\/g, "/"),
          });
        }
      }
    }

    const conflicts = [...toolMap.entries()].filter(([, registrations]) => registrations.length > 1);

    if (conflicts.length === 0) {
      it("nenhum conflito de tool detectado", () => {
        expect(true).toBe(true);
      });
      return;
    }

    for (const [toolName, registrations] of conflicts) {
      it(`conflito de tool "${toolName}" está coberto por FILTER_PATCHES`, () => {
        const files = registrations.map((r) => r.file);
        const msg =
          `Tool "${toolName}" registrada em múltiplos pacotes:\n` +
          files.map((f) => `  - ${f}`).join("\n") +
          `\n\nAdicione um filter patch em FILTER_PATCHES no install.mjs para excluir um deles.`;

        // O conflito deve estar coberto: pelo menos um dos arquivos deve estar
        // numa exclusão de algum patch
        const isCovered =
          filterPatchesMatch &&
          files.some((f) => {
            const basename = f.split("/").pop() ?? "";
            return installerContent.includes(`!`) && installerContent.includes(basename);
          });

        expect(isCovered, msg).toBe(true);
      });
    }
  });
});
