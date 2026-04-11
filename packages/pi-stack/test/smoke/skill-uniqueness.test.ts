/**
 * Smoke test: skill name uniqueness across all skill directories.
 *
 * Reads SKILL.md frontmatter from every skill directory in the manifest
 * and checks for name collisions. This catches the librarian collision proactively.
 *
 * Known collisions that are filtered in .pi/settings.json are excluded.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const manifest = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8")).pi;

// Collisions that are intentionally filtered in .pi/settings.json
// The excluded side is suppressed at runtime -- only the winning side loads.
const KNOWN_COLLISIONS: Record<string, string> = {
  librarian: "node_modules/mitsupi/skills/librarian", // filtered: git-checkout-cache replaces it
};

function extractSkillName(skillMdPath: string): string | null {
  try {
    const content = readFileSync(skillMdPath, "utf8");
    const match = content.match(/^---\s*\nname:\s*(.+)/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

describe("skill uniqueness", () => {
  it("no unexpected duplicate skill names", () => {
    const skillMap = new Map<string, string[]>();

    for (const skillDir of manifest.skills as string[]) {
      const resolved = path.join(PKG, skillDir);
      if (!existsSync(resolved)) continue;

      let entries: string[];
      try {
        entries = readdirSync(resolved);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const skillMd = path.join(resolved, entry, "SKILL.md");
        if (!existsSync(skillMd)) continue;

        const name = extractSkillName(skillMd);
        if (!name) continue;

        const relativePath = path.join(skillDir, entry).replace(/\\/g, "/");
        if (!skillMap.has(name)) skillMap.set(name, []);
        skillMap.get(name)!.push(relativePath);
      }
    }

    const collisions = [...skillMap.entries()]
      .filter(([, paths]) => paths.length > 1)
      .filter(([name, paths]) => {
        // Skip known collisions where the excluded path matches
        const known = KNOWN_COLLISIONS[name];
        if (known && paths.some((p) => p.includes(known.replace(/\\/g, "/")))) return false;
        return true;
      });

    if (collisions.length > 0) {
      const msg = collisions
        .map(
          ([name, paths]) =>
            `  Skill "${name}" defined in:\n${paths.map((p) => `    - ${p}`).join("\n")}`
        )
        .join("\n");
      expect.fail(`Unexpected skill name collisions:\n${msg}`);
    }
  });

  it("known collisions are documented", () => {
    // Verify that known collisions still exist (remove stale entries)
    for (const [name, excludedPath] of Object.entries(KNOWN_COLLISIONS)) {
      const resolved = path.join(PKG, excludedPath, "SKILL.md");
      expect(
        existsSync(resolved),
        `Known collision "${name}" at ${excludedPath} no longer exists -- remove from KNOWN_COLLISIONS`
      ).toBe(true);
    }
  });
});
