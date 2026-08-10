import { describe, expect, it } from "vitest";
import {
  buildReportDocument,
  renderMarkdown,
  exportRouterPolicy,
  certifyAbstentionThreshold,
  verifySwitchQuality,
  certifiedPassKLowerBound,
  type AuditReport,
  type ReportMeta,
  type JudgePrediction,
  type PairedOutcome,
} from "../src/index.js";

/**
 * Evidence wiring tests: the certificates and paired-evidence primitives now
 * flow into the shipped artifact (report document + markdown) and guard the
 * router policy. All blocks are ADDITIVE: the no-evidence document is
 * byte-identical to the pre-evidence format, so golden hashes are stable.
 */

const meta: ReportMeta = {
  client: "First Example Bank",
  corpusHash: "sha256:" + "a".repeat(64),
  panel: ["frontier-1", "mid-1", "budget-1"],
  generatedAt: "2026-07-02T00:00:00Z",
};

const auditReport: AuditReport = {
  judgeReliability: { ece: 0.07, brier: 0.12, sampleSize: 160, table: [] },
  families: [
    {
      family: "credit_memo",
      candidates: [
        { id: "frontier-1", quality: 0.92, costPerRunUsd: 0.4, latencyMs: 900 },
        { id: "mid-1", quality: 0.9, costPerRunUsd: 0.1, latencyMs: 700 },
        { id: "budget-1", quality: 0.7, costPerRunUsd: 0.02, latencyMs: 400 },
      ],
      frontier: [
        { id: "frontier-1", quality: 0.92, costPerRunUsd: 0.4, latencyMs: 900 },
        { id: "mid-1", quality: 0.9, costPerRunUsd: 0.1, latencyMs: 700 },
        { id: "budget-1", quality: 0.7, costPerRunUsd: 0.02, latencyMs: 400 },
      ],
      recommendation: { fromId: "frontier-1", toId: "mid-1", savingsPct: 0.75, latencyDeltaMs: -200, qualityDelta: -0.02 },
    },
  ],
  passK: [{ model: "mid-1", family: "credit_memo", n: 10, passes: 9, passRate: 0.9, passHatK: 0.867 }],
} as unknown as AuditReport;

const calibration: JudgePrediction[] = [
  ...Array.from({ length: 80 }, (_, i) => ({ confidence: 0.95, correct: i >= 1 })),
  ...Array.from({ length: 40 }, (_, i) => ({ confidence: 0.55, correct: i >= 14 })),
];

const pairsDefensible: PairedOutcome[] = [
  ...Array.from({ length: 4 }, () => ({ currentPassed: true, candidatePassed: false })),
  ...Array.from({ length: 3 }, () => ({ currentPassed: false, candidatePassed: true })),
  ...Array.from({ length: 40 }, () => ({ currentPassed: true, candidatePassed: true })),
];

const pairsNotDefensible: PairedOutcome[] = [
  ...Array.from({ length: 12 }, () => ({ currentPassed: true, candidatePassed: false })),
  ...Array.from({ length: 40 }, () => ({ currentPassed: true, candidatePassed: true })),
];

describe("report evidence blocks (additive)", () => {
  it("a document built without evidence is byte-identical to the legacy shape", () => {
    const plain = buildReportDocument(auditReport, meta);
    const explicit = buildReportDocument(auditReport, meta, {});
    expect(explicit).toEqual(plain);
    expect(plain.abstention).toBeUndefined();
    expect(plain.switchEvidence).toBeUndefined();
    expect(plain.certifiedReliability).toBeUndefined();
  });

  it("carries the abstention certificate, switch evidence, and certified floors", () => {
    const abstention = certifyAbstentionThreshold(calibration, { targetErrorRate: 0.1, delta: 0.05 });
    const switchEvidence = { credit_memo: verifySwitchQuality(pairsDefensible) };
    const cert = certifiedPassKLowerBound(Array.from({ length: 10 }, () => true), 3, 0.05);
    const doc = buildReportDocument(auditReport, meta, {
      abstention,
      switchEvidence,
      certifiedReliability: [{ model: "mid-1", family: "credit_memo", cert }],
    });

    expect(doc.abstention?.certified).toBe(true);
    expect(doc.abstention?.statement).toContain("abstained to human review");
    expect(doc.switchEvidence).toHaveLength(1);
    expect(doc.switchEvidence?.[0]?.defensible).toBe(true);
    expect(doc.certifiedReliability?.[0]?.passKLower).toBeGreaterThan(0);
    // Evidence changes the content hash (it is part of the signed body).
    expect(doc.documentHash).not.toBe(buildReportDocument(auditReport, meta).documentHash);
  });

  it("renders the evidence sections deterministically in markdown", () => {
    const doc = buildReportDocument(auditReport, meta, {
      abstention: certifyAbstentionThreshold(calibration, { targetErrorRate: 0.1, delta: 0.05 }),
      switchEvidence: { credit_memo: verifySwitchQuality(pairsNotDefensible) },
    });
    const md = renderMarkdown(doc);
    expect(md).toContain("## Certified abstention");
    expect(md).toContain("## Switch-claim evidence");
    expect(md).toContain("NOT defensible");
    expect(md).toBe(renderMarkdown(doc));
  });
});

describe("router policy evidence guard", () => {
  it("keeps cost-first ordering when the switch is defensible (default behavior)", () => {
    const policy = exportRouterPolicy(auditReport, 0.85, {
      switchEvidence: { credit_memo: verifySwitchQuality(pairsDefensible) },
    });
    expect(policy.routes[0]?.primary).toBe("mid-1"); // cheapest ≥ floor
    expect(policy.routes[0]?.note).toBeUndefined();
  });

  it("switches to quality-first and annotates when evidence refuses the switch", () => {
    const policy = exportRouterPolicy(auditReport, 0.85, {
      switchEvidence: { credit_memo: verifySwitchQuality(pairsNotDefensible) },
    });
    expect(policy.routes[0]?.primary).toBe("frontier-1"); // highest quality ≥ floor
    expect(policy.routes[0]?.fallbacks).toContain("mid-1");
    expect(policy.routes[0]?.note).toContain("not defensible");
  });

  it("families without evidence are untouched and unannotated", () => {
    const policy = exportRouterPolicy(auditReport, 0.85, { switchEvidence: {} });
    expect(policy).toEqual(exportRouterPolicy(auditReport, 0.85));
  });
});
