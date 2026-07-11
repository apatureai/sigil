/**
 * Calibrated-judge metrics — the differentiator (methodology core #130).
 *
 * The audit's quality number ships WITH its own reliability. Given the judge's
 * confidence on each scored output and whether that judgment was actually
 * correct (versus the human-labeled ground truth), we report:
 *  - Expected Calibration Error (ECE): does a "0.8 confidence" hold ~80% of the
 *    time?
 *  - Brier score: overall probabilistic accuracy of the judge.
 *  - a reliability table (confidence bucket -> empirical hit rate).
 *
 * Pure and deterministic.
 */

export interface JudgePrediction {
  /** The judge's confidence in [0,1] that its verdict is correct. */
  confidence: number;
  /** Whether the judge's verdict matched the human-labeled ground truth. */
  correct: boolean;
}

export interface ReliabilityBin {
  /** Lower edge of the confidence bucket, inclusive. */
  lower: number;
  /** Upper edge, exclusive (inclusive for the final bin). */
  upper: number;
  count: number;
  /** Mean predicted confidence in the bucket. */
  predicted: number;
  /** Empirical fraction correct in the bucket. */
  empirical: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Partition predictions into `bins` equal-width confidence buckets.
 *
 * Bin assignment is `floor(confidence / width)` (last bin inclusive of 1) —
 * deliberately IDENTICAL to @engine/eval's canonical convention, including
 * its floating-point behavior at bin edges, so the two repos' calibration
 * numbers can never disagree (sigil#2; pinned by the cross-repo golden in
 * `fixtures/calibration-contract.golden.json`). Do not "fix" the edge
 * arithmetic here without changing it upstream first: agreement with the
 * canonical implementation is the requirement, and the contract test breaks
 * on any unilateral change.
 */
export function reliabilityTable(predictions: readonly JudgePrediction[], bins = 10): ReliabilityBin[] {
  const width = 1 / bins;
  const sumConf = Array<number>(bins).fill(0);
  const sumCorrect = Array<number>(bins).fill(0);
  const count = Array<number>(bins).fill(0);

  for (const p of predictions) {
    const c = clamp01(p.confidence);
    let b = Math.floor(c / width);
    if (b >= bins) b = bins - 1; // confidence === 1
    sumConf[b] = (sumConf[b] ?? 0) + c;
    sumCorrect[b] = (sumCorrect[b] ?? 0) + (p.correct ? 1 : 0);
    count[b] = (count[b] ?? 0) + 1;
  }

  const out: ReliabilityBin[] = [];
  for (let i = 0; i < bins; i++) {
    const n = count[i] ?? 0;
    out.push({
      lower: i * width,
      upper: (i + 1) * width,
      count: n,
      predicted: n === 0 ? 0 : (sumConf[i] ?? 0) / n,
      empirical: n === 0 ? 0 : (sumCorrect[i] ?? 0) / n,
    });
  }
  return out;
}

/**
 * Expected Calibration Error: the count-weighted average gap between predicted
 * confidence and empirical accuracy across the reliability bins. 0 = perfectly
 * calibrated.
 */
export function expectedCalibrationError(predictions: readonly JudgePrediction[], bins = 10): number {
  if (predictions.length === 0) return 0;
  const table = reliabilityTable(predictions, bins);
  let ece = 0;
  for (const bin of table) {
    if (bin.count === 0) continue;
    ece += (bin.count / predictions.length) * Math.abs(bin.predicted - bin.empirical);
  }
  return ece;
}

/** Brier score: mean squared error between confidence and the 0/1 outcome. */
export function brierScore(predictions: readonly JudgePrediction[]): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce((s, p) => {
    const c = clamp01(p.confidence);
    const o = p.correct ? 1 : 0;
    return s + (c - o) ** 2;
  }, 0);
  return sum / predictions.length;
}

export interface JudgeReliability {
  ece: number;
  brier: number;
  table: ReliabilityBin[];
  sampleSize: number;
}

/** Bundle the judge's calibration metrics for the audit report. */
export function judgeReliability(predictions: readonly JudgePrediction[], bins = 10): JudgeReliability {
  return {
    ece: expectedCalibrationError(predictions, bins),
    brier: brierScore(predictions),
    table: reliabilityTable(predictions, bins),
    sampleSize: predictions.length,
  };
}
