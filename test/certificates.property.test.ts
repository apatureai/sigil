/**
 * Property-based laws for the certificate kernels. The example tests pin known
 * values; these properties assert the mathematical guarantees the audit SELLS,
 * over generated inputs:
 *
 *  - Clopper–Pearson bounds live in [0,1], bracket the point estimate, and are
 *    monotone in errors and in the confidence demanded.
 *  - McNemar's exact test is symmetric, maximal on balanced discordance, and
 *    monotone in imbalance — so `verifySwitchQuality` can only refuse a switch
 *    when the discordance is AGAINST the candidate.
 *  - Certified Pass^k floors never exceed the observed rate and respond to
 *    k / passes the way the formula promises.
 *  - `certifyAbstentionThreshold` never emits a certificate whose bound breaks
 *    its own target, and fails closed on empty/degenerate calibration sets.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { certifyAbstentionThreshold, clopperPearsonLower, clopperPearsonUpper } from "../src/conformal.js";
import type { JudgePrediction } from "../src/metrics.js";
import { certifiedPassKLowerBound, mcnemarExact, verifySwitchQuality } from "../src/stats.js";

const RUNS = { numRuns: 300 };

const nArb = fc.integer({ min: 1, max: 200 });
const deltaArb = fc.double({ min: 0.001, max: 0.5, noNaN: true });

describe("Clopper–Pearson properties", () => {
  it("upper bound is in [errors/n, 1] and lower bound is in [0, successes/n]", () => {
    fc.assert(
      fc.property(nArb, deltaArb, fc.nat(), (n, delta, seed) => {
        const errors = seed % (n + 1);
        const upper = clopperPearsonUpper(errors, n, delta);
        expect(upper).toBeGreaterThanOrEqual(errors / n - 1e-9);
        expect(upper).toBeLessThanOrEqual(1);
        const lower = clopperPearsonLower(errors, n, delta);
        expect(lower).toBeGreaterThanOrEqual(0);
        expect(lower).toBeLessThanOrEqual(errors / n + 1e-9);
      }),
      RUNS,
    );
  });

  it("more errors never shrink the upper bound (monotone in errors)", () => {
    fc.assert(
      fc.property(nArb, deltaArb, fc.nat(), (n, delta, seed) => {
        const errors = seed % n; // leave room for errors+1
        expect(clopperPearsonUpper(errors + 1, n, delta)).toBeGreaterThanOrEqual(
          clopperPearsonUpper(errors, n, delta) - 1e-9,
        );
      }),
      RUNS,
    );
  });

  it("demanding more confidence (smaller delta) never tightens the bound", () => {
    fc.assert(
      fc.property(nArb, fc.nat(), deltaArb, deltaArb, (n, seed, d1, d2) => {
        const errors = seed % (n + 1);
        const [strict, loose] = d1 < d2 ? [d1, d2] : [d2, d1];
        expect(clopperPearsonUpper(errors, n, strict)).toBeGreaterThanOrEqual(
          clopperPearsonUpper(errors, n, loose) - 1e-9,
        );
      }),
      RUNS,
    );
  });

  it("matches the zero-error closed form 1 − δ^(1/n) (rule-of-three family)", () => {
    fc.assert(
      fc.property(nArb, deltaArb, (n, delta) => {
        expect(clopperPearsonUpper(0, n, delta)).toBeCloseTo(1 - delta ** (1 / n), 6);
      }),
      RUNS,
    );
  });
});

describe("McNemar exact-test properties", () => {
  const count = fc.integer({ min: 0, max: 80 });

  it("p ∈ (0,1], symmetric in the two discordant counts, and 1 when balanced", () => {
    fc.assert(
      fc.property(count, count, (a, b) => {
        const p = mcnemarExact(a, b).pValue;
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(mcnemarExact(b, a).pValue).toBeCloseTo(p, 12);
        expect(mcnemarExact(a, a).pValue).toBe(1);
      }),
      RUNS,
    );
  });

  it("for fixed n, growing the imbalance never grows the p-value", () => {
    fc.assert(
      fc.property(count, fc.integer({ min: 1, max: 80 }), (b, extra) => {
        const a = b + extra; // a > b: shift one more pair from b to a
        if (b === 0) return;
        expect(mcnemarExact(a + 1, b - 1).pValue).toBeLessThanOrEqual(
          mcnemarExact(a, b).pValue + 1e-12,
        );
      }),
      RUNS,
    );
  });
});

describe("verifySwitchQuality properties", () => {
  const pairArb: fc.Arbitrary<{ currentPassed: boolean; candidatePassed: boolean }> = fc.record({
    currentPassed: fc.boolean(),
    candidatePassed: fc.boolean(),
  });

  it("only refuses a switch when the discordance is against the candidate", () => {
    fc.assert(
      fc.property(fc.array(pairArb, { maxLength: 120 }), (pairs) => {
        const out = verifySwitchQuality(pairs);
        if (!out.defensible) {
          expect(out.mcnemar.candidateOnly).toBeLessThan(out.mcnemar.currentOnly);
          expect(out.mcnemar.pValue).toBeLessThan(out.alpha);
        }
      }),
      RUNS,
    );
  });

  it("is invariant under reordering of the paired outcomes", () => {
    fc.assert(
      fc.property(fc.array(pairArb, { maxLength: 60 }), (pairs) => {
        const shuffled = [...pairs].reverse();
        const a = verifySwitchQuality(pairs);
        const b = verifySwitchQuality(shuffled);
        expect(b.defensible).toBe(a.defensible);
        expect(b.mcnemar.pValue).toBeCloseTo(a.mcnemar.pValue, 12);
      }),
      RUNS,
    );
  });
});

describe("certifiedPassKLowerBound properties", () => {
  const trialsArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 150 });
  const kArb = fc.integer({ min: 1, max: 8 });

  it("floor never exceeds the observed pass rate, and equals lower^k in [0,1]", () => {
    fc.assert(
      fc.property(trialsArb, kArb, deltaArb, (trials, k, delta) => {
        const out = certifiedPassKLowerBound(trials, k, delta);
        const observed = out.passes / out.n;
        expect(out.passRateLower).toBeLessThanOrEqual(observed + 1e-9);
        expect(out.passKLower).toBeCloseTo(Math.max(0, out.passRateLower) ** k, 12);
        expect(out.passKLower).toBeGreaterThanOrEqual(0);
        expect(out.passKLower).toBeLessThanOrEqual(1);
      }),
      RUNS,
    );
  });

  it("raising k can only lower the certified floor", () => {
    fc.assert(
      fc.property(trialsArb, kArb, deltaArb, (trials, k, delta) => {
        expect(certifiedPassKLowerBound(trials, k + 1, delta).passKLower).toBeLessThanOrEqual(
          certifiedPassKLowerBound(trials, k, delta).passKLower + 1e-12,
        );
      }),
      RUNS,
    );
  });
});

describe("certifyAbstentionThreshold properties", () => {
  const predArb: fc.Arbitrary<JudgePrediction> = fc.record({
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    correct: fc.boolean(),
  });
  const inputArb = fc.record({
    targetErrorRate: fc.double({ min: 0.01, max: 0.5, noNaN: true }),
    delta: fc.double({ min: 0.01, max: 0.2, noNaN: true }),
  });

  it("an emitted certificate never violates its own target, coverage, or grid", () => {
    fc.assert(
      fc.property(fc.array(predArb, { maxLength: 200 }), inputArb, (predictions, input) => {
        const cert = certifyAbstentionThreshold(predictions, input);
        if (!cert.certified) return;
        expect(cert.errorUpperBound as number).toBeLessThanOrEqual(input.targetErrorRate);
        expect(cert.accepted).toBeGreaterThan(0);
        expect(cert.coverage).toBeGreaterThan(0);
        expect(cert.coverage).toBeLessThanOrEqual(1);
        // The empirical selective error can never exceed its own exact bound.
        expect(cert.acceptedErrors / cert.accepted).toBeLessThanOrEqual(
          (cert.errorUpperBound as number) + 1e-9,
        );
        // Threshold comes from the default fixed percent grid.
        expect(Math.round((cert.threshold as number) * 100) / 100).toBeCloseTo(cert.threshold as number, 12);
      }),
      RUNS,
    );
  });

  it("fails closed on an all-wrong judge and on empty calibration sets", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({ confidence: fc.double({ min: 0, max: 1, noNaN: true }), correct: fc.constant(false) }),
          { maxLength: 100 },
        ),
        inputArb,
        (predictions, input) => {
          const cert = certifyAbstentionThreshold(predictions, input);
          expect(cert.certified).toBe(false);
          expect(cert.threshold).toBeNull();
        },
      ),
      RUNS,
    );
  });
});
