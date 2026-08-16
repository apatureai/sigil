/**
 * Report generator (methodology: TRD §2, step 7): the finance/security-signable
 * deliverable.
 *
 * Turns an `AuditReport` into a deterministic, structured document plus a
 * markdown render an MRM / CISO can act on. It restates only what the audit
 * measured (calibrated quality with disclosed judge reliability, run-to-run
 * variance, the efficiency frontier and the equal-quality saving), and invents
 * nothing. Content-addressed so the artifact is reproducible.
 */

import { contentHash } from "./canonical.js";
import type { AuditReport } from "./harness.js";
import type { AbstentionCertificate } from "./conformal.js";
import type { CertifiedPassK, SwitchQualityEvidence } from "./stats.js";

export interface ReportMeta {
  client: string;
  /** Content hash of the frozen corpus the audit ran on (reproducibility). */
  corpusHash: string;
  panel: string[];
  generatedAt: string;
}

export interface ReportFinding {
  family: string;
  recommendedFromTo: { from: string; to: string } | null;
  savingsPct: number;
  qualityHeld: boolean;
}

/**
 * Optional guarantee/evidence inputs (conformal.ts / stats.ts). All optional
 * and additive: a document built without them is byte-identical to the
 * pre-evidence format, so existing golden artifacts and hashes are unaffected.
 */
export interface ReportEvidence {
  /** Certified abstention threshold over the judge's labeled calibration set. */
  abstention?: AbstentionCertificate;
  /** Paired switch-quality evidence per task family (exact McNemar gate). */
  switchEvidence?: Record<string, SwitchQualityEvidence>;
  /** Certified Pass^k floors per (model, family). */
  certifiedReliability?: Array<{ model: string; family: string; cert: CertifiedPassK }>;
}

