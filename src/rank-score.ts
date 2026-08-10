/**
 * Rank-vs-score decoupling: ordinal reliability the calibration metrics miss.
 *
 * `metrics.ts` measures whether the judge's *confidence* is calibrated (ECE/Brier)
 * and `reliability.ts` measures run-to-run stability (Pass^k). Neither asks the
 * question a downstream ranker cares about: can we trust the judge's ORDER even
 * when we cannot trust its absolute MAGNITUDE?
 *
 * Motivated by the finding in arXiv 2604.25235, "VLM Judges Can Rank but Cannot
 * Score: Task-Dependent Uncertainty in Multimodal Evaluation" (CC BY-4.0): VLM/LLM
 * judges tend to produce reliable *ordinal* rankings while their *cardinal* absolute
 * scores carry wide, task-dependent prediction intervals. (Ideas only; no text or
 * code reused.) This module quantifies that split with two independent readings:
 *  - a rank correlation between the judge's scores and the reference quality
 *    ordering (Kendall's tau-b), and
 *  - the empirical width of the score->quality residual interval, normalized to the
 *    score range.
 * A judge can score well on the first and badly on the second. That is exactly the
 * regime where "use the ranking, distrust the number" is the correct guidance.
 *
 * Diagnostic only: it never edits scoring or report output. Pure and deterministic.
 */

export interface ScoredObservation {
  /** The judge's cardinal score for an item (higher = better). Same scale as `trueQuality`. */
  judgeScore: number;
  /** The reference quality/preference the score is meant to estimate. Same scale as `judgeScore`. */
  trueQuality: number;
}

/**
 * Kendall's tau-b rank correlation between two equal-length numeric vectors, in
 * [-1, 1]. Chosen as the primary ordinal metric (over Spearman's rho) because it
 * corrects for ties in either vector via the tie-adjusted denominator, and ties are
 * common in judge scores drawn from a small ordinal rubric (e.g. 1..5).
 *
 * tau-b = (n_c - n_d) / sqrt((n_0 - n_1) * (n_0 - n_2)), where n_0 = n(n-1)/2 is the
 * total pair count, n_c/n_d are concordant/discordant pairs, and n_1/n_2 are the
 * pairs tied within `a`/`b` respectively. Returns 0 when n < 2 or the tie-adjusted
 * denominator is 0 (e.g. every value in a vector is identical, so there is no order
 * to compare).
 */
export function kendallTauB(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) throw new Error("kendallTauB: vectors must be equal length");
  const n = a.length;
  if (n < 2) return 0;

  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sa = Math.sign(a[i]! - a[j]!);
      const sb = Math.sign(b[i]! - b[j]!);
      const s = sa * sb;
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
      // s === 0 means the pair is tied in a and/or b: neither concordant nor discordant.
    }
  }

  const n0 = (n * (n - 1)) / 2;
  const n1 = tiePairs(a);
  const n2 = tiePairs(b);
  const denom = Math.sqrt((n0 - n1) * (n0 - n2));
  if (denom === 0) return 0;
  return (concordant - discordant) / denom;
}

/** Sum over tie groups of t(t-1)/2, i.e. the number of pairs tied on this vector. */
function tiePairs(values: readonly number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let total = 0;
  for (const t of counts.values()) total += (t * (t - 1)) / 2;
  return total;
}

export interface CardinalInterval {
  /** Number of observations. */
  n: number;
  /** Central mass captured by the interval (e.g. 0.9 = central 90%). */
  centralMass: number;
  /** Lower residual quantile, in score units. */
  lower: number;
  /** Upper residual quantile, in score units. */
  upper: number;
  /** upper - lower: the empirical prediction-interval width in score units. */
  rawWidth: number;
  /** rawWidth as a fraction of the score range, clamped to [0, 1]. */
  normalizedWidth: number;
}

export interface CardinalIntervalOptions {
  /** Central probability mass the interval should span; default 0.9 (central 90%). */
  centralMass?: number;
  /** Denominator for normalization; default is the empirical judge-score range (max - min). */
  scoreRange?: number;
}

