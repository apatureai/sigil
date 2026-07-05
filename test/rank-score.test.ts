import { describe, expect, it } from "vitest";
import {
  kendallTauB,
  cardinalIntervalWidth,
  rankScoreDecoupling,
  type ScoredObservation,
} from "../src/index.js";

describe("Kendall's tau-b", () => {
  it("perfect agreement gives tau = 1", () => {
    expect(kendallTauB([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
  });

  it("perfect reversal gives tau = -1", () => {
    expect(kendallTauB([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 10);
  });

  it("matches a hand-computed no-tie value", () => {
    // x=[1,2,3,4], y=[1,2,4,3]: 5 concordant, 1 discordant, no ties -> (5-1)/6 = 2/3.
    expect(kendallTauB([1, 2, 3, 4], [1, 2, 4, 3])).toBeCloseTo(2 / 3, 10);
  });

  it("applies the tie correction (hand-computed)", () => {
    // x=[1,1,2,3], y=[1,2,2,3]: n0=6, one tie pair in each vector -> n1=n2=1.
    // 4 concordant, 0 discordant -> 4 / sqrt(5*5) = 0.8.
    expect(kendallTauB([1, 1, 2, 3], [1, 2, 2, 3])).toBeCloseTo(0.8, 10);
  });

  it("returns 0 when a vector is all ties (undefined denominator)", () => {
    expect(kendallTauB([5, 5, 5], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for fewer than two observations", () => {
    expect(kendallTauB([], [])).toBe(0);
    expect(kendallTauB([1], [1])).toBe(0);
  });

  it("throws on mismatched lengths", () => {
    expect(() => kendallTauB([1, 2], [1])).toThrow();
  });
});

describe("cardinalIntervalWidth", () => {
  it("reports the central-90% residual spread normalized to the score range", () => {
    // residuals alternate +/-4.5; score range = 44.5 - 4.5 = 40 -> 9/40 = 0.225.
    const obs: ScoredObservation[] = [
      { judgeScore: 4.5, trueQuality: 0 },
      { judgeScore: 5.5, trueQuality: 10 },
      { judgeScore: 24.5, trueQuality: 20 },
      { judgeScore: 25.5, trueQuality: 30 },
      { judgeScore: 44.5, trueQuality: 40 },
    ];
    const iv = cardinalIntervalWidth(obs);
    expect(iv.rawWidth).toBeCloseTo(9, 10);
    expect(iv.normalizedWidth).toBeCloseTo(0.225, 10);
  });

  it("honors an explicit score range and central mass", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 1, trueQuality: 1 },
      { judgeScore: 3, trueQuality: 1 },
    ];
    // residuals [0, 2]; central 100% spread = 2; explicit range 10 -> 0.2.
    const iv = cardinalIntervalWidth(obs, { centralMass: 1, scoreRange: 10 });
    expect(iv.rawWidth).toBeCloseTo(2, 10);
    expect(iv.normalizedWidth).toBeCloseTo(0.2, 10);
  });

  it("returns 0 width for fewer than two observations", () => {
    expect(cardinalIntervalWidth([]).normalizedWidth).toBe(0);
    expect(cardinalIntervalWidth([{ judgeScore: 1, trueQuality: 1 }]).rawWidth).toBe(0);
  });

  it("returns 0 normalized width when the score range is 0", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 5, trueQuality: 1 },
      { judgeScore: 5, trueQuality: 9 },
    ];
    expect(cardinalIntervalWidth(obs).normalizedWidth).toBe(0);
  });
});

describe("rankScoreDecoupling", () => {
  it("monotone-but-noisy judge: high tau, wide interval -> trust-order-not-magnitude", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 4.5, trueQuality: 0 },
      { judgeScore: 5.5, trueQuality: 10 },
      { judgeScore: 24.5, trueQuality: 20 },
      { judgeScore: 25.5, trueQuality: 30 },
      { judgeScore: 44.5, trueQuality: 40 },
    ];
    const r = rankScoreDecoupling(obs);
    expect(r.rankCorrelation).toBeCloseTo(1, 10);
    expect(r.normalizedIntervalWidth).toBeGreaterThan(0.2);
    expect(r.verdict).toBe("trust-order-not-magnitude");
  });

  it("well-calibrated judge: high tau, narrow interval -> scores-reliable", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 0.2, trueQuality: 0 },
      { judgeScore: 9.8, trueQuality: 10 },
      { judgeScore: 20.2, trueQuality: 20 },
      { judgeScore: 29.8, trueQuality: 30 },
      { judgeScore: 40.2, trueQuality: 40 },
    ];
    const r = rankScoreDecoupling(obs);
    expect(r.rankCorrelation).toBeCloseTo(1, 10);
    expect(r.normalizedIntervalWidth).toBeLessThan(0.2);
    expect(r.verdict).toBe("scores-reliable");
  });

  it("reversed reference: low tau -> both-weak", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 1, trueQuality: 40 },
      { judgeScore: 2, trueQuality: 30 },
      { judgeScore: 3, trueQuality: 20 },
      { judgeScore: 4, trueQuality: 10 },
      { judgeScore: 5, trueQuality: 0 },
    ];
    const r = rankScoreDecoupling(obs);
    expect(r.rankCorrelation).toBeLessThan(0.7);
    expect(r.verdict).toBe("both-weak");
  });

  it("shuffled reference: low tau -> both-weak", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 1, trueQuality: 3 },
      { judgeScore: 2, trueQuality: 1 },
      { judgeScore: 3, trueQuality: 5 },
      { judgeScore: 4, trueQuality: 2 },
      { judgeScore: 5, trueQuality: 4 },
    ];
    const r = rankScoreDecoupling(obs);
    expect(r.rankCorrelation).toBeLessThan(0.7);
    expect(r.verdict).toBe("both-weak");
  });

  it("n = 0 and n = 1 -> insufficient-data", () => {
    expect(rankScoreDecoupling([]).verdict).toBe("insufficient-data");
    expect(rankScoreDecoupling([{ judgeScore: 1, trueQuality: 1 }]).verdict).toBe("insufficient-data");
  });

  it("identical scores: no order and no scale -> both-weak", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 3, trueQuality: 10 },
      { judgeScore: 3, trueQuality: 20 },
      { judgeScore: 3, trueQuality: 30 },
    ];
    const r = rankScoreDecoupling(obs);
    expect(r.rankCorrelation).toBe(0);
    expect(r.normalizedIntervalWidth).toBe(0);
    expect(r.verdict).toBe("both-weak");
  });

  it("all reference values tied: rank correlation is 0 -> both-weak", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 1, trueQuality: 7 },
      { judgeScore: 2, trueQuality: 7 },
      { judgeScore: 3, trueQuality: 7 },
    ];
    const r = rankScoreDecoupling(obs);
    expect(r.rankCorrelation).toBe(0);
    expect(r.verdict).toBe("both-weak");
  });

  it("respects custom thresholds", () => {
    const obs: ScoredObservation[] = [
      { judgeScore: 4.5, trueQuality: 0 },
      { judgeScore: 5.5, trueQuality: 10 },
      { judgeScore: 24.5, trueQuality: 20 },
      { judgeScore: 25.5, trueQuality: 30 },
      { judgeScore: 44.5, trueQuality: 40 },
    ];
    // Raise the width bar above the observed 0.225 so the magnitude counts as tight.
    const r = rankScoreDecoupling(obs, { widthThreshold: 0.5 });
    expect(r.verdict).toBe("scores-reliable");
  });
});
