import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSnapshotFilename,
  parseSnapshotMeta,
  applySafeCoreProfile,
  SAFE_CORE_PROFILE,
  listSnapshots,
  saveSnapshot,
  restoreSnapshot,
  snapshotDir,
  settingsPath,
} from "../../extensions/safe-boot";

// ---------------------------------------------------------------------------
// buildSnapshotFilename
// ---------------------------------------------------------------------------

describe("safe-boot — buildSnapshotFilename", () => {
  it("gera nome com stamp e tag", () => {
    const name = buildSnapshotFilename("pre-safe-boot", "2026-04-16T10:30:00.000Z");
    expect(name).toBe("20260416-103000-pre-safe-boot.json");
  });

  it("sanitiza caracteres especiais na tag", () => {
    const name = buildSnapshotFilename("my tag/file", "2026-04-16T10:30:00.000Z");
    expect(name).toContain("my-tag-file");
  });

  it("trunca tag em 40 caracteres", () => {
    const longTag = "a".repeat(60);
    const name = buildSnapshotFilename(longTag, "2026-04-16T10:30:00.000Z");
    const tag = name.replace("20260416-103000-", "").replace(".json", "");
    expect(tag.length).toBeLessThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// parseSnapshotMeta
// ---------------------------------------------------------------------------

describe("safe-boot — parseSnapshotMeta", () => {
  it("parseia nome valido", () => {
    const meta = parseSnapshotMeta("20260416-103000-pre-safe-boot.json", "/tmp/snaps");
    expect(meta).not.toBeUndefined();
    expect(meta!.tag).toBe("pre-safe-boot");
    expect(meta!.savedAtIso).toBe("2026-04-16T10:30:00Z");
    expect(meta!.filename).toBe("20260416-103000-pre-safe-boot.json");
  });

  it("retorna undefined para nome invalido", () => {
    expect(parseSnapshotMeta("invalid.json", "/tmp")).toBeUndefined();
    expect(parseSnapshotMeta("random-file.json", "/tmp")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applySafeCoreProfile
// ---------------------------------------------------------------------------

describe("safe-boot — applySafeCoreProfile", () => {
  it("aplica delivery mode report-only sobre configuracao existente", () => {
    const current = {
      piStack: {
        colonyPilot: {
          deliveryPolicy: { enabled: true, mode: "apply-to-branch", requireWorkspaceReport: true },
        },
      },
    };
    const result = applySafeCoreProfile(current);
    expect((result as Record<string, unknown>).piStack).toBeDefined();
    const piStack = (result as Record<string, unknown>).piStack as Record<string, unknown>;
    const colony = piStack.colonyPilot as Record<string, unknown>;
    const delivery = colony.deliveryPolicy as Record<string, unknown>;
    expect(delivery.mode).toBe("report-only");
    expect(delivery.enabled).toBe(true);
  });

  it("preserva campos nao cobertos pelo perfil safe-core", () => {
    const current = {
      packages: ["../pi-stack"],
      myCustomField: "preserved",
      piStack: {
        quotaVisibility: { defaultDays: 30 },
      },
    };
    const result = applySafeCoreProfile(current) as Record<string, unknown>;
    expect(result.myCustomField).toBe("preserved");
    expect(result.packages).toEqual(["../pi-stack"]);
    const piStack = result.piStack as Record<string, unknown>;
    const qv = piStack.quotaVisibility as Record<string, unknown>;
    expect(qv.defaultDays).toBe(30);
  });

  it("aplica scheduler policy observe", () => {
    const current = {
      piStack: { schedulerGovernance: { policy: "enforce" } },
    };
    const result = applySafeCoreProfile(current) as Record<string, unknown>;
    const piStack = result.piStack as Record<string, unknown>;
    const sched = piStack.schedulerGovernance as Record<string, unknown>;
    expect(sched.policy).toBe("observe");
    expect(sched.enabled).toBe(true);
  });

  it("aceita objeto vazio como base", () => {
    const result = applySafeCoreProfile({});
    expect(result).toBeDefined();
    const piStack = (result as Record<string, unknown>).piStack as Record<string, unknown>;
    expect(piStack).toBeDefined();
  });

  it("SAFE_CORE_PROFILE inclui todos os invariantes esperados", () => {
    const piStack = SAFE_CORE_PROFILE.piStack as Record<string, unknown>;
    const colony = piStack.colonyPilot as Record<string, unknown>;
    const delivery = colony.deliveryPolicy as Record<string, unknown>;
    const scheduler = piStack.schedulerGovernance as Record<string, unknown>;
    const gateway = piStack.webSessionGateway as Record<string, unknown>;

    expect(delivery.mode).toBe("report-only");
    expect(scheduler.policy).toBe("observe");
    expect(gateway.mode).toBe("local");
    expect(delivery.blockOnMissingEvidence).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listSnapshots / saveSnapshot / restoreSnapshot (I/O)
// ---------------------------------------------------------------------------

describe("safe-boot — snapshot I/O", () => {
  it("listSnapshots retorna lista vazia quando dir nao existe", () => {
    expect(listSnapshots("/nonexistent/path/xyz")).toHaveLength(0);
  });

  it("saveSnapshot cria arquivo no diretorio de snapshots", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-boot-test-"));
    try {
      const piDir = join(dir, ".pi");
      mkdirSync(piDir, { recursive: true });
      writeFileSync(join(piDir, "settings.json"), JSON.stringify({ piStack: {} }, null, 2), "utf8");

      const meta = saveSnapshot(dir, "test-tag");
      expect(meta.tag).toBe("test-tag");
      expect(existsSync(meta.snapshotPath)).toBe(true);

      const snaps = listSnapshots(dir);
      expect(snaps).toHaveLength(1);
      expect(snaps[0].tag).toBe("test-tag");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restoreSnapshot restaura settings.json a partir do snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-boot-restore-"));
    try {
      const piDir = join(dir, ".pi");
      mkdirSync(piDir, { recursive: true });
      const original = { piStack: { colonyPilot: { deliveryPolicy: { mode: "apply-to-branch" } } } };
      writeFileSync(join(piDir, "settings.json"), JSON.stringify(original, null, 2), "utf8");

      const meta = saveSnapshot(dir, "pre-test");

      // Overwrite settings with safe-core profile
      const safeSettings = { piStack: { colonyPilot: { deliveryPolicy: { mode: "report-only" } } } };
      writeFileSync(join(piDir, "settings.json"), JSON.stringify(safeSettings, null, 2), "utf8");

      // Restore
      const result = restoreSnapshot(dir, meta.filename);
      expect(result.restored).toBe(true);

      const restored = JSON.parse(
        require("node:fs").readFileSync(settingsPath(dir), "utf8")
      );
      expect(restored.piStack.colonyPilot.deliveryPolicy.mode).toBe("apply-to-branch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restoreSnapshot retorna erro quando arquivo nao existe", () => {
    const dir = mkdtempSync(join(tmpdir(), "safe-boot-nofile-"));
    try {
      const result = restoreSnapshot(dir, "nonexistent.json");
      expect(result.restored).toBe(false);
      expect(result.error).toBeDefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
