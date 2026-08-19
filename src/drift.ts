/**
 * Anytime-valid drift monitoring: e-processes and e-detectors for bounded
 * metrics (the SR 26-2 "ongoing monitoring" companion to the static
 * certificates in conformal.ts).
 *
 * The construction is the betting supermartingale for bounded observations
 * (Shin-Ramdas-Rinaldo e-detectors, arXiv 2203.03532; Waudby-Smith-Ramdas
 * betting line): for x_t ∈ [0,1] and H0 "true mean ≤ μ0", each factor
 * 1 + λ(x_t − μ0) with λ ∈ [0, 1/μ0) has expectation ≤ 1 under H0, so the
 * running product is a nonnegative supermartingale. Two monitors, with two
 * DIFFERENT guarantees, and the statements below never blur them:
 *
 *  - `EProcess` (fixed-null sequential test): by Ville's inequality, alarming
 *    when the e-value reaches 1/α bounds the probability of EVER false-alarming
 *    over the entire (unbounded) monitoring horizon by α. This is the
 *    examiner-grade sentence: "if the judge's error rate truly stayed ≤ μ0,
 *    the chance this monitor ever fires is ≤ α."
 *  - `EDetector` (changepoint, e-CUSUM style): per-λ statistic
 *    C_t = max(C_{t−1}, 1) · (1 + λ(x_t − μ0)), averaged over the λ grid;
 *    alarming at 1/α controls the AVERAGE RUN LENGTH to false alarm:
 *    E[time to false alarm] ≥ 1/α under H0. Weaker than Ville-forever, but it
 *    keeps sensitivity to LATE changes that a plain e-process bleeds away.
 *
 * A λ GRID (mixture of supermartingales is a supermartingale; average of
 * per-λ CUSUM stats keeps the ARL bound) replaces tuning: no optimization, no
 * randomness, no wall clock. State is a plain serializable object so a
 * monitoring run can be persisted, resumed, and independently REPLAYED from
 * the observation log, the same reproducibility posture as the rest of the
 * harness. Classical one-sided CUSUM (Page) ships alongside as the
 * weaker-guarantee baseline the fixtures compare against.
 *
 * Pure and deterministic; no model, network, key, or clock.
 */

import type { JudgePrediction } from "./metrics.js";

// --- Shared validation ------------------------------------------------------

function assertUnit(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error(`${name} must be in [0,1], got ${v}`);
  }
}

function assertOpenUnit(name: string, v: number): void {
  if (!Number.isFinite(v) || v <= 0 || v >= 1) {
    throw new Error(`${name} must be in (0,1), got ${v}`);
  }
}

/** Default λ grid as fractions of the maximum valid bet 1/μ0. */
const DEFAULT_BET_FRACTIONS = [0.05, 0.1, 0.2, 0.4, 0.8] as const;

function resolveLambdas(mu0: number, lambdas?: readonly number[]): number[] {
  const resolved = lambdas !== undefined ? [...lambdas] : DEFAULT_BET_FRACTIONS.map((f) => f / mu0);
  if (resolved.length === 0) throw new Error("at least one λ is required");
  for (const l of resolved) {
    if (!Number.isFinite(l) || l <= 0 || l >= 1 / mu0) {
      throw new Error(`λ must be in (0, 1/μ0) = (0, ${(1 / mu0).toFixed(4)}), got ${l}`);
    }
  }
  return resolved;
}

// --- Fixed-null e-process (Ville guarantee) ---------------------------------

export interface DriftMonitorOptions {
  /** Null bound: H0 is "true mean ≤ μ0" (e.g. the contracted error-rate bar). */
  mu0: number;
  /** Horizon-wide false-alarm budget α; the alarm threshold is 1/α. */
  alpha: number;
  /** Optional explicit bet grid; defaults to fractions of 1/μ0. */
  lambdas?: readonly number[];
}

export interface EProcessState {
  readonly kind: "e_process";
  readonly mu0: number;
  readonly alpha: number;
  readonly lambdas: readonly number[];
  /** Per-λ running products (supermartingales under H0). */
  readonly perLambda: readonly number[];
  /** Mixture e-value: mean of the per-λ products. */
  readonly eValue: number;
  readonly threshold: number;
  readonly observations: number;
  readonly alarmed: boolean;
  /** 1-based observation index at first alarm; null before any alarm. */
  readonly alarmedAt: number | null;
  /** The guarantee this monitor carries, stated exactly. */
  readonly statement: string;
}

function eProcessStatement(s: Omit<EProcessState, "statement">): string {
  return (
    `E-process vs H0 "true rate ≤ ${(s.mu0 * 100).toFixed(2)}%": e-value ${s.eValue.toFixed(4)} ` +
    `against threshold ${s.threshold.toFixed(2)} after ${s.observations} observations` +
    (s.alarmed ? `; ALARMED at observation ${s.alarmedAt}` : "") +
    `. Guarantee (Ville): if H0 holds, the probability this monitor EVER alarms is ≤ ${s.alpha}.`
  );
}

export function initEProcess(options: DriftMonitorOptions): EProcessState {
  assertOpenUnit("mu0", options.mu0);
  assertOpenUnit("alpha", options.alpha);
  const lambdas = resolveLambdas(options.mu0, options.lambdas);
  const base = {
    kind: "e_process" as const,
    mu0: options.mu0,
    alpha: options.alpha,
    lambdas,
    perLambda: lambdas.map(() => 1),
    eValue: 1,
    threshold: 1 / options.alpha,
    observations: 0,
    alarmed: false,
    alarmedAt: null,
  };
  return { ...base, statement: eProcessStatement(base) };
}

