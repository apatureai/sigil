import { describe, expect, it } from "vitest";
import {
  buildReportDocument,
  ed25519Signer,
  ed25519Verifier,
  loadBundle,
  renderMarkdown,
  runAudit,
  runBundleAudit,
  signReportBundle,
  StubGateway,
  verifyReportBundle,
  writeArtifacts,
  type AuditBundle,
  type AuditInput,
  type GroundTruth,
  type Judge,
} from "../src/index.js";
import { generateKeyPairSync } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * `trialsPerTask` greater than the number of recorded trials used to replay the
 * last captured output and count each replay as a fresh sample. On the shipped
 * `examples/credit-memo` bundle at `trialsPerTask: 8` that produced
 * `sample: 24` from 12 judgements and lifted Pass^3 from 0.25 to 0.625, with
 * exit 0, no warning, and a content-addressed document that could be signed.
 *
 * A replay carries no run-to-run information at all: it is the same recorded
 * string handed back again, so Pass^k reads agreement between copies of one
 * output as consistency across runs. For a tool whose product is calibrated
 * confidence, that is the worst possible failure, so the fix is two-sided. The
 * harness never counts a replay, and the CLI, whose output is the signable
 * artifact, refuses the bundle outright.
 */

const GOOD = "good";
const BAD = "bad";

const groundTruth: GroundTruth = { accept: (_t, o) => o === GOOD };
const judge: Judge = { judge: (_t, o) => ({ pass: o === GOOD, confidence: 0.9 }) };

/** One model, one task, two recorded trials: one pass and one fail. */
function auditOver(trialsPerTask: number, passK = 1): AuditInput {
  return {
    corpus: { tasks: [{ taskId: "t1", family: "f", input: "x" }] },
    models: ["m"],
    gateway: new StubGateway({ m: { costUsd: 0.01, latencyMs: 100, outputs: { t1: [GOOD, BAD] } } }),
    judge,
    groundTruth,
    trialsPerTask,
    passK,
    currentModel: "m",
  };
}

describe("a replayed trial is not evidence", () => {
  it("does not grow the judge's sample when more trials are asked for than exist", async () => {
    const recorded = await runAudit(auditOver(2));
    const overAsked = await runAudit(auditOver(6));

    expect(recorded.judgeReliability.sampleSize).toBe(2);
    // The regression: this was 6, from the same two judgements.
    expect(overAsked.judgeReliability.sampleSize).toBe(2);
    expect(overAsked.judgeReliability.ece).toBe(recorded.judgeReliability.ece);
    expect(overAsked.judgeReliability.brier).toBe(recorded.judgeReliability.brier);
  });

  it("does not lift Pass^k by replaying the last recorded output", async () => {
    const recorded = await runAudit(auditOver(2, 2));
    const overAsked = await runAudit(auditOver(6, 2));

    const row = (r: Awaited<ReturnType<typeof runAudit>>) => r.passK.find((p) => p.model === "m");
    // 1 of 2 recorded runs passed, so Pass^2 is 0 however many times the last
    // output is repeated. Replaying BAD four more times used to change n.
    expect(row(recorded)?.n).toBe(2);
    expect(row(overAsked)?.n).toBe(2);
    expect(row(overAsked)?.passHatK).toBe(row(recorded)?.passHatK);
  });

  it("says exactly what was replayed instead of absorbing it", async () => {
    const report = await runAudit(auditOver(6));
    expect(report.trialCoverage.complete).toBe(false);
    expect(report.trialCoverage.requestedTrialsPerTask).toBe(6);
    expect(report.trialCoverage.realTrials).toBe(2);
    expect(report.trialCoverage.replayedTrials).toBe(4);
    expect(report.trialCoverage.shortfalls).toEqual([
      { model: "m", taskId: "t1", requested: 6, recorded: 2, replayed: 4 },
    ]);
  });

  it("reports complete coverage, and no shortfalls, when the capture is sufficient", async () => {
    const report = await runAudit(auditOver(2));
    expect(report.trialCoverage).toEqual({
      requestedTrialsPerTask: 2,
      complete: true,
      realTrials: 2,
      replayedTrials: 0,
      shortfalls: [],
    });
  });

  it("flags the replay on the gateway response itself, not only in the aggregate", async () => {
    const gateway = new StubGateway({ m: { costUsd: 0.01, latencyMs: 100, outputs: { t1: [GOOD, BAD] } } });
    const real = await gateway.run({ model: "m", taskId: "t1", trial: 1, input: "x" });
    const repeat = await gateway.run({ model: "m", taskId: "t1", trial: 2, input: "x" });

    expect(real.replayed).toBeUndefined();
    expect(repeat.replayed).toBe(true);
    expect(repeat.output).toBe(real.output); // same bytes, which is the whole problem
  });
});