/**
 * Empirical width of the score->quality residual interval, normalized to the score
 * range: the paper's "cardinal scores carry wide intervals" made concrete.
 *
 * The residual for each observation is `judgeScore - trueQuality` (both on the same
 * scale). We take the central `centralMass` spread of those residuals as a
 * deterministic quantile difference: with the default central 90%, that is the 95th
 * minus the 5th residual percentile (linear-interpolation quantiles). Dividing by
 * the score range yields a scale-free width in [0, 1] where larger = the absolute
 * score is a looser estimate of quality. Returns 0-width when n < 2 or the score
 * range is 0 (no scale to normalize against).
 */
export function cardinalIntervalWidth(
  observations: readonly ScoredObservation[],
  options: CardinalIntervalOptions = {},
): CardinalInterval {
  const centralMass = options.centralMass ?? 0.9;
  const n = observations.length;
  if (n < 2) {
    return { n, centralMass, lower: 0, upper: 0, rawWidth: 0, normalizedWidth: 0 };
  }

  const residuals = observations.map((o) => o.judgeScore - o.trueQuality).sort((x, y) => x - y);
  const tail = (1 - centralMass) / 2;
  const lower = quantileSorted(residuals, tail);
  const upper = quantileSorted(residuals, 1 - tail);
  const rawWidth = upper - lower;

  const scores = observations.map((o) => o.judgeScore);
  const range = options.scoreRange ?? Math.max(...scores) - Math.min(...scores);
  const normalizedWidth = range > 0 ? clamp01(rawWidth / range) : 0;

  return { n, centralMass, lower, upper, rawWidth, normalizedWidth };
}

/** Verdict on which of the judge's two signals, order or magnitude, can be trusted. */
export type RankScoreVerdict =
  | "trust-order-not-magnitude"
  | "scores-reliable"
  | "both-weak"
  | "insufficient-data";

export interface RankScoreDecoupling {
  /** Number of paired observations. */
  n: number;
  /** Kendall's tau-b between judge scores and reference quality, in [-1, 1]. */
  rankCorrelation: number;
  /** Normalized score->quality interval width, in [0, 1]. */
  normalizedIntervalWidth: number;
  verdict: RankScoreVerdict;
}

export interface RankScoreOptions extends CardinalIntervalOptions {
  /** Minimum tau-b to call the ordering trustworthy; default 0.7 (strong ordinal agreement). */
  tauThreshold?: number;
  /** Interval width at or above which the magnitude is called unreliable; default 0.2 (>=20% of range). */
  widthThreshold?: number;
}

/**
 * Bundle the ordinal (rank) and cardinal (magnitude) readings into a single verdict.
 *
 * Precedence (thresholds are explicit, documented params):
 *  - n < 2                              -> 'insufficient-data'
 *  - tau-b < tauThreshold               -> 'both-weak' (order itself is untrustworthy)
 *  - interval width < widthThreshold    -> 'scores-reliable' (order good AND magnitude tight)
 *  - otherwise                          -> 'trust-order-not-magnitude'
 *      (tau-b >= tauThreshold AND width >= widthThreshold: the paper's core regime)
 */
export function rankScoreDecoupling(
  observations: readonly ScoredObservation[],
  options: RankScoreOptions = {},
): RankScoreDecoupling {
  const tauThreshold = options.tauThreshold ?? 0.7;
  const widthThreshold = options.widthThreshold ?? 0.2;
  const n = observations.length;

  const rankCorrelation = kendallTauB(
    observations.map((o) => o.judgeScore),
    observations.map((o) => o.trueQuality),
  );
  const { normalizedWidth } = cardinalIntervalWidth(observations, options);

  let verdict: RankScoreVerdict;
  if (n < 2) verdict = "insufficient-data";
  else if (rankCorrelation < tauThreshold) verdict = "both-weak";
  else if (normalizedWidth < widthThreshold) verdict = "scores-reliable";
  else verdict = "trust-order-not-magnitude";

  return { n, rankCorrelation, normalizedIntervalWidth: normalizedWidth, verdict };
}

/** Quantile of an already-ascending-sorted array via linear interpolation (R type-7). */
function quantileSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * clamp01(p);
  const lo = Math.floor(h);
  const frac = h - lo;
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
