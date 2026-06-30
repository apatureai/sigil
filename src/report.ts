/**
 * Report generator (methodology #130, step 7) — the finance/security-signable
 * deliverable.
 *
 * Turns an `AuditReport` into a deterministic, structured document plus a
 * markdown render an MRM / CISO can act on. It restates only what the audit
 * measured (calibrated quality with disclosed judge reliability, run-to-run
 * variance, the efficiency frontier and the equal-quality saving) — it invents
 * nothing. Content-addressed so the artifact is reproducible.
 */

import { contentHash } from "./canonical.js";
import type { AuditReport } from "./harness.js";

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

export interface AuditReportDocument {
  meta: ReportMeta;
  judge: { ece: number; brier: number; sampleSize: number };
  findings: ReportFinding[];
  /** Lowest Pass^k observed per model — the run-to-run reliability exposure. */
  reliabilityExposure: Array<{ model: string; minPassHatK: number }>;
  documentHash: string;
}

function round(n: number, dp = 3): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function buildReportDocument(report: AuditReport, meta: ReportMeta): AuditReportDocument {
  const findings: ReportFinding[] = report.families.map((f) => ({
    family: f.family,
    recommendedFromTo: f.recommendation ? { from: f.recommendation.fromId, to: f.recommendation.toId } : null,
    savingsPct: round(f.recommendation?.savingsPct ?? 0),
    // Equal-or-better quality is the only saving we claim (#130 step 5).
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

  const body = {
    meta,
    judge: { ece: round(report.judgeReliability.ece), brier: round(report.judgeReliability.brier), sampleSize: report.judgeReliability.sampleSize },
    findings,
    reliabilityExposure,
  };
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
  return lines.join("\n");
}
