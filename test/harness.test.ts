import { describe, expect, it } from "vitest";
import { runAudit, StubGateway, type AuditInput, type Judge, type GroundTruth } from "../src/index.js";

/**
 * Two models over one task family. `premium` is correct but expensive and slow;
 * `budget` is just as correct here but cheaper and faster (so it should win the
 * frontier and the savings recommendation). `flaky` passes only some runs (to
 * exercise Pass^k). The judge is well-calibrated against the ground truth.
 */
const gateway = new StubGateway({
  premium: { costUsd: 0.02, latencyMs: 900, outputs: { t1: ["good", "good", "good", "good"], t2: ["good", "good", "good", "good"] } },
  budget: { costUsd: 0.004, latencyMs: 500, outputs: { t1: ["good", "good", "good", "good"], t2: ["good", "good", "good", "good"] } },
  flaky: { costUsd: 0.004, latencyMs: 500, outputs: { t1: ["good", "bad", "good", "bad"], t2: ["good", "good", "bad", "bad"] } },
});

const groundTruth: GroundTruth = { accept: (_taskId, output) => output === "good" };
// The judge agrees with ground truth and is confident.
const judge: Judge = { judge: (_taskId, output) => ({ pass: output === "good", confidence: 0.9 }) };

const base: AuditInput = {
  corpus: { tasks: [{ taskId: "t1", family: "support", input: "x" }, { taskId: "t2", family: "support", input: "y" }] },
  models: ["premium", "budget", "flaky"],
  gateway,
  judge,
  groundTruth,
  trialsPerTask: 4,
  passK: 2,
  currentModel: "premium",
};

describe("runAudit", () => {
  it("recommends switching from premium to the cheaper, equal-quality model", async () => {
    const report = await runAudit(base);
    const family = report.families.find((f) => f.family === "support");
    expect(family?.recommendation?.fromId).toBe("premium");
    expect(family?.recommendation?.toId).toBe("budget");
    expect(family?.recommendation?.savingsPct).toBeGreaterThan(0.5);
  });

  it("puts the budget model on the frontier and drops the dominated premium", async () => {
    const report = await runAudit(base);
    const family = report.families.find((f) => f.family === "support");
    const frontierIds = family?.frontier.map((c) => c.id) ?? [];
    expect(frontierIds).toContain("budget");
    expect(frontierIds).not.toContain("premium"); // dominated by budget at equal quality
  });

  it("reports the judge's own calibration (it is well-calibrated here)", async () => {
    const report = await runAudit(base);
    expect(report.judgeReliability.sampleSize).toBe(24); // 3 models x 2 tasks x 4 trials
    expect(report.judgeReliability.ece).toBeLessThan(0.2);
  });

  it("computes Pass^k that exposes the flaky model's run-to-run variance", async () => {
    const report = await runAudit(base);
    const flakyT1 = report.passK.find((r) => r.model === "flaky" && r.taskId === "t1");
    const budgetT1 = report.passK.find((r) => r.model === "budget" && r.taskId === "t1");
    expect(budgetT1?.passHatK).toBeCloseTo(1); // always good
    expect(flakyT1?.passHatK).toBeLessThan(1); // 2/4 good -> Pass^2 = 1/6
  });

  it("is deterministic for identical input", async () => {
    expect(await runAudit(base)).toEqual(await runAudit(base));
  });
});
