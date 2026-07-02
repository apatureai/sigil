import { describe, expect, it } from "vitest";
import {
  clopperPearsonUpper,
  clopperPearsonLower,
  certifyAbstentionThreshold,
  type JudgePrediction,
} from "../src/index.js";

describe("Clopper–Pearson exact bounds", () => {
  it("zero errors matches the closed form 1 − δ^(1/n)", () => {
    // n=20, δ=0.05: 1 − 0.05^(1/20) = 0.139103…
    expect(clopperPearsonUpper(0, 20, 0.05)).toBeCloseTo(1 - 0.05 ** (1 / 20), 6);
  });

  it("all-successes lower bound matches the closed form δ^(1/n)", () => {
    // n=10, δ=0.05: 0.05^(1/10) = 0.741134…
    expect(clopperPearsonLower(10, 10, 0.05)).toBeCloseTo(0.05 ** (1 / 10), 6);
  });

  it("upper bound is monotone in the error count and covers the MLE", () => {
    const u0 = clopperPearsonUpper(0, 50, 0.05);
    const u1 = clopperPearsonUpper(1, 50, 0.05);
    const u5 = clopperPearsonUpper(5, 50, 0.05);
    expect(u0).toBeLessThan(u1);
    expect(u1).toBeLessThan(u5);
    expect(u5).toBeGreaterThan(5 / 50);
  });

  it("degenerate cases: errors=n gives 1; tighter δ gives a wider bound", () => {
    expect(clopperPearsonUpper(10, 10, 0.05)).toBe(1);
    expect(clopperPearsonUpper(2, 40, 0.01)).toBeGreaterThan(clopperPearsonUpper(2, 40, 0.1));
  });

  it("rejects invalid inputs", () => {
    expect(() => clopperPearsonUpper(-1, 10, 0.05)).toThrow();
    expect(() => clopperPearsonUpper(11, 10, 0.05)).toThrow();
    expect(() => clopperPearsonUpper(1, 10, 0)).toThrow();
    expect(() => clopperPearsonUpper(1, 10, 1)).toThrow();
  });
});

describe("certifyAbstentionThreshold (fixed-sequence Learn-Then-Test)", () => {
  const highConf = (count: number, errors: number): JudgePrediction[] =>
    Array.from({ length: count }, (_, i) => ({ confidence: 0.95, correct: i >= errors }));
  const lowConf = (count: number, errors: number): JudgePrediction[] =>
    Array.from({ length: count }, (_, i) => ({ confidence: 0.55, correct: i >= errors }));

  it("certifies a threshold that separates a reliable high-confidence band", () => {
    // 60 cases at 0.95 with 1 error; 40 cases at 0.55 with 16 errors.
    const preds = [...highConf(60, 1), ...lowConf(40, 16)];
    const cert = certifyAbstentionThreshold(preds, { targetErrorRate: 0.1, delta: 0.05 });
    expect(cert.certified).toBe(true);
    expect(cert.threshold).not.toBeNull();
    expect(cert.threshold as number).toBeGreaterThan(0.55);
    expect(cert.threshold as number).toBeLessThanOrEqual(0.95);
    expect(cert.coverage).toBeCloseTo(0.6, 6);
    expect(cert.acceptedErrors).toBe(1);
    expect(cert.errorUpperBound as number).toBeLessThanOrEqual(0.1);
    expect(cert.statement).toContain("abstained to human review");
  });

  it("the certified bound recomputes from the returned accepted set", () => {
    const preds = [...highConf(60, 1), ...lowConf(40, 16)];
    const cert = certifyAbstentionThreshold(preds, { targetErrorRate: 0.1, delta: 0.05 });
    const accepted = preds.filter((p) => p.confidence >= (cert.threshold as number));
    const errors = accepted.filter((p) => !p.correct).length;
    expect(accepted.length).toBe(cert.accepted);
    expect(errors).toBe(cert.acceptedErrors);
    expect(clopperPearsonUpper(errors, accepted.length, cert.delta)).toBeCloseTo(
      cert.errorUpperBound as number,
      12,
    );
  });

  it("fails closed when no threshold can certify the target", () => {
    // Every band is too unreliable for a 2% target on this sample size.
    const preds = [...highConf(30, 3), ...lowConf(30, 12)];
    const cert = certifyAbstentionThreshold(preds, { targetErrorRate: 0.02, delta: 0.05 });
    expect(cert.certified).toBe(false);
    expect(cert.threshold).toBeNull();
    expect(cert.errorUpperBound).toBeNull();
    expect(cert.statement).toContain("abstain or collect more labels");
  });

  it("fails closed on an empty calibration set", () => {
    const cert = certifyAbstentionThreshold([], { targetErrorRate: 0.1, delta: 0.05 });
    expect(cert.certified).toBe(false);
    expect(cert.calibrationSize).toBe(0);
  });

  it("small samples yield honest refusals: 10 clean cases cannot certify 5%", () => {
    // n=10, zero errors: exact upper bound is 1 − 0.05^(1/10) ≈ 0.259 > 0.05.
    const cert = certifyAbstentionThreshold(highConf(10, 0), { targetErrorRate: 0.05, delta: 0.05 });
    expect(cert.certified).toBe(false);
  });

  it("every grid threshold above the returned one also certifies (unbroken prefix)", () => {
    const preds = [...highConf(80, 1), ...lowConf(20, 8)];
    const cert = certifyAbstentionThreshold(preds, { targetErrorRate: 0.08, delta: 0.05 });
    expect(cert.certified).toBe(true);
    const grid = Array.from({ length: 101 }, (_, i) => (100 - i) / 100);
    for (const t of grid) {
      if (t <= (cert.threshold as number)) break;
      const accepted = preds.filter((p) => p.confidence >= t);
      if (accepted.length === 0) continue; // vacuous prefix above max confidence
      const errors = accepted.filter((p) => !p.correct).length;
      expect(clopperPearsonUpper(errors, accepted.length, 0.05)).toBeLessThanOrEqual(0.08);
    }
  });

  it("rejects a non-decreasing custom grid (guarantee would be void)", () => {
    expect(() =>
      certifyAbstentionThreshold(highConf(10, 0), {
        targetErrorRate: 0.1,
        delta: 0.05,
        thresholdGrid: [0.9, 0.9, 0.5],
      }),
    ).toThrow(/strictly decreasing/);
  });
});
