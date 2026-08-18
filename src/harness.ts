/**
 * Audit harness (methodology: TRD §2): the pipeline wiring.
 *
 * Wires the pipeline: run a frozen panel over a frozen corpus via an injected
 * gateway -> judge each output with a calibrated judge -> aggregate per-family
 * quality/cost/latency into a Pareto efficiency frontier with an equal-quality
 * savings recommendation -> compute Pass^k run-to-run reliability -> report the
 * judge's own calibration (ECE/Brier/reliability table).
 *
 * Pure orchestration over injected ports: no model, key, or network here.
 */

import { judgeReliability, type JudgePrediction, type JudgeReliability } from "./metrics.js";
import { passAtK, type PassKResult } from "./reliability.js";
import { paretoFrontier, recommendSwitch, type Candidate, type SwitchRecommendation } from "./frontier.js";
import type { Gateway } from "./gateway.js";

export interface Task {
  taskId: string;
  family: string;
  input: string;
}

export interface Corpus {
  tasks: Task[];
}

/** Human-labeled ground truth: is this output acceptable for the task? */
export interface GroundTruth {
  accept(taskId: string, output: string): boolean;
}

export interface JudgeVerdict {
  pass: boolean;
  /** Judge confidence in its own verdict, in [0,1] (drives calibration). */
  confidence: number;
}

/** The calibrated judge under audit; in production an LLM-judge, in tests a stub. */
export interface Judge {
  judge(taskId: string, output: string): JudgeVerdict;
}

export interface AuditInput {
  corpus: Corpus;
  models: string[];
  gateway: Gateway;
  judge: Judge;
  groundTruth: GroundTruth;
  trialsPerTask: number;
  /** k for Pass^k run-to-run reliability. */
  passK: number;
  /** The model the client currently uses, for the savings recommendation. */
  currentModel: string;
}

export interface FamilyFrontier {
  family: string;
  candidates: Candidate[];
  frontier: Candidate[];
  recommendation: SwitchRecommendation | null;
}

export interface PassKRow extends PassKResult {
  model: string;
  taskId: string;
}

/** One (model, task) whose capture held fewer trials than the audit asked for. */
export interface TrialShortfall {
  model: string;
  taskId: string;
  /** Trials the audit configuration asked for. */
  requested: number;
  /** Distinct recorded trials the capture actually held. */
  recorded: number;
  /** `requested - recorded`: responses the gateway repeated rather than recorded. */
  replayed: number;
}

/**
 * Whether every requested trial was backed by a distinct recorded one.
 *
 * `complete: false` means the audit consumed fewer samples than its
 * configuration named, because the rest did not exist. That is a statement about
 * the EVIDENCE, so it travels with the report rather than being resolved by
 * padding: for a tool whose output is calibrated confidence, an inflated sample
 * count is the worst possible failure.
 */
export interface TrialCoverage {
  requestedTrialsPerTask: number;
  complete: boolean;
  /** Distinct recorded trials actually judged, across every (model, task). */
  realTrials: number;
  /** Repeats the gateway offered and the audit refused to count. */
  replayedTrials: number;
  /** Every shortfall, sorted by model then task. Empty when `complete`. */
  shortfalls: TrialShortfall[];
}

/** One (model, task) whose recorded trials cannot answer the Pass^k question. */
export interface PassKGap {
  model: string;
  taskId: string;
  /** The k the audit asked for. */
  k: number;
  /** Distinct recorded trials judged for this pair; fewer than `k`. */
  trials: number;
}

/**
 * Which (model, task) pairs the Pass^k question was actually answered for.
 *
 * The unbiased estimator needs at least k observed runs, so a pair holding
 * fewer is skipped rather than estimated. Skipping SILENTLY is the failure this
 * records: with `passK` above every pair's trial count, `passK` comes back
 * empty and the report's reliability section renders as a heading with no rows,
 * which reads as "nothing to flag" when the truth is "nothing was measured".
 */
export interface PassKCoverage {
  /** The k the audit asked for. */
  k: number;
  /** (model, task) pairs Pass^k was computed over. */
  measured: number;
  /** Pairs holding fewer than k recorded trials, sorted by model then task. */
  unmeasured: PassKGap[];
}

export interface AuditReport {
  judgeReliability: JudgeReliability;
  families: FamilyFrontier[];
  passK: PassKRow[];
  /** What the numbers above are actually made of. Never omitted. */
  trialCoverage: TrialCoverage;
  /** Which pairs the `passK` rows cover, and which they do not. Never omitted. */
  passKCoverage: PassKCoverage;
}

