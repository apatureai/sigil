/**
 * Finite-sample risk certificates + certified abstention: the examiner-grade
 * upgrade over calibration diagnostics.
 *
 * ECE/Brier (metrics.ts) DESCRIBE the judge's reliability; they promise
 * nothing. This module produces distribution-free, finite-sample GUARANTEES on
 * the shipped artifact, in the tradition of split conformal prediction and
 * Learn-Then-Test risk control (Angelopoulos, Bates et al.; selective
 * classification à la Geifman & El-Yaniv):
 *
 *  - `clopperPearsonUpper` / `clopperPearsonLower`, exact one-sided binomial
 *    bounds. With e judge errors in n labeled cases, the audit can state:
 *    "with confidence ≥ 1−δ, the judge's true error rate is ≤ U(e,n,δ)."
 *  - `certifyAbstentionThreshold`, fixed-sequence Learn-Then-Test over a
 *    DATA-INDEPENDENT confidence grid: walk thresholds from most to least
 *    conservative; at each, test H0 "selective error > α" with the exact
 *    Clopper-Pearson bound; stop at the first failure. The returned threshold
 *    keeps the family-wise 1−δ guarantee because the tests are a priori
 *    ordered and each spends the full δ conditionally on all previous
 *    rejections (fixed-sequence testing).
 *
 * The product sentence this buys: "on the X% of cases the judge accepts, its
 * error rate is ≤ α with confidence 1−δ; the rest are explicitly abstained to
 * human review". That is SR 26-2's effective-challenge posture as machinery,
 * not prose.
 *
 * Honest scope, disclosed rather than hidden:
 *  - Validity assumes the labeled calibration cases and deployment cases are
 *    exchangeable draws from the same task distribution. Drift breaks that,
 *    which is exactly why re-certification is expected on a recurring cadence,
 *    never a one-shot certificate.
 *  - Small n gives wide (honest) bounds. The bound is reported with its sample
 *    size; a wide bound is a finding, not a failure.
 *
 * Pure and deterministic: no RNG, wall clock, model, or network.
 */

import type { JudgePrediction } from "./metrics.js";

/** log(k!) computed iteratively; deterministic float ops. */
function logFactorialTable(n: number): number[] {
  const table = new Array<number>(n + 1);
  table[0] = 0;
  for (let k = 1; k <= n; k++) table[k] = (table[k - 1] as number) + Math.log(k);
  return table;
}

/** Exact binomial CDF P(X <= e | n, p) in log-space, deterministic. */
function binomialCdf(e: number, n: number, p: number): number {
  if (p <= 0) return 1;
  if (p >= 1) return e >= n ? 1 : 0;
  const logFact = logFactorialTable(n);
  const logP = Math.log(p);
  const logQ = Math.log(1 - p);
  let cdf = 0;
  for (let i = 0; i <= e; i++) {
    const logChoose = (logFact[n] as number) - (logFact[i] as number) - (logFact[n - i] as number);
    cdf += Math.exp(logChoose + i * logP + (n - i) * logQ);
  }
  return Math.min(1, cdf);
}

/**
 * Exact one-sided Clopper-Pearson UPPER bound on a binomial proportion: the
 * smallest p with P(X ≤ errors | n, p) ≤ delta. With zero errors this is the
 * closed form 1 − δ^(1/n) ("rule of three" family). `errors = n` returns 1.
 */
export function clopperPearsonUpper(errors: number, n: number, delta: number): number {
  if (!Number.isInteger(errors) || !Number.isInteger(n) || n <= 0 || errors < 0 || errors > n) {
    throw new Error(`clopperPearsonUpper: invalid (errors=${errors}, n=${n})`);
  }
  if (delta <= 0 || delta >= 1) {
    throw new Error(`clopperPearsonUpper: delta must be in (0,1), got ${delta}`);
  }
  if (errors === n) return 1;
  // BinCDF(errors; n, p) is strictly decreasing in p: bisect on p.
  let lo = errors / n;
  let hi = 1;
  for (let iter = 0; iter < 200; iter++) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(errors, n, mid) > delta) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * Exact one-sided Clopper-Pearson LOWER bound on a success proportion: with s
 * successes in n trials, `1 − upperBound(failure rate)`. All-successes gives
 * the closed form δ^(1/n).
 */
export function clopperPearsonLower(successes: number, n: number, delta: number): number {
  return 1 - clopperPearsonUpper(n - successes, n, delta);
}

// --- Certified abstention (fixed-sequence Learn-Then-Test) -----------------

