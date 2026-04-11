/**
 * Smoke test: all first-party extensions load without error.
 *
 * Uses pi-test-harness to run extensions through pi's real loader.
 * Only the model is replaced — extension loading, tool registration,
 * hooks, and event lifecycle run for real.
 */
import { describe, it, afterEach, expect } from "vitest";
import { createTestSession, type TestSession } from "@marcfargas/pi-test-harness";
import * as path from "node:path";

const PKG = path.resolve(__dirname, "../../");
const MOCK_TOOLS = { bash: "ok", read: "ok", write: "ok", edit: "ok" };

const FIRST_PARTY = [
  "extensions/monitor-provider-patch.ts",
  "extensions/environment-doctor.ts",
  "extensions/read-guard.ts",
];

describe("first-party extensions", () => {
  let t: TestSession;
  afterEach(() => t?.dispose());

  for (const ext of FIRST_PARTY) {
    it(`loads ${ext} without error`, async () => {
      t = await createTestSession({
        extensions: [path.join(PKG, ext)],
        mockTools: MOCK_TOOLS,
      });
      // If we get here, extension loaded successfully
    });
  }

  it("loads all first-party extensions together", async () => {
    t = await createTestSession({
      extensions: FIRST_PARTY.map((e) => path.join(PKG, e)),
      mockTools: MOCK_TOOLS,
    });
  });
});
