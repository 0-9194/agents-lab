import { describe, expect, it } from "vitest";
import {
  computeHandoffScore,
  isAvailable,
  selectNextProvider,
  type ProviderHandoffScore,
} from "../../extensions/handoff-advisor";

describe("handoff-advisor — computeHandoffScore", () => {
  it("ok + ready = 0 (melhor possivel)", () => {
    expect(computeHandoffScore("ok", "ready")).toBe(0);
  });

  it("blocked em qualquer dimensao = alto score", () => {
    expect(computeHandoffScore("blocked", "ready")).toBeGreaterThanOrEqual(10);
    expect(computeHandoffScore("ok", "blocked")).toBeGreaterThanOrEqual(10);
  });

  it("warning + ready < blocked + ready", () => {
    expect(computeHandoffScore("warning", "ready")).toBeLessThan(computeHandoffScore("blocked", "ready"));
  });

  it("ok + degraded < ok + blocked", () => {
    expect(computeHandoffScore("ok", "degraded")).toBeLessThan(computeHandoffScore("ok", "blocked"));
  });

  it("unknown + unconfigured = score intermediario", () => {
    const s = computeHandoffScore("unknown", "unconfigured");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(20);
  });
});

describe("handoff-advisor — isAvailable", () => {
  it("ok + ready = disponivel", () => {
    expect(isAvailable("ok", "ready")).toBe(true);
  });

  it("warning + ready = disponivel (ainda usavel)", () => {
    expect(isAvailable("warning", "ready")).toBe(true);
  });

  it("blocked + ready = nao disponivel", () => {
    expect(isAvailable("blocked", "ready")).toBe(false);
  });

  it("ok + blocked = nao disponivel", () => {
    expect(isAvailable("ok", "blocked")).toBe(false);
  });

  it("ok + unconfigured = nao disponivel (sem routeModelRef)", () => {
    expect(isAvailable("ok", "unconfigured")).toBe(false);
  });

  it("ok + degraded = disponivel (degradado mas usavel)", () => {
    expect(isAvailable("ok", "degraded")).toBe(true);
  });
});

describe("handoff-advisor — selectNextProvider", () => {
  const makeCandidates = (specs: Array<[string, string, string, boolean]>): ProviderHandoffScore[] =>
    specs.map(([provider, budgetState, readiness, available]) => ({
      provider,
      modelRef: `${provider}/model-1`,
      budgetState: budgetState as ProviderHandoffScore["budgetState"],
      readiness: readiness as ProviderHandoffScore["readiness"],
      score: computeHandoffScore(budgetState, readiness),
      available,
    }));

  it("seleciona o melhor candidato disponivel", () => {
    const candidates = makeCandidates([
      ["provider-a", "warning", "ready", true],
      ["provider-b", "ok", "ready", true],
      ["provider-c", "blocked", "ready", false],
    ]);
    const result = selectNextProvider(candidates, undefined);
    expect(result?.provider).toBe("provider-b"); // lowest score
  });

  it("exclui o provider atual dos candidatos", () => {
    const candidates = makeCandidates([
      ["provider-a", "ok", "ready", true],
      ["provider-b", "ok", "ready", true],
    ]);
    const result = selectNextProvider(candidates, "provider-a");
    expect(result?.provider).toBe("provider-b");
  });

  it("retorna null quando nenhum candidato disponivel alem do atual", () => {
    const candidates = makeCandidates([
      ["provider-a", "ok", "ready", true],
      ["provider-b", "blocked", "ready", false],
    ]);
    const result = selectNextProvider(candidates, "provider-a");
    expect(result).toBeNull();
  });

  it("retorna null em lista vazia", () => {
    expect(selectNextProvider([], undefined)).toBeNull();
  });

  it("desempate por nome de provider (alfabetico)", () => {
    const candidates = makeCandidates([
      ["provider-z", "ok", "ready", true],
      ["provider-a", "ok", "ready", true],
    ]);
    // Both score 0, tie-broken by name
    const result = selectNextProvider(candidates, undefined);
    expect(result?.provider).toBe("provider-a");
  });
});