describe("a signed artifact never carries an inflated sample", () => {
  const meta = { client: "Acme", corpusHash: "sha256:abc", panel: ["m"], generatedAt: "t" };

  it("carries the shortfall in the document and the markdown", async () => {
    const doc = buildReportDocument(await runAudit(auditOver(6)), meta);

    expect(doc.judge.sampleSize).toBe(2);
    expect(doc.trialCoverage?.requestedTrialsPerTask).toBe(6);
    expect(doc.trialCoverage?.realTrials).toBe(2);
    expect(doc.trialCoverage?.replayedTrials).toBe(4);
    expect(doc.trialCoverage?.statement).toContain("Configuration asked for 6 trials per task");
    expect(doc.trialCoverage?.statement).toContain("excluded rather than counted as evidence");

    const md = renderMarkdown(doc);
    expect(md).toContain("sample: 2");
    expect(md).toContain("INCOMPLETE EVIDENCE");
    expect(md).toContain("## Trial coverage (INCOMPLETE)");
    expect(md).toContain("m · t1: 2 of 6 trials recorded, 4 replayed and not counted");
  });

  it("survives signing and offline verification with the shortfall attached", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = ed25519Signer(privateKey.export({ type: "pkcs8", format: "pem" }).toString(), "k1");
    const verifier = ed25519Verifier({ k1: publicKey.export({ type: "spki", format: "pem" }).toString() });

    const bundle = signReportBundle(buildReportDocument(await runAudit(auditOver(6)), meta), signer);
    expect(verifyReportBundle(bundle, verifier)).toEqual({ ok: true, keyId: "k1" });
    // A counterparty holding only the signed bundle can still see the shortfall.
    expect(bundle.document.judge.sampleSize).toBe(2);
    expect(bundle.document.trialCoverage?.replayedTrials).toBe(4);
    expect(bundle.markdown).toContain("## Trial coverage (INCOMPLETE)");
  });

  it("leaves a complete audit's document, and its hash, byte-identical", async () => {
    const complete = buildReportDocument(await runAudit(auditOver(2)), meta);
    expect(complete.trialCoverage).toBeUndefined();
    expect(renderMarkdown(complete)).not.toContain("Trial coverage");
    // The block is additive: absence is the claim that every requested trial was
    // a distinct recorded one, so pre-existing hashes are unaffected.
    expect(complete.documentHash).toBe(buildReportDocument(await runAudit(auditOver(2)), meta).documentHash);
  });
});

describe("the CLI refuses a bundle that asks for trials it does not hold", () => {
  const RAW_GOOD = "Adequate coverage; approval reasonable with covenants.";
  const RAW_BAD = "idk approve";

  function bundle(trialsPerTask: number): AuditBundle {
    return {
      config: {
        client: "Example Bank",
        models: ["frontier", "budget"],
        trialsPerTask,
        passK: 2,
        currentModel: "frontier",
        qualityFloor: 0.9,
        generatedAt: "2026-06-30T00:00:00.000Z",
      },
      corpus: {
        rubric: { id: "fs", version: "1", criteria: ["accurate"] },
        tasks: [
          {
            taskId: "memo-1",
            family: "credit_memo",
            input: "Summarize creditworthiness for applicant 4821",
            labels: [{ output: RAW_GOOD, accept: true }, { output: RAW_BAD, accept: false }],
          },
        ],
      },
      panel: {
        frontier: { costUsd: 0.03, latencyMs: 1400, outputs: { "memo-1": [RAW_GOOD, RAW_GOOD] } },
        budget: { costUsd: 0.003, latencyMs: 400, outputs: { "memo-1": [RAW_GOOD, RAW_BAD] } },
      },
      judgeVerdicts: {
        [RAW_GOOD]: { pass: true, confidence: 0.9 },
        [RAW_BAD]: { pass: false, confidence: 0.9 },
      },
    };
  }

  it("throws, naming the shortfall and the value that would be honest", async () => {
    await expect(runBundleAudit(bundle(4))).rejects.toThrow(
      /bundle asks for trialsPerTask 4 but the captured panel holds fewer/,
    );
    await expect(runBundleAudit(bundle(4))).rejects.toThrow(/frontier\/memo-1 has 2/);
    await expect(runBundleAudit(bundle(4))).rejects.toThrow(/Set trialsPerTask to 2/);
  });

  it("still produces a report when the bundle asks only for what it holds", async () => {
    const artifacts = await runBundleAudit(bundle(2));
    expect(artifacts.report.judge.sampleSize).toBe(4); // 2 models x 1 task x 2 trials
    expect(artifacts.report.trialCoverage).toBeUndefined();
  });

  it("writes nothing on refusal, so no partial report can be picked up", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigil-refuse-"));
    try {
      const b = bundle(4);
      fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(b.config));
      fs.writeFileSync(path.join(dir, "corpus.json"), JSON.stringify(b.corpus));
      fs.writeFileSync(path.join(dir, "panel.json"), JSON.stringify(b.panel));
      fs.writeFileSync(path.join(dir, "judge.json"), JSON.stringify(b.judgeVerdicts));

      const out = path.join(dir, "out");
      let refused = false;
      try {
        writeArtifacts(out, await runBundleAudit(loadBundle(dir)));
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
      expect(fs.existsSync(out)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
