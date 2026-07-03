import { describe, expect, it } from "vitest";
import { initAci, intervalFor, updateAci, type AciState } from "../src/index.js";

/**
 * Adaptive conformal interval tests. All expectations hand-computed from the
 * conformal-rank and adaptation arithmetic — no simulation, no randomness.
 */

/** Feed points with forecast 0 so each |actual| becomes the residual. */
const seedResiduals = (s: AciState, values: number[]): AciState =>
  values.reduce((acc, v) => updateAci(acc, { forecast: 0, actual: v }), s);

describe("initAci validation", () => {
  it("rejects out-of-range parameters", () => {
    expect(() => initAci({ targetMiscoverage: 0 })).toThrow();
    expect(() => initAci({ targetMiscoverage: 1 })).toThrow();
    expect(() => initAci({ targetMiscoverage: 0.2, gamma: 0 })).toThrow();
    expect(() => initAci({ targetMiscoverage: 0.2, minHistory: 1 })).toThrow();
    expect(() => initAci({ targetMiscoverage: 0.2, minHistory: 10, maxHistory: 5 })).toThrow();
  });
});

describe("abstention (the house pattern)", () => {
  it("offers no interval below minHistory", () => {
    let s = initAci({ targetMiscoverage: 0.2, minHistory: 10 });
    s = seedResiduals(s, [1, 2, 3]);
    expect(intervalFor(s, 100)).toBeNull();
    expect(s.scoredSteps).toBe(0); // abstentions never count as scored
  });

  it("abstains when the conformal rank exceeds the sample (level not certifiable)", () => {
    // α_t = 0.05 with n = 10: rank = ⌈11·0.95⌉ = 11 > 10 → abstain.
    let s = initAci({ targetMiscoverage: 0.05, minHistory: 10 });
    s = seedResiduals(s, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(intervalFor(s, 0)).toBeNull();
  });
});

describe("conformal quantile exactness", () => {
  it("hand-computed rank: n=10, α=0.2 → rank 9 → 9th smallest residual", () => {
    let s = initAci({ targetMiscoverage: 0.2, minHistory: 10 });
    s = seedResiduals(s, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const interval = intervalFor(s, 100);
    // rank = ⌈11·0.8⌉ = 9 → sorted[8] = 9.
    expect(interval).toEqual({ lower: 91, upper: 109, halfWidth: 9, alphaUsed: 0.2 });
  });
});

describe("adaptation arithmetic (Gibbs–Candès update)", () => {
  it("cover relaxes α upward, miss pushes it down (wider), exactly by γ(α − err)", () => {
    let s = initAci({ targetMiscoverage: 0.2, gamma: 0.1, minHistory: 10 });
    s = seedResiduals(s, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Cover: halfWidth 9, residual 0 → err=0 → α = 0.2 + 0.1·(0.2−0) = 0.22.
    s = updateAci(s, { forecast: 100, actual: 100 });
    expect(s.alphaT).toBeCloseTo(0.22, 12);
    expect(s.scoredSteps).toBe(1);
    expect(s.misses).toBe(0);

    // Now n=11 residuals [0,1..10], α=0.22: rank = ⌈12·0.78⌉ = 10 → sorted[9] = 9.
    const offered = intervalFor(s, 0);
    expect(offered?.halfWidth).toBe(9);

    // Miss: residual 50 > 9 → err=1 → α = 0.22 + 0.1·(0.2−1) = 0.14.
    s = updateAci(s, { forecast: 0, actual: 50 });
    expect(s.alphaT).toBeCloseTo(0.14, 12);
    expect(s.misses).toBe(1);
    expect(s.statement).toContain("1 misses");
  });

  it("abstained steps do not adapt α", () => {
    let s = initAci({ targetMiscoverage: 0.2, gamma: 0.1, minHistory: 10 });
    s = seedResiduals(s, [1, 2, 3]); // all below minHistory → never scored
    expect(s.alphaT).toBeCloseTo(0.2, 12);
    expect(s.scoredSteps).toBe(0);
  });

  it("α stays clamped inside [0.001, 0.999] under repeated misses", () => {
    let s = initAci({ targetMiscoverage: 0.2, gamma: 0.5, minHistory: 2 });
    s = seedResiduals(s, [1, 1]);
    for (let i = 0; i < 20; i++) s = updateAci(s, { forecast: 0, actual: 1000 + i });
    expect(s.alphaT).toBeGreaterThanOrEqual(0.001);
    expect(s.alphaT).toBeLessThanOrEqual(0.999);
    expect(s.statement).toContain("clamped");
  });
});

describe("window + state discipline", () => {
  it("maxHistory trims the oldest residuals", () => {
    let s = initAci({ targetMiscoverage: 0.2, minHistory: 2, maxHistory: 5 });
    s = seedResiduals(s, [1, 2, 3, 4, 5, 6, 7]);
    expect(s.residuals).toEqual([3, 4, 5, 6, 7]);
    expect(s.observations).toBe(7);
  });

  it("state is plain serializable data: JSON roundtrip resumes identically", () => {
    let s = initAci({ targetMiscoverage: 0.2, gamma: 0.05, minHistory: 3 });
    s = seedResiduals(s, [2, 4, 6, 8]);
    const resumed = JSON.parse(JSON.stringify(s)) as AciState;
    const next = { forecast: 10, actual: 11 };
    expect(updateAci(resumed, next)).toEqual(updateAci(s, next));
  });

  it("rejects non-finite inputs", () => {
    const s = initAci({ targetMiscoverage: 0.2 });
    expect(() => updateAci(s, { forecast: Number.NaN, actual: 1 })).toThrow();
    expect(() => intervalFor(s, Number.POSITIVE_INFINITY)).toThrow();
  });
});
