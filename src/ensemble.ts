/**
 * Multi-judge ensemble + disagreement disclosure (backlog #15).
 *
 * A single LLM-judge is itself a model with its own failure modes, so a
 * regulator-grade assurance verdict should not rest on one. An ensemble of
 * calibrated judges votes on each output; the verdict is the majority (ties
 * resolve conservatively to FAIL, never waving something through on a split),
 * the confidence is the mean, and, critically, the inter-judge DISAGREEMENT is
 * disclosed alongside ECE/Brier as a first-class reliability signal. High
 * disagreement means the measurement itself is uncertain, and hiding that would
 * defeat the whole point of independent assurance.
 *
 * Deterministic and pure: it drops into `runAudit` as an ordinary `Judge`.
 */

import type { Judge, JudgeVerdict } from "./harness.js";

export interface NamedJudge {
  id: string;
  judge: Judge;
}

export interface DisagreementSummary {
  /** Mean per-verdict disagreement fraction across every judged output. */
  mean: number;
  /** The single most-contested verdict's disagreement fraction. */
  max: number;
  /** Number of verdicts observed. */
  count: number;
}

/**
 * Majority-vote judge over a panel of judges. Records per-verdict disagreement
 * (the fraction of judges dissenting from the majority) for later disclosure.
 */
export class JudgeEnsemble implements Judge {
  private readonly judges: NamedJudge[];
  private totalDisagreement = 0;
  private maxDisagreement = 0;
  private count = 0;

  constructor(judges: NamedJudge[]) {
    if (judges.length === 0) throw new Error("an ensemble needs at least one judge");
    this.judges = [...judges].sort((a, b) => a.id.localeCompare(b.id));
  }

  judge(taskId: string, output: string): JudgeVerdict {
    const verdicts = this.judges.map((j) => j.judge.judge(taskId, output));
    const passes = verdicts.filter((v) => v.pass).length;
    const n = verdicts.length;
    // Strict majority to pass; a tie resolves conservatively to fail.
    const pass = passes * 2 > n;
    const confidence = verdicts.reduce((s, v) => s + v.confidence, 0) / n;

    const dissent = Math.min(passes, n - passes) / n;
    this.totalDisagreement += dissent;
    this.maxDisagreement = Math.max(this.maxDisagreement, dissent);
    this.count += 1;

    return { pass, confidence };
  }

  /** The accumulated inter-judge disagreement, for disclosure in the report. */
  disagreement(): DisagreementSummary {
    return {
      mean: this.count === 0 ? 0 : this.totalDisagreement / this.count,
      max: this.maxDisagreement,
      count: this.count,
    };
  }
}
