/**
 * Adaptive conformal intervals for trend forecasts (Gibbs–Candès, "Adaptive
 * Conformal Inference Under Distribution Shift", NeurIPS 2021).
 *
 * Extends the harness's distribution-free guarantee story from static gates
 * (conformal.ts) and sequential alarms (drift.ts) to FORECAST INTERVALS on
 * short business-cadence series (entropy trends, telemetry, quarterly
 * metrics): offer an interval around each forecast whose miscoverage level
 * ADAPTS online — after a miss the level tightens toward wider intervals,
 * after a cover it relaxes — so that long-run empirical coverage tends to the
 * target under ARBITRARY distribution shift, with no distributional model of
 * the series at all.
 *
 * Honest edges, stated rather than hidden:
 *  - the Gibbs–Candès guarantee is LONG-RUN average coverage; locally the
 *    interval can under-cover (the PID-control extension is the upgrade path
 *    if bands oscillate);
 *  - textbook ACI lets the adaptive level exit [0,1] (an excursion below 0
 *    meaning "offer the infinite interval"); we clamp to [0.001, 0.999] to
 *    keep widths finite and states serializable, trading a corner of the
 *    asymptotic argument for bounded artifacts — the clamp is disclosed in
 *    the statement;
 *  - when history is too short to certify the requested level (the conformal
 *    rank exceeds the sample), the module ABSTAINS (returns no interval)
 *    instead of offering an uncertified width — the house pattern.
 *
 * Pure and deterministic; state is plain serializable data (persist, resume,
 * replay). No model, network, key, or clock.
 */

export interface AciOptions {
  /** Target long-run miscoverage α ∈ (0,1) (e.g. 0.2 → 80% coverage). */
  targetMiscoverage: number;
  /** Adaptation rate γ (default 0.01): α_{t+1} = clamp(α_t + γ(α − err_t)). */
  gamma?: number;
  /** Minimum residual history before any interval is offered (default 10). */
  minHistory?: number;
  /** Optional sliding window over residuals (default: unbounded history). */
  maxHistory?: number;
}

export interface AciInterval {
  lower: number;
  upper: number;
  halfWidth: number;
  /** The adaptive level the interval was computed at. */
  alphaUsed: number;
}

export interface AciState {
  readonly kind: "aci";
  readonly targetMiscoverage: number;
  readonly gamma: number;
  readonly minHistory: number;
  readonly maxHistory: number | null;
  /** Adaptive miscoverage level α_t, clamped to [0.001, 0.999]. */
  readonly alphaT: number;
  /** Absolute residuals |actual − forecast| in arrival order (window-trimmed). */
  readonly residuals: readonly number[];
  readonly observations: number;
  /** Steps where an interval WAS offered (adaptation only happens on these). */
  readonly scoredSteps: number;
  readonly misses: number;
  readonly statement: string;
}

const ALPHA_LO = 0.001;
const ALPHA_HI = 0.999;

function clampAlpha(a: number): number {
  return Math.min(ALPHA_HI, Math.max(ALPHA_LO, a));
}

function aciStatement(s: Omit<AciState, "statement">): string {
  const coverage = s.scoredSteps === 0 ? null : 1 - s.misses / s.scoredSteps;
  return (
    `ACI at target miscoverage ${s.targetMiscoverage}: adaptive level α_t=${s.alphaT.toFixed(4)} after ` +
    `${s.observations} observations (${s.scoredSteps} scored, ${s.misses} misses` +
    (coverage === null ? "" : `, empirical coverage ${(coverage * 100).toFixed(1)}%`) +
    `). Long-run coverage tends to ${((1 - s.targetMiscoverage) * 100).toFixed(0)}% under arbitrary ` +
    `distribution shift (Gibbs–Candès); local under-coverage is possible; α_t is clamped to ` +
    `[${ALPHA_LO}, ${ALPHA_HI}]; the module abstains rather than offer an uncertified width.`
  );
}

export function initAci(options: AciOptions): AciState {
  const { targetMiscoverage } = options;
  if (!Number.isFinite(targetMiscoverage) || targetMiscoverage <= 0 || targetMiscoverage >= 1) {
    throw new Error(`targetMiscoverage must be in (0,1), got ${targetMiscoverage}`);
  }
  const gamma = options.gamma ?? 0.01;
  if (!Number.isFinite(gamma) || gamma <= 0 || gamma >= 1) {
    throw new Error(`gamma must be in (0,1), got ${gamma}`);
  }
  const minHistory = options.minHistory ?? 10;
  if (!Number.isInteger(minHistory) || minHistory < 2) {
    throw new Error(`minHistory must be an integer ≥ 2, got ${minHistory}`);
  }
  const maxHistory = options.maxHistory ?? null;
  if (maxHistory !== null && (!Number.isInteger(maxHistory) || maxHistory < minHistory)) {
    throw new Error(`maxHistory must be an integer ≥ minHistory, got ${maxHistory}`);
  }
  const base = {
    kind: "aci" as const,
    targetMiscoverage,
    gamma,
    minHistory,
    maxHistory,
    alphaT: clampAlpha(targetMiscoverage),
    residuals: [] as readonly number[],
    observations: 0,
    scoredSteps: 0,
    misses: 0,
  };
  return { ...base, statement: aciStatement(base) };
}

/**
 * The interval in force for a forecast under the CURRENT state, or null when
 * the history cannot certify the current level (abstention): either fewer
 * than `minHistory` residuals, or the conformal rank ⌈(n+1)(1−α_t)⌉ exceeds n.
 */
export function intervalFor(state: AciState, forecast: number): AciInterval | null {
  if (!Number.isFinite(forecast)) throw new Error(`forecast must be finite, got ${forecast}`);
  const n = state.residuals.length;
  if (n < state.minHistory) return null;
  const rank = Math.ceil((n + 1) * (1 - state.alphaT));
  if (rank > n) return null;
  const sorted = [...state.residuals].sort((a, b) => a - b);
  const halfWidth = sorted[rank - 1] as number;
  return { lower: forecast - halfWidth, upper: forecast + halfWidth, halfWidth, alphaUsed: state.alphaT };
}

export interface AciUpdate {
  forecast: number;
  actual: number;
}

/**
 * Score the in-force interval against the realized value, adapt α_t
 * (only when an interval was actually offered — an abstention cannot miss),
 * and append the new residual. Pure; the input state is unchanged.
 */
export function updateAci(state: AciState, update: AciUpdate): AciState {
  const { forecast, actual } = update;
  if (!Number.isFinite(forecast) || !Number.isFinite(actual)) {
    throw new Error(`forecast and actual must be finite, got (${forecast}, ${actual})`);
  }
  const offered = intervalFor(state, forecast);
  const residual = Math.abs(actual - forecast);

  let alphaT = state.alphaT;
  let scoredSteps = state.scoredSteps;
  let misses = state.misses;
  if (offered !== null) {
    const err = residual > offered.halfWidth ? 1 : 0;
    alphaT = clampAlpha(alphaT + state.gamma * (state.targetMiscoverage - err));
    scoredSteps += 1;
    misses += err;
  }

  let residuals = [...state.residuals, residual];
  if (state.maxHistory !== null && residuals.length > state.maxHistory) {
    residuals = residuals.slice(residuals.length - state.maxHistory);
  }

  const base = {
    ...state,
    alphaT,
    residuals,
    observations: state.observations + 1,
    scoredSteps,
    misses,
  };
  return { ...base, statement: aciStatement(base) };
}
