/**
 * Audit harness (methodology: TRD §2) — the pipeline wiring.
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

export interface AuditReport {
  judgeReliability: JudgeReliability;
  families: FamilyFrontier[];
  passK: PassKRow[];
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

  for (const model of modelsSorted) {
    for (const task of tasksSorted) {
      const stats: ModelTaskStats = { passes: [], costUsd: 0, latencyMs: 0 };
      for (let trial = 0; trial < input.trialsPerTask; trial++) {
        const res = await input.gateway.run({ model, taskId: task.taskId, trial, input: task.input });
        const verdict = input.judge.judge(task.taskId, res.output);
        const truth = input.groundTruth.accept(task.taskId, res.output);
        // Calibration: was the judge's verdict actually correct vs ground truth?
        predictions.push({ confidence: verdict.confidence, correct: verdict.pass === truth });
        stats.passes.push(verdict.pass);
        stats.costUsd = res.costUsd;
        stats.latencyMs = res.latencyMs;
      }

      const passRate = stats.passes.filter(Boolean).length / Math.max(1, stats.passes.length);
      const fam = familyQuality.get(model) ?? new Map<string, number[]>();
      fam.set(task.family, [...(fam.get(task.family) ?? []), passRate]);
      familyQuality.set(model, fam);
      modelCost.set(model, [...(modelCost.get(model) ?? []), stats.costUsd]);
      modelLatency.set(model, [...(modelLatency.get(model) ?? []), stats.latencyMs]);

      if (input.passK <= stats.passes.length) {
        passKRows.push({ model, taskId: task.taskId, ...passAtK(stats.passes, input.passK) });
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
  };
}