export interface AbstentionCertificateInput {
  /** Certified selective-error target α, e.g. 0.05. */
  targetErrorRate: number;
  /** Certificate failure probability δ (confidence is 1−δ), e.g. 0.05. */
  delta: number;
  /**
   * Optional DATA-INDEPENDENT threshold grid, most-conservative (highest)
   * first. Defaults to 1.00, 0.99, …, 0.00. Must be strictly decreasing; using
   * observed confidences here would silently void the guarantee, so the
   * default is a fixed percent grid.
   */
  thresholdGrid?: readonly number[];
}

export interface AbstentionCertificate {
  certified: boolean;
  /** Accept when judge confidence ≥ threshold; abstain (route to human) below. */
  threshold: number | null;
  /** Fraction of calibration cases the threshold accepts. */
  coverage: number;
  accepted: number;
  acceptedErrors: number;
  /** Exact upper bound on the selective error rate at confidence 1−δ. */
  errorUpperBound: number | null;
  targetErrorRate: number;
  delta: number;
  calibrationSize: number;
  method: "clopper_pearson_fixed_sequence";
  /** Human-readable statement for the report; restates only what was measured. */
  statement: string;
}

const DEFAULT_GRID: readonly number[] = Array.from({ length: 101 }, (_, i) => (100 - i) / 100);

/**
 * Fixed-sequence Learn-Then-Test: walk the a-priori grid from the most
 * conservative threshold down; keep the last threshold whose accepted set's
 * exact error upper bound is ≤ α; stop at the first failure. Empty accepted
 * sets cannot certify and stop the walk (fail-closed).
 */
export function certifyAbstentionThreshold(
  predictions: readonly JudgePrediction[],
  input: AbstentionCertificateInput,
): AbstentionCertificate {
  const { targetErrorRate, delta } = input;
  if (targetErrorRate <= 0 || targetErrorRate >= 1) {
    throw new Error(`certifyAbstentionThreshold: targetErrorRate must be in (0,1), got ${targetErrorRate}`);
  }
  const grid = input.thresholdGrid ?? DEFAULT_GRID;
  for (let i = 1; i < grid.length; i++) {
    if ((grid[i] as number) >= (grid[i - 1] as number)) {
      throw new Error("certifyAbstentionThreshold: threshold grid must be strictly decreasing");
    }
  }
  const n = predictions.length;
  if (n === 0) {
    return uncertified(input, 0, "no labeled calibration cases; cannot certify anything");
  }

  let best: { threshold: number; accepted: number; errors: number; bound: number } | null = null;
  for (const threshold of grid) {
    const acceptedCases = predictions.filter((p) => p.confidence >= threshold);
    if (acceptedCases.length === 0) {
      // An empty accepted set certifies nothing; fixed-sequence order means we
      // may continue only while tests REJECT, so stop unless nothing was found
      // yet (thresholds above the max observed confidence are vacuous).
      if (best !== null) break;
      continue;
    }
    const errors = acceptedCases.filter((p) => !p.correct).length;
    const bound = clopperPearsonUpper(errors, acceptedCases.length, delta);
    if (bound <= targetErrorRate) {
      best = { threshold, accepted: acceptedCases.length, errors, bound };
    } else {
      break; // first acceptance of H0 stops the fixed sequence
    }
  }

  if (best === null) {
    return uncertified(
      input,
      n,
      `no threshold on the fixed grid certifies selective error ≤ ${targetErrorRate} at confidence ${1 - delta} (n=${n}); the honest verdict is "abstain or collect more labels"`,
    );
  }
  const coverage = best.accepted / n;
  return {
    certified: true,
    threshold: best.threshold,
    coverage,
    accepted: best.accepted,
    acceptedErrors: best.errors,
    errorUpperBound: best.bound,
    targetErrorRate,
    delta,
    calibrationSize: n,
    method: "clopper_pearson_fixed_sequence",
    statement:
      `At confidence threshold ${best.threshold.toFixed(2)}, the judge accepts ${(coverage * 100).toFixed(1)}% ` +
      `of calibration cases (${best.accepted}/${n}) with ${best.errors} errors; with confidence ≥ ${((1 - delta) * 100).toFixed(0)}% ` +
      `the true selective error rate is ≤ ${(best.bound * 100).toFixed(2)}% (target ≤ ${(targetErrorRate * 100).toFixed(2)}%). ` +
      `Cases below the threshold are abstained to human review. Valid under exchangeability with the calibration draw; re-certify each audit cycle.`,
  };
}

function uncertified(
  input: AbstentionCertificateInput,
  n: number,
  reason: string,
): AbstentionCertificate {
  return {
    certified: false,
    threshold: null,
    coverage: 0,
    accepted: 0,
    acceptedErrors: 0,
    errorUpperBound: null,
    targetErrorRate: input.targetErrorRate,
    delta: input.delta,
    calibrationSize: n,
    method: "clopper_pearson_fixed_sequence",
    statement: reason,
  };
}
