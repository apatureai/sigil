import { describe, expect, it } from "vitest";
import {
  mcnemarExact,
  verifySwitchQuality,
  certifiedPassKLowerBound,
  type PairedOutcome,
} from "../src/index.js";

describe("mcnemarExact", () => {
  it("matches the hand-computed exact value for (5,1)", () => {
    // n=6, k=1: p = 2 * (C(6,0)+C(6,1)) / 2^6 = 14/64 = 0.21875
    expect(mcnemarExact(5, 1).pValue).toBeCloseTo(0.21875, 10);
  });

  it("matches the hand-computed value for (10,0)", () => {
    expect(mcnemarExact(10, 0).pValue).toBeCloseTo(2 / 1024, 12);
  });

  it("is symmetric and p=1 with no discordance", () => {
    expect(mcnemarExact(3, 8).pValue).toBeCloseTo(mcnemarExact(8, 3).pValue, 12);
    expect(mcnemarExact(0, 0).pValue).toBe(1);
  });

  it("rejects invalid counts", () => {
    expect(() => mcnemarExact(-1, 0)).toThrow();
    expect(() => mcnemarExact(0.5, 1)).toThrow();
  });
});

describe("verifySwitchQuality", () => {
  const pairs = (currentOnly: number, candidateOnly: number, both: number): PairedOutcome[] => [
    ...Array.from({ length: currentOnly }, () => ({ currentPassed: true, candidatePassed: false })),
    ...Array.from({ length: candidateOnly }, () => ({ currentPassed: false, candidatePassed: true })),
    ...Array.from({ length: both }, () => ({ currentPassed: true, candidatePassed: true })),
  ];

  it("defensible when discordance is balanced noise", () => {
    const evidence = verifySwitchQuality(pairs(4, 3, 40));
    expect(evidence.defensible).toBe(true);
    expect(evidence.statement).toContain("no significant quality loss");
    expect(evidence.statement).toContain("not proof of equality");
  });

  it("refuses the claim when the candidate is significantly worse", () => {
    const evidence = verifySwitchQuality(pairs(12, 0, 40));
    expect(evidence.defensible).toBe(false);
    expect(evidence.mcnemar.pValue).toBeLessThan(0.05);
    expect(evidence.statement).toContain("NOT defensible");
  });

  it("a significantly BETTER candidate stays defensible", () => {
    const evidence = verifySwitchQuality(pairs(0, 12, 40));
    expect(evidence.defensible).toBe(true);
  });

  it("reports pass rates over all pairs", () => {
    const evidence = verifySwitchQuality(pairs(2, 1, 7));
    expect(evidence.pairs).toBe(10);
    expect(evidence.currentPassRate).toBeCloseTo(0.9, 6);
    expect(evidence.candidatePassRate).toBeCloseTo(0.8, 6);
  });
});

describe("certifiedPassKLowerBound", () => {
  it("all-passes floor matches δ^(1/n) raised to k", () => {
    const trials = Array.from({ length: 10 }, () => true);
    const cert = certifiedPassKLowerBound(trials, 3, 0.05);
    const pLower = 0.05 ** (1 / 10);
    expect(cert.passRateLower).toBeCloseTo(pLower, 6);
    expect(cert.passKLower).toBeCloseTo(pLower ** 3, 6);
    expect(cert.statement).toContain("independent runs");
  });

  it("the floor is below the naive point estimate power", () => {
    const trials = [...Array.from({ length: 9 }, () => true), false];
    const cert = certifiedPassKLowerBound(trials, 2, 0.05);
    expect(cert.passKLower).toBeLessThan(0.9 ** 2);
    expect(cert.passKLower).toBeGreaterThan(0);
  });

  it("rejects empty trials and invalid k", () => {
    expect(() => certifiedPassKLowerBound([], 1, 0.05)).toThrow();
    expect(() => certifiedPassKLowerBound([true], 0, 0.05)).toThrow();
  });
});