interface ModelTaskStats {
  passes: boolean[]; // per trial
  costUsd: number;
  latencyMs: number;
}

export async function runAudit(input: AuditInput): Promise<AuditReport> {
  const predictions: JudgePrediction[] = [];
  const passKRows: PassKRow[] = [];
  // model -> family -> mean quality accumulation; model -> cost/latency.
  const familyQuality = new Map<string, Map<string, number[]>>(); // model -> family -> per-task pass-rate
  const modelCost = new Map<string, number[]>();
  const modelLatency = new Map<string, number[]>();

  const tasksSorted = [...input.corpus.tasks].sort((a, b) => a.taskId.localeCompare(b.taskId));
  const modelsSorted = [...input.models].sort();
  const shortfalls: TrialShortfall[] = [];
  const passKGaps: PassKGap[] = [];
  let realTrials = 0;
  let replayedTrials = 0;

  for (const model of modelsSorted) {
    for (const task of tasksSorted) {
      const stats: ModelTaskStats = { passes: [], costUsd: 0, latencyMs: 0 };
      let replayed = 0;
      for (let trial = 0; trial < input.trialsPerTask; trial++) {
        const res = await input.gateway.run({ model, taskId: task.taskId, trial, input: task.input });
        stats.costUsd = res.costUsd;
        stats.latencyMs = res.latencyMs;
        // A replay is the same recorded output handed back again. Judging it
        // would produce a duplicate prediction and a duplicate "run", which is
        // how `sample: 24` came out of 12 judgements and how Pass^3 rose from
        // 0.25 to 0.625 without a single new observation.
        if (res.replayed === true) {
          replayed += 1;
          continue;
        }
        const verdict = input.judge.judge(task.taskId, res.output);
        const truth = input.groundTruth.accept(task.taskId, res.output);
        // Calibration: was the judge's verdict actually correct vs ground truth?
        predictions.push({ confidence: verdict.confidence, correct: verdict.pass === truth });
        stats.passes.push(verdict.pass);
      }
      realTrials += stats.passes.length;
      replayedTrials += replayed;
      if (replayed > 0) {
        shortfalls.push({
          model,
          taskId: task.taskId,
          requested: input.trialsPerTask,
          recorded: stats.passes.length,
          replayed,
        });
      }

      const passRate = stats.passes.filter(Boolean).length / Math.max(1, stats.passes.length);
      const fam = familyQuality.get(model) ?? new Map<string, number[]>();
      fam.set(task.family, [...(fam.get(task.family) ?? []), passRate]);
      familyQuality.set(model, fam);
      modelCost.set(model, [...(modelCost.get(model) ?? []), stats.costUsd]);
      modelLatency.set(model, [...(modelLatency.get(model) ?? []), stats.latencyMs]);

      // Pass^k over fewer than k runs is not a smaller number, it is no number
      // at all. The pair is recorded as unmeasured so its absence from the
      // table below cannot be read as a clean result.
      if (input.passK <= stats.passes.length) {
        passKRows.push({ model, taskId: task.taskId, ...passAtK(stats.passes, input.passK) });
      } else {
        passKGaps.push({ model, taskId: task.taskId, k: input.passK, trials: stats.passes.length });
      }
    }
  }

  const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

  const families = [...new Set(input.corpus.tasks.map((t) => t.family))].sort().map((family): FamilyFrontier => {
    const candidates: Candidate[] = modelsSorted.map((model) => ({
      id: model,
      quality: mean(familyQuality.get(model)?.get(family) ?? []),
      costPerRunUsd: mean(modelCost.get(model) ?? []),
      latencyMs: mean(modelLatency.get(model) ?? []),
    }));
    const current = candidates.find((c) => c.id === input.currentModel);
    return {
      family,
      candidates,
      frontier: paretoFrontier(candidates),
      recommendation: current ? recommendSwitch(current, candidates) : null,
    };
  });

  return {
    judgeReliability: judgeReliability(predictions),
    families,
    passK: passKRows.sort((a, b) => a.model.localeCompare(b.model) || a.taskId.localeCompare(b.taskId)),
    trialCoverage: {
      requestedTrialsPerTask: input.trialsPerTask,
      complete: shortfalls.length === 0,
      realTrials,
      replayedTrials,
      shortfalls: shortfalls.sort((a, b) => a.model.localeCompare(b.model) || a.taskId.localeCompare(b.taskId)),
    },
    passKCoverage: {
      k: input.passK,
      measured: passKRows.length,
      unmeasured: passKGaps.sort((a, b) => a.model.localeCompare(b.model) || a.taskId.localeCompare(b.taskId)),
    },
  };
}
