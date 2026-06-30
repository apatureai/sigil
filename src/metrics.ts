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

/** Partition predictions into `bins` equal-width confidence buckets. */
export function reliabilityTable(predictions: readonly JudgePrediction[], bins = 10): ReliabilityBin[] {
  const out: ReliabilityBin[] = [];
  for (let i = 0; i < bins; i++) {
    const lower = i / bins;
    const upper = (i + 1) / bins;
    const inBin = predictions.filter((p) => {
      const c = clamp01(p.confidence);
      return i === bins - 1 ? c >= lower && c <= upper : c >= lower && c < upper;
    });
    const count = inBin.length;
    const predicted = count === 0 ? 0 : inBin.reduce((s, p) => s + clamp01(p.confidence), 0) / count;
    const empirical = count === 0 ? 0 : inBin.filter((p) => p.correct).length / count;
    out.push({ lower, upper, count, predicted, empirical });
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
