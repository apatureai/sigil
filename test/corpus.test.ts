import { describe, expect, it } from "vitest";
import { freezeCorpus, panelCorpus, groundTruthFrom, contentHash, type CorpusSpec } from "../src/index.js";

const spec: CorpusSpec = {
  rubric: { id: "support-qa", version: "1", criteria: ["accurate", "on-policy"] },
  tasks: [
    { taskId: "t1", family: "support", input: "x", labels: [{ output: "good", accept: true }, { output: "bad", accept: false }] },
    { taskId: "t2", family: "support", input: "y", labels: [{ output: "good", accept: true }] },
  ],
};

describe("freezeCorpus", () => {
  it("content-addresses the corpus and is order-independent", () => {
    const a = freezeCorpus(spec);
    const reordered: CorpusSpec = { rubric: spec.rubric, tasks: [spec.tasks[1]!, spec.tasks[0]!] };
    expect(a.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(freezeCorpus(reordered).contentHash).toBe(a.contentHash); // task order does not change identity
  });
  it("changes the hash when the rubric or labels change", () => {
    const base = freezeCorpus(spec).contentHash;
    const changed = freezeCorpus({ ...spec, rubric: { ...spec.rubric, version: "2" } }).contentHash;
    expect(changed).not.toBe(base);
  });
  it("rejects a corpus with no tasks or an unlabeled task", () => {
    expect(() => freezeCorpus({ rubric: spec.rubric, tasks: [] })).toThrow();
    expect(() => freezeCorpus({ rubric: spec.rubric, tasks: [{ taskId: "t", family: "f", input: "i", labels: [] }] })).toThrow();
  });
});

describe("groundTruthFrom + panelCorpus", () => {
  it("derives ground truth from human labels; unlabeled outputs are not accepted", () => {
    const gt = groundTruthFrom(spec);
    expect(gt.accept("t1", "good")).toBe(true);
    expect(gt.accept("t1", "bad")).toBe(false);
    expect(gt.accept("t1", "never-seen")).toBe(false);
  });
  it("panelCorpus strips labels, leaving only the runnable tasks", () => {
    const pc = panelCorpus(spec);
    expect(pc.tasks).toHaveLength(2);
    expect(pc.tasks[0]).not.toHaveProperty("labels");
  });
});

describe("contentHash", () => {
  it("is stable and key-order independent", () => {
    expect(contentHash({ a: 1, b: 2 })).toBe(contentHash({ b: 2, a: 1 }));
  });
});
