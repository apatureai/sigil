/**
 * Statistical evidence for the audit's two headline claims.
 *
 * 1. "Switch X→Y, save Z% at held quality" (frontier.ts). A point comparison
 *    of aggregate quality is not examiner evidence. `verifySwitchQuality` runs
 *    an exact two-sided McNemar test on PAIRED per-task outcomes (same task,
 *    both models) and refuses to call a switch defensible when the candidate
 *    is significantly worse. The disclosure ships either way.
 *
 * 2. Pass^k (reliability.ts). The unbiased estimator describes the observed
 *    runs. `certifiedPassKLowerBound` adds the finite-sample floor: an exact
 *    Clopper-Pearson lower bound on the per-run pass rate, powered to k, under
 *    the disclosed assumption of independent identically-distributed runs.
 *    "Pass^3 ≥ 41% with 95% confidence" is a statement a risk owner can file;
 *    a bare point estimate is not.
 *
 * Pure and deterministic; no RNG, wall clock, model, or network.
 */

import { clopperPearsonLower } from "./conformal.js";

// --- Exact McNemar on paired outcomes ---------------------------------------

export interface PairedOutcome {
  /** Did the incumbent model pass this task? */
  currentPassed: boolean;
  /** Did the candidate model pass the SAME task? */
  candidatePassed: boolean;
}

export interface McNemarResult {
  /** Exact two-sided p-value of the discordant-pair binomial(n, 1/2) test. */
  pValue: number;
  discordant: number;
  currentOnly: number;
  candidateOnly: number;
}

/** log(k!) computed iteratively; deterministic float ops. */
function logFactorialTable(n: number): number[] {
  const table = new Array<number>(n + 1);
  table[0] = 0;
  for (let k = 1; k <= n; k++) table[k] = (table[k - 1] as number) + Math.log(k);
  return table;
}

/**
 * Exact two-sided McNemar test from discordant counts. Concordant pairs carry
 * no information about the difference; zero discordant pairs means the models
 * are indistinguishable on this sample (p = 1).
 */
export function mcnemarExact(currentOnly: number, candidateOnly: number): McNemarResult {
  if (
    !Number.isInteger(currentOnly) ||
    !Number.isInteger(candidateOnly) ||
    currentOnly < 0 ||
    candidateOnly < 0
  ) {
    throw new Error(`mcnemarExact: counts must be non-negative integers, got (${currentOnly}, ${candidateOnly})`);
  }
  const n = currentOnly + candidateOnly;
  if (n === 0) return { pValue: 1, discordant: 0, currentOnly, candidateOnly };

  const logFact = logFactorialTable(n);
  const logHalfPowN = n * Math.log(0.5);
  const k = Math.min(currentOnly, candidateOnly);
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    const logChoose = (logFact[n] as number) - (logFact[i] as number) - (logFact[n - i] as number);
    tail += Math.exp(logChoose + logHalfPowN);
  }
  return { pValue: Math.min(1, 2 * tail), discordant: n, currentOnly, candidateOnly };
}

// --- Switch-quality evidence --------------------------------------------------

export interface SwitchQualityEvidence {
  /** False only when the candidate is SIGNIFICANTLY worse at level α. */
  defensible: boolean;
  mcnemar: McNemarResult;
  alpha: number;
  pairs: number;
  currentPassRate: number;
  candidatePassRate: number;
  /** Report-ready sentence restating only what was measured. */
  statement: string;
}

/**
 * Evidence gate behind "equal-or-better quality": the switch claim is
 * defensible unless the paired test shows the candidate significantly worse
 * (p < α with the discordance against the candidate). "Not significantly
 * different" is reported as exactly that, never inflated into "equal".
 */
export function verifySwitchQuality(
  pairs: readonly PairedOutcome[],
  options: { alpha?: number } = {},
): SwitchQualityEvidence {
  const alpha = options.alpha ?? 0.05;
  if (alpha <= 0 || alpha >= 1) throw new Error(`verifySwitchQuality: alpha must be in (0,1), got ${alpha}`);
  const currentOnly = pairs.filter((p) => p.currentPassed && !p.candidatePassed).length;
  const candidateOnly = pairs.filter((p) => !p.currentPassed && p.candidatePassed).length;
  const mcnemar = mcnemarExact(currentOnly, candidateOnly);
  const n = pairs.length;
  const currentPassRate = n === 0 ? 0 : pairs.filter((p) => p.currentPassed).length / n;
  const candidatePassRate = n === 0 ? 0 : pairs.filter((p) => p.candidatePassed).length / n;

  const significantlyWorse = mcnemar.pValue < alpha && candidateOnly < currentOnly;
  const statement = significantlyWorse
    ? `Candidate is significantly worse on paired tasks (McNemar exact p=${mcnemar.pValue.toFixed(4)}, ` +
      `${currentOnly} vs ${candidateOnly} discordant); the equal-quality switch claim is NOT defensible on this sample.`
    : `Paired comparison over ${n} tasks: candidate pass ${(candidatePassRate * 100).toFixed(1)}% vs incumbent ${(currentPassRate * 100).toFixed(1)}%. ` +
      `McNemar exact p=${mcnemar.pValue.toFixed(4)} over ${mcnemar.discordant} discordant pairs: no significant quality loss detected at α=${alpha}. ` +
      `Absence of detected loss is not proof of equality; the disclosure ships with the sample size.`;

  return {
    defensible: !significantlyWorse,
    mcnemar,
    alpha,
    pairs: n,
    currentPassRate,
    candidatePassRate,
    statement,
  };
}

// --- Certified Pass^k floor ------------------------------------------------------

export interface CertifiedPassK {
  n: number;
  passes: number;
  k: number;
  delta: number;
  /** Exact lower confidence bound on the per-run pass rate. */
  passRateLower: number;
  /** Certified floor on Pass^k: passRateLower^k, under i.i.d. runs. */
  passKLower: number;
  statement: string;
}

/**
 * Finite-sample floor on Pass^k: exact Clopper-Pearson lower bound on the
 * per-run pass probability, raised to k. Assumes runs are independent draws of
 * the same configuration, and that assumption is part of the statement, because
 * an examiner will ask.
 */
export function certifiedPassKLowerBound(
  trials: readonly boolean[],
  k: number,
  delta: number,
): CertifiedPassK {
  if (k < 1 || !Number.isInteger(k)) throw new Error("certifiedPassKLowerBound: k must be a positive integer");
  const n = trials.length;
  if (n === 0) throw new Error("certifiedPassKLowerBound: no trials");
  const passes = trials.filter(Boolean).length;
  const passRateLower = clopperPearsonLower(passes, n, delta);
  const passKLower = Math.max(0, passRateLower) ** k;
  return {
    n,
    passes,
    k,
    delta,
    passRateLower,
    passKLower,
    statement:
      `Observed ${passes}/${n} passing runs; with confidence ≥ ${((1 - delta) * 100).toFixed(0)}% the per-run pass rate is ≥ ` +
      `${(passRateLower * 100).toFixed(1)}%, so Pass^${k} ≥ ${(passKLower * 100).toFixed(1)}% under independent runs.`,
  };
}
