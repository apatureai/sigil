import { describe, expect, it } from "vitest";
import {
  buildReportDocument,
  renderMarkdown,
  runAudit,
  runBundleAudit,
  StubGateway,
  type AuditBundle,
  type AuditInput,
  type GroundTruth,
  type Judge,
} from "../src/index.js";

/**
 * Pass^k needs at least k observed runs. A (model, task) holding fewer used to
 * be skipped in silence: no row in `reliabilityExposure`, no note anywhere. On
 * the shipped `examples/credit-memo` bundle, raising `passK` from 3 to 8 left
 * the whole "Run-to-run reliability exposure (Pass^k)" section empty at exit 0.
 * The budget model's worst-case Pass^3 of 0.25, the one number in that report
 * that rejects a 10x-cheaper model, simply vanished, and a heading with no rows
 * under it reads as "nothing to flag".
 *
 * Missing evidence is not a passing result. The harness now records every
 * unmeasured pair, the report document carries them (and only then), the
 * markdown says NOT MEASURED, and the CLI, whose output is the signable
 * artifact, refuses the bundle outright.
 */

const GOOD = "good";
const BAD = "bad";

const groundTruth: GroundTruth = { accept: (_t, o) => o === GOOD };
const judge: Judge = { judge: (_t, o) => ({ pass: o === GOOD, confidence: 0.9 }) };

/** One model, one task, four recorded trials, three of them passing. */
function auditAskingFor(passK: number): AuditInput {
  return {
    corpus: { tasks: [{ taskId: "t1", family: "f", input: "x" }] },
    models: ["m"],
    gateway: new StubGateway({ m: { costUsd: 0.01, latencyMs: 100, outputs: { t1: [GOOD, GOOD, BAD, GOOD] } } }),
    judge,
    groundTruth,
    trialsPerTask: 4,
    passK,
    currentModel: "m",
  };
}

function bundleAskingFor(passK: number): AuditBundle {
  return {
    config: {
      client: "C",
      models: ["m"],
      trialsPerTask: 4,
      passK,
      currentModel: "m",
      qualityFloor: 0.5,
      generatedAt: "2026-06-30T00:00:00.000Z",
    },
    corpus: {
      rubric: { id: "r", version: "1", criteria: ["c"] },
      tasks: [{ taskId: "t1", family: "f", input: "x", labels: [{ output: GOOD, accept: true }, { output: BAD, accept: false }] }],
    },
    panel: { m: { costUsd: 0.01, latencyMs: 100, outputs: { t1: [GOOD, GOOD, BAD, GOOD] } } },
    judgeVerdicts: { [GOOD]: { pass: true, confidence: 0.9 }, [BAD]: { pass: false, confidence: 0.9 } },
  };
}

describe("Pass^k over fewer than k runs is not a measurement", () => {
  it("names the pair it could not measure instead of dropping it", async () => {
    const report = await runAudit(auditAskingFor(8));

    expect(report.passK).toEqual([]);
    expect(report.passKCoverage.k).toBe(8);
    expect(report.passKCoverage.measured).toBe(0);
    expect(report.passKCoverage.unmeasured).toEqual([{ model: "m", taskId: "t1", k: 8, trials: 4 }]);
  });

  it("reports full coverage when every pair holds k runs", async () => {
    const report = await runAudit(auditAskingFor(3));

    expect(report.passK).toHaveLength(1);
    expect(report.passKCoverage.measured).toBe(1);
    expect(report.passKCoverage.unmeasured).toEqual([]);
  });

  it("carries the gap into the document and says NOT MEASURED in the markdown", async () => {
    const report = await runAudit(auditAskingFor(8));
    const doc = buildReportDocument(report, { client: "C", corpusHash: "sha256:abc", panel: ["m"], generatedAt: "t" });

    expect(doc.reliabilityExposure).toEqual([]);
    expect(doc.passKCoverage?.k).toBe(8);
    expect(doc.passKCoverage?.measured).toBe(0);
    expect(doc.passKCoverage?.unmeasured).toEqual([{ model: "m", taskId: "t1", trials: 4 }]);

    const md = renderMarkdown(doc);
    // The section must not be a bare heading a reader can take as "all clear".
    const section = md.slice(md.indexOf("## Run-to-run reliability exposure"));
    expect(section).toContain("NOT MEASURED");
    expect(section).toContain("m · t1: 4 recorded runs, fewer than k=8");
    expect(section).toContain("Pass^k not computed");
  });

  it("leaves a fully measured document byte-identical (no block, same hash)", async () => {
    const report = await runAudit(auditAskingFor(3));
    const doc = buildReportDocument(report, { client: "C", corpusHash: "sha256:abc", panel: ["m"], generatedAt: "t" });

    expect(doc.passKCoverage).toBeUndefined();
    expect(renderMarkdown(doc)).not.toContain("NOT MEASURED");

    const { passKCoverage: _dropped, ...withoutCoverage } = report;
    const before = buildReportDocument(withoutCoverage as typeof report, {
      client: "C",
      corpusHash: "sha256:abc",
      panel: ["m"],
      generatedAt: "t",
    });
    expect(doc.documentHash).toBe(before.documentHash);
  });

  it("refuses the bundle through the CLI and writes nothing", async () => {
    await expect(runBundleAudit(bundleAskingFor(8))).rejects.toThrow(
      /bundle asks for Pass\^8 .* m\/t1 has 4.* Set passK to at most 4/s,
    );
  });

  it("accepts the same bundle once passK fits the capture", async () => {
    const artifacts = await runBundleAudit(bundleAskingFor(4));

    expect(artifacts.report.reliabilityExposure).toEqual([{ model: "m", minPassHatK: 0 }]);
    expect(artifacts.report.passKCoverage).toBeUndefined();
  });
});
