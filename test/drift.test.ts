import { describe, expect, it } from "vitest";
import {
  initEProcess,
  updateEProcess,
  initEDetector,
  updateEDetector,
  initCusum,
  updateCusum,
  errorObservations,
  type EProcessState,
  type EDetectorState,
} from "../src/index.js";

/**
 * Anytime-valid drift monitor tests. All expectations are hand-computed from
 * the exact supermartingale arithmetic: no simulation, no randomness.
 */

const feedE = (s: EProcessState, xs: number[]): EProcessState => xs.reduce(updateEProcess, s);
const feedD = (s: EDetectorState, xs: number[]): EDetectorState => xs.reduce(updateEDetector, s);

describe("e-process (fixed-null, Ville guarantee)", () => {
  it("hand-computed single-λ product: alarms exactly when the product crosses 1/α", () => {
    // μ0=0.5, λ=1: factor = 1 + (x − 0.5). x=1 → 1.5 per step.
    // Products: 1.5, 2.25, 3.375. α=0.4 → threshold 2.5 → alarm at t=3.
    let s = initEProcess({ mu0: 0.5, alpha: 0.4, lambdas: [1] });
    s = feedE(s, [1, 1]);
    expect(s.eValue).toBeCloseTo(2.25, 12);
    expect(s.alarmed).toBe(false);
    s = updateEProcess(s, 1);
    expect(s.eValue).toBeCloseTo(3.375, 12);
    expect(s.alarmed).toBe(true);
    expect(s.alarmedAt).toBe(3);
    expect(s.statement).toContain("ALARMED at observation 3");
    expect(s.statement).toContain("≤ 0.4");
  });

  it("observations exactly at μ0 leave the e-value at 1 forever (no drift, no alarm)", () => {
    let s = initEProcess({ mu0: 0.3, alpha: 0.05 });
    s = feedE(s, Array.from({ length: 50 }, () => 0.3));
    expect(s.eValue).toBeCloseTo(1, 12);
    expect(s.alarmed).toBe(false);
  });

  it("the mixture e-value is the mean of per-λ products (two-λ hand check)", () => {
    // μ0=0.5; λ∈{0.5,1}; x=1: factors 1.25 and 1.5 → mixture (1.25+1.5)/2.
    let s = initEProcess({ mu0: 0.5, alpha: 0.05, lambdas: [0.5, 1] });
    s = updateEProcess(s, 1);
    expect(s.perLambda[0]).toBeCloseTo(1.25, 12);
    expect(s.perLambda[1]).toBeCloseTo(1.5, 12);
    expect(s.eValue).toBeCloseTo((1.25 + 1.5) / 2, 12);
  });

  it("below-null evidence shrinks the e-value (protects the α budget)", () => {
    let s = initEProcess({ mu0: 0.5, alpha: 0.05, lambdas: [1] });
    s = feedE(s, [0, 0, 0]);
    expect(s.eValue).toBeCloseTo(0.5 ** 3, 12);
    expect(s.alarmed).toBe(false);
  });

  it("state is a plain serializable object: JSON roundtrip resumes identically", () => {
    let a = initEProcess({ mu0: 0.2, alpha: 0.1 });
    a = feedE(a, [0, 1, 0, 1, 1]);
    const resumed = JSON.parse(JSON.stringify(a)) as EProcessState;
    expect(updateEProcess(resumed, 1)).toEqual(updateEProcess(a, 1));
  });

  it("rejects invalid μ0, α, λ, and out-of-range observations", () => {
    expect(() => initEProcess({ mu0: 0, alpha: 0.05 })).toThrow();
    expect(() => initEProcess({ mu0: 0.5, alpha: 1 })).toThrow();
    expect(() => initEProcess({ mu0: 0.5, alpha: 0.05, lambdas: [2] })).toThrow(/1\/μ0/);
    expect(() => updateEProcess(initEProcess({ mu0: 0.5, alpha: 0.05 }), 1.2)).toThrow();
  });
});

describe("e-detector (changepoint, ARL guarantee)", () => {
  it("hand-computed e-CUSUM: the floor at 1 forgets a clean past", () => {
    // μ0=0.5, λ=1. Clean stretch x=0: C = max(C,1)·0.5 → 0.5 each step (floored
    // back to 1 before the next factor). Then x=1: C = max(0.5,1)·1.5 = 1.5.
    let s = initEDetector({ mu0: 0.5, alpha: 0.25, lambdas: [1] });
    s = feedD(s, [0, 0, 0]);
    expect(s.stat).toBeCloseTo(0.5, 12);
    s = updateEDetector(s, 1);
    expect(s.stat).toBeCloseTo(1.5, 12);
    // Two more hits: 2.25, 3.375 ≥ 4? threshold = 1/0.25 = 4 → not yet; third hit 5.0625 ≥ 4.
    s = feedD(s, [1, 1]);
    expect(s.stat).toBeCloseTo(3.375, 12);
    expect(s.alarmed).toBe(false);
    s = updateEDetector(s, 1);
    expect(s.alarmed).toBe(true);
    expect(s.statement).toContain("ARL ≥ 1/α");
  });

  it("detects a late change that a plain e-process has bled away", () => {
    const clean = Array.from({ length: 60 }, () => 0);
    const drift = Array.from({ length: 12 }, () => 1);
    const opts = { mu0: 0.3, alpha: 0.02, lambdas: [1.5] };

    const eProc = feedE(feedE(initEProcess(opts), clean), drift);
    const eDet = feedD(feedD(initEDetector(opts), clean), drift);
    expect(eDet.alarmed).toBe(true);
    expect(eProc.alarmed).toBe(false); // its product spent 60 steps shrinking toward 0
  });

  it("a bigger shift alarms no later than a smaller one (sanity monotonicity)", () => {
    const opts = { mu0: 0.2, alpha: 0.05 };
    const small = feedD(initEDetector(opts), Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 1 : 0)));
    const large = feedD(initEDetector(opts), Array.from({ length: 40 }, () => 1));
    expect(large.alarmed).toBe(true);
    if (small.alarmed) {
      expect(large.alarmedAt as number).toBeLessThanOrEqual(small.alarmedAt as number);
    }
  });
});

describe("classical CUSUM baseline (weaker guarantee, comparison only)", () => {
  it("hand-computed Page recursion", () => {
    // μ0=0.5, k=0.1: increments x − 0.6. xs=[1, 1, 0]: 0.4, 0.8, max(0, 0.8−0.6)=0.2.
    let s = initCusum({ mu0: 0.5, slack: 0.1, decisionInterval: 0.75 });
    s = updateCusum(s, 1);
    expect(s.stat).toBeCloseTo(0.4, 12);
    s = updateCusum(s, 1);
    expect(s.stat).toBeCloseTo(0.8, 12);
    expect(s.alarmed).toBe(true); // 0.8 ≥ 0.75
    s = updateCusum(s, 0);
    expect(s.stat).toBeCloseTo(0.2, 12);
    expect(s.alarmedAt).toBe(2);
  });
});

describe("errorObservations adapter", () => {
  it("maps judge predictions to a bounded error stream the monitors accept", () => {
    const xs = errorObservations([
      { confidence: 0.9, correct: true },
      { confidence: 0.8, correct: false },
      { confidence: 0.7, correct: true },
    ]);
    expect(xs).toEqual([0, 1, 0]);
    const s = feedE(initEProcess({ mu0: 0.1, alpha: 0.05 }), xs);
    expect(s.observations).toBe(3);
  });
});