/** Fold one bounded observation into the e-process. Pure; input state unchanged. */
export function updateEProcess(state: EProcessState, x: number): EProcessState {
  assertUnit("observation", x);
  const perLambda = state.perLambda.map((e, i) => e * (1 + (state.lambdas[i] as number) * (x - state.mu0)));
  const eValue = perLambda.reduce((a, b) => a + b, 0) / perLambda.length;
  const observations = state.observations + 1;
  const crossed = eValue >= state.threshold;
  const base = {
    ...state,
    perLambda,
    eValue,
    observations,
    alarmed: state.alarmed || crossed,
    alarmedAt: state.alarmedAt ?? (crossed ? observations : null),
  };
  return { ...base, statement: eProcessStatement(base) };
}

// --- Changepoint e-detector (ARL guarantee) ---------------------------------

export interface EDetectorState {
  readonly kind: "e_detector";
  readonly mu0: number;
  readonly alpha: number;
  readonly lambdas: readonly number[];
  /** Per-λ e-CUSUM statistics: C_t = max(C_{t−1}, 1) · factor. */
  readonly perLambda: readonly number[];
  /** Detector statistic: mean of per-λ e-CUSUM values. */
  readonly stat: number;
  readonly threshold: number;
  readonly observations: number;
  readonly alarmed: boolean;
  readonly alarmedAt: number | null;
  readonly statement: string;
}

function eDetectorStatement(s: Omit<EDetectorState, "statement">): string {
  return (
    `E-detector (changepoint) vs pre-change rate ≤ ${(s.mu0 * 100).toFixed(2)}%: statistic ${s.stat.toFixed(4)} ` +
    `against threshold ${s.threshold.toFixed(2)} after ${s.observations} observations` +
    (s.alarmed ? `; ALARMED at observation ${s.alarmedAt}` : "") +
    `. Guarantee: with no change, the expected time to a false alarm is ≥ ${s.threshold.toFixed(0)} observations (ARL ≥ 1/α).`
  );
}

export function initEDetector(options: DriftMonitorOptions): EDetectorState {
  assertOpenUnit("mu0", options.mu0);
  assertOpenUnit("alpha", options.alpha);
  const lambdas = resolveLambdas(options.mu0, options.lambdas);
  const base = {
    kind: "e_detector" as const,
    mu0: options.mu0,
    alpha: options.alpha,
    lambdas,
    perLambda: lambdas.map(() => 1),
    stat: 1,
    threshold: 1 / options.alpha,
    observations: 0,
    alarmed: false,
    alarmedAt: null,
  };
  return { ...base, statement: eDetectorStatement(base) };
}

/** Fold one bounded observation into the e-detector. Pure; input state unchanged. */
export function updateEDetector(state: EDetectorState, x: number): EDetectorState {
  assertUnit("observation", x);
  const perLambda = state.perLambda.map(
    (c, i) => Math.max(c, 1) * (1 + (state.lambdas[i] as number) * (x - state.mu0)),
  );
  const stat = perLambda.reduce((a, b) => a + b, 0) / perLambda.length;
  const observations = state.observations + 1;
  const crossed = stat >= state.threshold;
  const base = {
    ...state,
    perLambda,
    stat,
    observations,
    alarmed: state.alarmed || crossed,
    alarmedAt: state.alarmedAt ?? (crossed ? observations : null),
  };
  return { ...base, statement: eDetectorStatement(base) };
}

// --- Classical CUSUM baseline (weaker, comparison only) ----------------------

export interface CusumOptions {
  /** Target (in-control) mean. */
  mu0: number;
  /** Reference value k (slack); alarms accumulate max(0, x − μ0 − k). */
  slack: number;
  /** Decision interval h. NOTE: no distribution-free false-alarm guarantee. */
  decisionInterval: number;
}

export interface CusumState {
  readonly kind: "cusum_baseline";
  readonly options: CusumOptions;
  readonly stat: number;
  readonly observations: number;
  readonly alarmed: boolean;
  readonly alarmedAt: number | null;
}

export function initCusum(options: CusumOptions): CusumState {
  assertOpenUnit("mu0", options.mu0);
  if (options.slack < 0 || options.decisionInterval <= 0) {
    throw new Error("cusum: slack must be ≥ 0 and decisionInterval > 0");
  }
  return { kind: "cusum_baseline", options, stat: 0, observations: 0, alarmed: false, alarmedAt: null };
}

/** One-sided (upward) Page CUSUM step. Baseline only: tune-by-simulation, no e-guarantee. */
export function updateCusum(state: CusumState, x: number): CusumState {
  assertUnit("observation", x);
  const stat = Math.max(0, state.stat + (x - state.options.mu0 - state.options.slack));
  const observations = state.observations + 1;
  const crossed = stat >= state.options.decisionInterval;
  return {
    ...state,
    stat,
    observations,
    alarmed: state.alarmed || crossed,
    alarmedAt: state.alarmedAt ?? (crossed ? observations : null),
  };
}

// --- Calibration adapter ------------------------------------------------------

/**
 * Judge-error observation stream for the monitors: 1 when the judge was wrong,
 * 0 when right. Monitoring this stream against μ0 = the contracted error bar
 * is the "ongoing monitoring" companion to the static certificates in
 * conformal.ts (same inputs, sequential guarantee).
 */
export function errorObservations(predictions: readonly JudgePrediction[]): number[] {
  return predictions.map((p) => (p.correct ? 0 : 1));
}
