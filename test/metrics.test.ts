import { describe, expect, it } from "vitest";
import { expectedCalibrationError, brierScore, reliabilityTable, passAtK } from "../src/index.js";

describe("calibration metrics", () => {
  it("a perfectly calibrated judge has ~0 ECE", () => {
    // 10 predictions at 0.9 confidence, 9 correct -> bucket [0.9,1.0] predicted 0.9, empirical 0.9.
    const preds = Array.from({ length: 10 }, (_, i) => ({ confidence: 0.9, correct: i < 9 }));
    expect(expectedCalibrationError(preds)).toBeCloseTo(0, 5);
  });

  it("an overconfident judge has positive ECE", () => {
    // Claims 0.95 confidence but is only 50% correct.
    const preds = Array.from({ length: 10 }, (_, i) => ({ confidence: 0.95, correct: i < 5 }));
    expect(expectedCalibrationError(preds)).toBeCloseTo(0.45, 5);
  });

  it("Brier rewards confident-correct and punishes confident-wrong", () => {
    expect(brierScore([{ confidence: 1, correct: true }])).toBeCloseTo(0);
    expect(brierScore([{ confidence: 1, correct: false }])).toBeCloseTo(1);
    expect(brierScore([{ confidence: 0.5, correct: true }])).toBeCloseTo(0.25);
  });

  it("the reliability table buckets by confidence", () => {
    const table = reliabilityTable([{ confidence: 0.05, correct: false }, { confidence: 0.95, correct: true }], 10);
    expect(table[0]?.count).toBe(1);
    expect(table[9]?.count).toBe(1);
    expect(table[9]?.empirical).toBe(1);
  });
});

describe("Pass^k", () => {
  it("all-pass runs give Pass^k = 1", () => {
    expect(passAtK([true, true, true, true], 2).passHatK).toBeCloseTo(1);
  });
  it("fewer than k passes gives Pass^k = 0", () => {
    expect(passAtK([true, false, false, false], 2).passHatK).toBeCloseTo(0);
  });
  it("uses the unbiased subset estimator", () => {
    // 4 runs, 2 passes, k=2 -> C(2,2)/C(4,2) = 1/6.
    expect(passAtK([true, true, false, false], 2).passHatK).toBeCloseTo(1 / 6, 5);
  });
  it("rejects k greater than the trial count", () => {
    expect(() => passAtK([true], 2)).toThrow();
  });
});
