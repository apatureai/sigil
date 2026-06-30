/**
 * Efficiency frontier — the dollar finding (methodology #130, step 5).
 *
 * Per task family, the Pareto-optimal set over quality (higher better), cost and
 * latency (lower better), plus the equal-or-better-quality switch that saves the
 * most money. Savings are only claimed when measured quality is held — never the
 * headline router-marketing number.
 */

export interface Candidate {
  id: string;
  /** Calibrated quality in [0,1] (judged against the client's rubric). */
  quality: number;
  costPerRunUsd: number;
  latencyMs: number;
}

/** True when `a` is dominated by `b` (b is >= on every axis and strictly better on one). */
function dominatedBy(a: Candidate, b: Candidate): boolean {
  const noWorse = b.quality >= a.quality && b.costPerRunUsd <= a.costPerRunUsd && b.latencyMs <= a.latencyMs;
  const strictlyBetter = b.quality > a.quality || b.costPerRunUsd < a.costPerRunUsd || b.latencyMs < a.latencyMs;
  return noWorse && strictlyBetter;
}

/** The non-dominated (Pareto-optimal) candidates, in stable id order. */
export function paretoFrontier(candidates: readonly Candidate[]): Candidate[] {
  return candidates
    .filter((a) => !candidates.some((b) => b.id !== a.id && dominatedBy(a, b)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface SwitchRecommendation {
  fromId: string;
  toId: string;
  /** Fraction of cost saved, in [0,1], at equal-or-better quality. */
  savingsPct: number;
  latencyDeltaMs: number;
  qualityDelta: number;
}

/**
 * Recommend the cheapest candidate whose quality is at least the current
 * candidate's (within `qualityTolerance`), and quantify the saving. Returns null
 * when nothing beats the current pick on cost at held quality.
 */
export function recommendSwitch(
  current: Candidate,
  candidates: readonly Candidate[],
  qualityTolerance = 0,
): SwitchRecommendation | null {
  const atOrAboveQuality = candidates.filter(
    (c) => c.id !== current.id && c.quality >= current.quality - qualityTolerance,
  );
  let best: Candidate | undefined;
  for (const c of atOrAboveQuality) {
    if (c.costPerRunUsd < current.costPerRunUsd && (best === undefined || c.costPerRunUsd < best.costPerRunUsd)) {
      best = c;
    }
  }
  if (best === undefined) return null;
  return {
    fromId: current.id,
    toId: best.id,
    savingsPct: current.costPerRunUsd === 0 ? 0 : (current.costPerRunUsd - best.costPerRunUsd) / current.costPerRunUsd,
    latencyDeltaMs: best.latencyMs - current.latencyMs,
    qualityDelta: best.quality - current.quality,
  };
}
