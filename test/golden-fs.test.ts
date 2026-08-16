import { describe, expect, it } from "vitest";
import {
  freezeCorpus,
  panelCorpus,
  groundTruthFrom,
  runAudit,
  buildReportDocument,
  exportRouterPolicy,
  mapGovernance,
  assertSafeEgress,
  StubGateway,
  type CorpusSpec,
  type Judge,
} from "../src/index.js";

/**
 * Golden, financial-services-shaped end-to-end audit. Two task families
 * (credit-memo summarization, SAR/fraud-narrative drafting), a three-model
 * panel, human labels, a calibrated judge, run all the way through to the
 * exported, egress-checked deliverable. This is the deterministic regression
 * that proves the whole pipeline (TRD §7) and doubles as the demo.
 */

const RAW_FRONTIER = "Applicant has strong DSCR and clean history; recommend approval. [internal note: SSN 123-45-6789]";
const RAW_MID = "Applicant shows adequate coverage; approval reasonable with covenants.";
const RAW_BUDGET_GOOD = "Approve; borrower meets policy thresholds.";
const RAW_BUDGET_BAD = "idk approve i guess";

const corpusSpec: CorpusSpec = {
  rubric: { id: "fs-credit-qa", version: "1", criteria: ["accurate", "policy-compliant", "no PII leakage"] },
  tasks: [
    {
      taskId: "memo-1",
      family: "credit_memo",
      input: "Summarize creditworthiness for applicant 4821",
      labels: [
        { output: RAW_FRONTIER, accept: false }, // leaks PII -> not acceptable
        { output: RAW_MID, accept: true },
        { output: RAW_BUDGET_GOOD, accept: true },
        { output: RAW_BUDGET_BAD, accept: false },
      ],
    },
    {
      taskId: "sar-1",
      family: "fraud_narrative",
      input: "Draft a SAR narrative for alert 9931",
      labels: [
        { output: RAW_MID, accept: true },
        { output: RAW_BUDGET_GOOD, accept: true },
        { output: RAW_BUDGET_BAD, accept: false },
      ],
    },
  ],
};

const gateway = new StubGateway({
  frontier: { costUsd: 0.03, latencyMs: 1400, outputs: { "memo-1": [RAW_MID, RAW_MID, RAW_MID, RAW_MID], "sar-1": [RAW_MID, RAW_MID, RAW_MID, RAW_MID] } },
  mid: { costUsd: 0.008, latencyMs: 700, outputs: { "memo-1": [RAW_MID, RAW_MID, RAW_MID, RAW_MID], "sar-1": [RAW_MID, RAW_MID, RAW_MID, RAW_MID] } },
  budget: { costUsd: 0.002, latencyMs: 400, outputs: { "memo-1": [RAW_BUDGET_BAD, RAW_BUDGET_BAD, RAW_BUDGET_BAD, RAW_BUDGET_BAD], "sar-1": [RAW_BUDGET_GOOD, RAW_BUDGET_BAD, RAW_BUDGET_GOOD, RAW_BUDGET_BAD] } },
});

// A well-calibrated judge: pass iff the output is a labeled-acceptable one.
const acceptable = new Set([RAW_MID, RAW_BUDGET_GOOD]);
const judge: Judge = { judge: (_t, o) => ({ pass: acceptable.has(o), confidence: 0.9 }) };

async function runGolden() {
  const corpus = freezeCorpus(corpusSpec);
  const report = await runAudit({
    corpus: panelCorpus(corpus),
    models: ["frontier", "mid", "budget"],
    gateway,
    judge,
    groundTruth: groundTruthFrom(corpus),
    trialsPerTask: 4,
    passK: 2,
    currentModel: "frontier",
    });
  return { corpus, report };
}

describe("golden FS end-to-end audit", () => {
  it("freezes a content-addressed corpus", async () => {
    const { corpus } = await runGolden();
    expect(corpus.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("recommends switching frontier -> mid at equal-or-better quality on credit memos", async () => {
    const { report } = await runGolden();
    const memo = report.families.find((f) => f.family === "credit_memo");
    expect(memo?.recommendation?.fromId).toBe("frontier");
    expect(memo?.recommendation?.toId).toBe("mid"); // budget fails quality on memo; mid holds it cheaper
    expect(memo?.recommendation?.savingsPct).toBeGreaterThan(0.5);
  });

  it("exposes the budget model's run-to-run unreliability on SAR narratives (Pass^k)", async () => {
    const { report } = await runGolden();
    const budgetSar = report.passK.find((r) => r.model === "budget" && r.taskId === "sar-1");
    expect(budgetSar?.passHatK).toBeLessThan(1);
  });

  it("produces a signable, egress-clean report + neutral policy (no raw outputs/PII leave)", async () => {
    const { corpus, report } = await runGolden();
    const doc = buildReportDocument(report, { client: "Example Bank, N.A.", corpusHash: corpus.contentHash, panel: ["frontier", "mid", "budget"], generatedAt: "2026-06-30T00:00:00.000Z" });
    const policy = exportRouterPolicy(report, 0.9);
    const governance = mapGovernance(
      [{ agentId: "credit-bot", grantedScopes: ["read:applications", "write:decisions", "read:ssn"], tasks: ["credit_memo"] }],
      [{ family: "credit_memo", requiredScopes: ["read:applications"] }],
    );

    const forbidden = [RAW_FRONTIER, RAW_MID, RAW_BUDGET_GOOD, RAW_BUDGET_BAD];
    // Every exported artifact passes the egress guard (no raw output / PII / keys).
    expect(() => assertSafeEgress(doc, forbidden)).not.toThrow();
    expect(() => assertSafeEgress(policy, forbidden)).not.toThrow();
    expect(() => assertSafeEgress(governance, forbidden)).not.toThrow();
    // The PII that appeared in a raw model output never reaches the artifact.
    expect(JSON.stringify(doc)).not.toContain("123-45-6789");
    // Governance flags the excess 'read:ssn' / 'write:decisions' scopes.
    expect(governance.find((g) => g.code === "excess_scope")?.scopes).toContain("read:ssn");
  });

  it("is fully deterministic end-to-end", async () => {
    const a = await runGolden();
    const b = await runGolden();
    const docA = buildReportDocument(a.report, { client: "X", corpusHash: a.corpus.contentHash, panel: ["frontier", "mid", "budget"], generatedAt: "t" });
    const docB = buildReportDocument(b.report, { client: "X", corpusHash: b.corpus.contentHash, panel: ["frontier", "mid", "budget"], generatedAt: "t" });
    expect(docA).toEqual(docB);
    expect(docA.documentHash).toBe(docB.documentHash);
  });
});