export interface AuditReportDocument {
  meta: ReportMeta;
  judge: { ece: number; brier: number; sampleSize: number };
  findings: ReportFinding[];
  /** Lowest Pass^k observed per model: the run-to-run reliability exposure. */
  reliabilityExposure: Array<{ model: string; minPassHatK: number }>;
  /** Present only when a certificate was computed (see ReportEvidence). */
  abstention?: {
    certified: boolean;
    threshold: number | null;
    coverage: number;
    errorUpperBound: number | null;
    targetErrorRate: number;
    delta: number;
    calibrationSize: number;
    statement: string;
  };
  /** Present only when paired switch evidence was supplied; family-sorted. */
  switchEvidence?: Array<{
    family: string;
    defensible: boolean;
    pValue: number;
    discordant: number;
    pairs: number;
    statement: string;
  }>;
  /** Present only when certified floors were supplied; (model, family)-sorted. */
  certifiedReliability?: Array<{
    model: string;
    family: string;
    k: number;
    delta: number;
    passKLower: number;
  }>;
  /**
   * Present ONLY when the capture held fewer trials than the audit asked for.
   * Its absence is the claim that every requested trial was a distinct recorded
   * one, so a complete audit's document (and its hash) is unchanged.
   *
   * The counts above already exclude the repeats; this block names them, so a
   * reader of the signed artifact can see that the configuration asked for more
   * evidence than exists rather than inferring it from a sample size.
   */
  trialCoverage?: {
    requestedTrialsPerTask: number;
    realTrials: number;
    replayedTrials: number;
    shortfalls: Array<{ model: string; taskId: string; requested: number; recorded: number; replayed: number }>;
    statement: string;
  };
  documentHash: string;
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function buildReportDocument(
  report: AuditReport,
  meta: ReportMeta,
  evidence: ReportEvidence = {},
): AuditReportDocument {
  const findings: ReportFinding[] = report.families.map((f) => ({
    family: f.family,
    recommendedFromTo: f.recommendation ? { from: f.recommendation.fromId, to: f.recommendation.toId } : null,
    savingsPct: round(f.recommendation?.savingsPct ?? 0),
    // Equal-or-better quality is the only saving claimed (TRD §3.5).
    qualityHeld: (f.recommendation?.qualityDelta ?? 0) >= 0,
  }));

  const byModel = new Map<string, number>();
  for (const row of report.passK) {
    const prev = byModel.get(row.model);
    if (prev === undefined || row.passHatK < prev) byModel.set(row.model, row.passHatK);
  }
  const reliabilityExposure = [...byModel.entries()]
    .map(([model, minPassHatK]) => ({ model, minPassHatK: round(minPassHatK) }))
    .sort((a, b) => a.model.localeCompare(b.model));

  const body: Omit<AuditReportDocument, "documentHash"> = {
    meta,
    judge: { ece: round(report.judgeReliability.ece), brier: round(report.judgeReliability.brier), sampleSize: report.judgeReliability.sampleSize },
    findings,
    reliabilityExposure,
  };

  // Carried only when the evidence fell short, so a complete audit's document is
  // byte-identical to what it was before this block existed.
  const coverage = report.trialCoverage;
  if (coverage !== undefined && !coverage.complete) {
    const worst = [...coverage.shortfalls].sort((a, b) => a.recorded - b.recorded)[0];
    body.trialCoverage = {
      requestedTrialsPerTask: coverage.requestedTrialsPerTask,
      realTrials: coverage.realTrials,
      replayedTrials: coverage.replayedTrials,
      shortfalls: coverage.shortfalls.map((s) => ({ ...s })),
      statement:
        `Configuration asked for ${coverage.requestedTrialsPerTask} trials per task, but the capture ` +
        `held fewer for ${coverage.shortfalls.length} (model, task) pair${coverage.shortfalls.length === 1 ? "" : "s"}` +
        `${worst === undefined ? "" : ` (as few as ${worst.recorded})`}. ` +
        `Every number in this report is computed from the ${coverage.realTrials} distinct recorded trial` +
        `${coverage.realTrials === 1 ? "" : "s"} only; ${coverage.replayedTrials} repeated response` +
        `${coverage.replayedTrials === 1 ? " was" : "s were"} excluded rather than counted as evidence. ` +
        "Re-run the panel to obtain the missing trials before treating the requested count as achieved.",
    };
  }

  // Evidence blocks are ADDITIVE: absent evidence leaves the document (and its
  // hash) byte-identical to the pre-evidence format. The document restates
  // only what was measured; statements are carried verbatim.
  if (evidence.abstention !== undefined) {
    const a = evidence.abstention;
    body.abstention = {
      certified: a.certified,
      threshold: a.threshold,
      coverage: round(a.coverage),
      errorUpperBound: a.errorUpperBound === null ? null : round(a.errorUpperBound, 4),
      targetErrorRate: a.targetErrorRate,
      delta: a.delta,
      calibrationSize: a.calibrationSize,
      statement: a.statement,
    };
  }
  if (evidence.switchEvidence !== undefined) {
    body.switchEvidence = Object.entries(evidence.switchEvidence)
      .map(([family, e]) => ({
        family,
        defensible: e.defensible,
        pValue: round(e.mcnemar.pValue, 4),
        discordant: e.mcnemar.discordant,
        pairs: e.pairs,
        statement: e.statement,
      }))
      .sort((a, b) => a.family.localeCompare(b.family));
  }
  if (evidence.certifiedReliability !== undefined) {
    body.certifiedReliability = evidence.certifiedReliability
      .map((r) => ({
        model: r.model,
        family: r.family,
        k: r.cert.k,
        delta: r.cert.delta,
        passKLower: round(r.cert.passKLower),
      }))
      .sort((a, b) => a.model.localeCompare(b.model) || a.family.localeCompare(b.family));
  }

  return { ...body, documentHash: contentHash(body) };
}

/** Deterministic markdown render of the report document. */
export function renderMarkdown(doc: AuditReportDocument): string {
  const lines: string[] = [];
  lines.push(`# Independent AI Quality & Efficiency Assurance — ${doc.meta.client}`);
  lines.push("");
  lines.push(`- Corpus: \`${doc.meta.corpusHash}\``);
  lines.push(`- Panel: ${doc.meta.panel.join(", ")}`);
  lines.push(`- Generated: ${doc.meta.generatedAt}`);
  lines.push(`- Document hash: \`${doc.documentHash}\``);
  lines.push("");
  lines.push(`## Judge reliability (the number's own error bars)`);
  lines.push(`- ECE: ${doc.judge.ece} · Brier: ${doc.judge.brier} · sample: ${doc.judge.sampleSize}`);
  if (doc.trialCoverage !== undefined) {
    lines.push(
      `- INCOMPLETE EVIDENCE: ${doc.trialCoverage.replayedTrials} requested trial` +
        `${doc.trialCoverage.replayedTrials === 1 ? " was" : "s were"} not recorded and ` +
        `${doc.trialCoverage.replayedTrials === 1 ? "is" : "are"} excluded from this sample (see Trial coverage).`,
    );
  }
  lines.push("");
  lines.push(`## Efficiency frontier — equal-quality savings`);
  for (const f of doc.findings) {
    if (f.recommendedFromTo) {
      lines.push(`- **${f.family}**: switch ${f.recommendedFromTo.from} → ${f.recommendedFromTo.to}, save ${(f.savingsPct * 100).toFixed(1)}% at ${f.qualityHeld ? "equal-or-better" : "LOWER"} measured quality`);
    } else {
      lines.push(`- **${f.family}**: no equal-quality saving available (current pick is already on the frontier)`);
    }
  }
  lines.push("");
  lines.push(`## Run-to-run reliability exposure (Pass^k)`);
  for (const r of doc.reliabilityExposure) {
    lines.push(`- ${r.model}: worst-case Pass^k = ${r.minPassHatK}${r.minPassHatK < 1 ? " (inconsistent across runs)" : ""}`);
  }
  if (doc.abstention !== undefined) {
    lines.push("");
    lines.push(`## Certified abstention (finite-sample guarantee)`);
    lines.push(`- ${doc.abstention.statement}`);
  }
  if (doc.switchEvidence !== undefined && doc.switchEvidence.length > 0) {
    lines.push("");
    lines.push(`## Switch-claim evidence (paired exact McNemar)`);
    for (const e of doc.switchEvidence) {
      lines.push(`- **${e.family}** (${e.defensible ? "defensible" : "NOT defensible"}): ${e.statement}`);
    }
  }
  if (doc.certifiedReliability !== undefined && doc.certifiedReliability.length > 0) {
    lines.push("");
    lines.push(`## Certified reliability floors`);
    for (const r of doc.certifiedReliability) {
      lines.push(`- ${r.model} · ${r.family}: Pass^${r.k} ≥ ${(r.passKLower * 100).toFixed(1)}% at confidence ${((1 - r.delta) * 100).toFixed(0)}%`);
    }
  }
  if (doc.trialCoverage !== undefined) {
    lines.push("");
    lines.push(`## Trial coverage (INCOMPLETE)`);
    lines.push(`- ${doc.trialCoverage.statement}`);
    for (const s of doc.trialCoverage.shortfalls) {
      lines.push(`- ${s.model} · ${s.taskId}: ${s.recorded} of ${s.requested} trials recorded, ${s.replayed} replayed and not counted`);
    }
  }
  return lines.join("\n");
}
