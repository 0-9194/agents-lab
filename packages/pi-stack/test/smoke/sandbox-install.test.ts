/**
 * Smoke test: sandbox install verification.
 *
 * Runs npm pack → install → load for @aretw0/pi-stack and verifies
 * that extensions load without errors. This catches broken packages
 * before publish — EJSONPARSE, missing files, bad manifests.
 */
import { describe, it, expect } from "vitest";
import { verifySandboxInstall } from "@marcfargas/pi-test-harness";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");

describe("sandbox install", () => {
  it(
    "pi-stack installs from npm pack and loads extensions",
    async () => {
      const result = await verifySandboxInstall({
        packageDir: PKG,
        expect: {
          // At minimum, our 3 first-party extensions must load
          extensions: 3,
        },
      });

      expect(result.loaded.extensionErrors).toEqual([]);
    },
    120_000 // npm pack + install can be slow
  );
});
