/**
 * Run-to-run reliability — Pass^k (methodology #130, the "fear wedge").
 *
 * Point-estimate evals hide the "different output every run" risk. Given a
 * model's per-run pass/fail over the same task, Pass^k is the probability that k
 * independent runs ALL clear the bar — the axis a risk owner cares about. We use
 * the unbiased combinatorial estimator (probability a random k-subset of the
 * observed runs all pass), which avoids the optimism of naively powering the
 * point pass-rate.
 */

export interface PassKResult {
  /** Number of observed runs. */
  n: number;
  /** Number that passed. */
  passes: number;
  passRate: number;
  /** Unbiased estimate that k independent runs all pass. */
  passHatK: number;
}

/**
 * Unbiased Pass^k estimator: ∏_{i=0}^{k-1} (passes - i) / (n - i), i.e. the
 * probability that a uniformly random k-subset of the n runs is all passes.
 * Returns 0 when there are fewer than k passes, and requires k <= n.
 */
export function passAtK(trials: readonly boolean[], k: number): PassKResult {
  const n = trials.length;
  const passes = trials.filter(Boolean).length;
  if (k < 1) throw new Error("k must be >= 1");
  if (k > n) throw new Error("k must be <= number of trials");

  let passHatK = 1;
  for (let i = 0; i < k; i++) {
    passHatK *= (passes - i) / (n - i);
  }
  passHatK = Math.max(0, passHatK);

  return { n, passes, passRate: n === 0 ? 0 : passes / n, passHatK };
}
