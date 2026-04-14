import { describe, it, expect } from "vitest";
import {
  extractUsage,
  parseProviderWindowHours,
  computeWindowStartScores,
  buildProviderWindowInsight,
  type QuotaUsageEvent,
} from "../../extensions/quota-visibility";

describe("quota-visibility parsers", () => {
  it("extractUsage normaliza formatos de usage/cost", () => {
    const u = extractUsage({
      input: 100,
      output: 50,
      cacheRead: 25,
      totalTokens: 175,
      cost: { total: 0.0123 },
    });

    expect(u.totalTokens).toBe(175);
    expect(u.input).toBe(100);
    expect(u.output).toBe(50);
    expect(u.cacheRead).toBe(25);
    expect(u.costTotalUsd).toBeCloseTo(0.0123);
  });

  it("parseProviderWindowHours aceita apenas chaves válidas", () => {
    const map = parseProviderWindowHours({
      anthropic: 5,
      "openai-codex": "5",
      "": 2,
      invalid: 99,
    });

    expect(map).toEqual({
      anthropic: 5,
      "openai-codex": 5,
    });
  });

  it("computeWindowStartScores soma janela circular corretamente", () => {
    const hourly = Array.from({ length: 24 }, () => 0);
    hourly[14] = 100;
    hourly[15] = 50;

    const scores = computeWindowStartScores(hourly, 5);

    expect(scores[11]).toBe(150); // 11..15
    expect(scores[10]).toBe(100); // 10..14
    expect(scores[0]).toBe(0);
  });

  it("buildProviderWindowInsight destaca pico e início antes do pico", () => {
    const base = Date.UTC(2026, 3, 14, 0, 0, 0);
    const events: QuotaUsageEvent[] = [
      {
        timestampIso: new Date(base + 14 * 3600_000).toISOString(),
        timestampMs: base + 14 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 14,
        provider: "anthropic",
        model: "claude-sonnet",
        tokens: 1200,
        costUsd: 0.02,
        sessionFile: "s1.jsonl",
      },
      {
        timestampIso: new Date(base + 15 * 3600_000).toISOString(),
        timestampMs: base + 15 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 15,
        provider: "anthropic",
        model: "claude-sonnet",
        tokens: 900,
        costUsd: 0.015,
        sessionFile: "s1.jsonl",
      },
      {
        timestampIso: new Date(base + 3 * 3600_000).toISOString(),
        timestampMs: base + 3 * 3600_000,
        dayLocal: "2026-04-14",
        hourLocal: 3,
        provider: "anthropic",
        model: "claude-sonnet",
        tokens: 100,
        costUsd: 0.002,
        sessionFile: "s2.jsonl",
      },
    ];

    const insight = buildProviderWindowInsight("anthropic", 5, events, 7);

    expect(insight.provider).toBe("anthropic");
    expect(insight.windowHours).toBe(5);
    expect(insight.observedTokens).toBe(2200);
    expect(insight.peakHoursLocal[0]).toBe(14);
    expect(insight.suggestedStartHoursBeforePeakLocal).toContain(9);
    expect(insight.highestDemandWindowStartsLocal).toContain(11);
  });
});
