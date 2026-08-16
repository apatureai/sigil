import { describe, expect, it } from "vitest";
import { JudgeEnsemble, runAudit, StubGateway, type Judge, type NamedJudge, type GroundTruth } from "../src/index.js";

const strict: Judge = { judge: (_t, o) => ({ pass: o === "good", confidence: 0.9 }) };
const lenient: Judge = { judge: (_t, o) => ({ pass: o !== "terrible", confidence: 0.8 }) };
const alwaysPass: Judge = { judge: () => ({ pass: true, confidence: 0.7 }) };

function panel(...judges: Judge[]): NamedJudge[] {
  return judges.map((judge, i) => ({ id: `j${i}`, judge }));
}

describe("JudgeEnsemble", () => {
  it("takes the majority verdict and the mean confidence", () => {
    const e = new JudgeEnsemble(panel(strict, lenient, alwaysPass));
    // "ok" -> strict fails, lenient passes, alwaysPass passes -> 2/3 pass -> pass.
    const v = e.judge("t", "ok");
    expect(v.pass).toBe(true);
    expect(v.confidence).toBeCloseTo((0.9 + 0.8 + 0.7) / 3);
  });

  it("resolves a tie conservatively to fail (never wave through on a split)", () => {
    const e = new JudgeEnsemble(panel(strict, alwaysPass)); // 2 judges
    const v = e.judge("t", "ok"); // strict fails, alwaysPass passes -> 1/2 -> tie -> fail
    expect(v.pass).toBe(false);
  });

  it("discloses inter-judge disagreement as a reliability signal", () => {
    const e = new JudgeEnsemble(panel(strict, lenient, alwaysPass));
    e.judge("t", "ok"); // 2 pass / 1 fail -> dissent 1/3
    e.judge("t", "good"); // all pass -> dissent 0
    const d = e.disagreement();
    expect(d.count).toBe(2);
    expect(d.mean).toBeCloseTo((1 / 3 + 0) / 2);
    expect(d.max).toBeCloseTo(1 / 3);
  });

  it("is deterministic (array order of the same named judges does not matter)", () => {
    const named: NamedJudge[] = [{ id: "strict", judge: strict }, { id: "lenient", judge: lenient }, { id: "pass", judge: alwaysPass }];
    const a = new JudgeEnsemble(named);
    const b = new JudgeEnsemble([...named].reverse());
    expect(a.judge("t", "ok")).toEqual(b.judge("t", "ok")); // both sort by id -> identical
  });

  it("rejects an empty panel", () => {
    expect(() => new JudgeEnsemble([])).toThrow();
  });

  it("drops into runAudit as an ordinary judge and exposes disagreement afterward", async () => {
    const gateway = new StubGateway({
      m: { costUsd: 0.01, latencyMs: 100, outputs: { t1: ["ok", "ok"], t2: ["good", "good"] } },
    });
    const groundTruth: GroundTruth = { accept: (_t, o) => o === "good" || o === "ok" };
    const ensemble = new JudgeEnsemble(panel(strict, lenient, alwaysPass));
    const report = await runAudit({
      corpus: { tasks: [{ taskId: "t1", family: "f", input: "x" }, { taskId: "t2", family: "f", input: "y" }] },
      models: ["m"], gateway, judge: ensemble, groundTruth, trialsPerTask: 2, passK: 2, currentModel: "m",
    });
    expect(report.judgeReliability.sampleSize).toBe(4); // 1 model x 2 tasks x 2 trials
    expect(ensemble.disagreement().count).toBe(4);
    expect(ensemble.disagreement().mean).toBeGreaterThan(0); // "ok" splits the panel
  });
});
