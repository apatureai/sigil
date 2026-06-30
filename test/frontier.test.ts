import { describe, expect, it } from "vitest";
import { paretoFrontier, recommendSwitch, type Candidate } from "../src/index.js";

const A: Candidate = { id: "a", quality: 0.9, costPerRunUsd: 0.02, latencyMs: 800 };
const B: Candidate = { id: "b", quality: 0.9, costPerRunUsd: 0.005, latencyMs: 600 }; // dominates A
const C: Candidate = { id: "c", quality: 0.95, costPerRunUsd: 0.05, latencyMs: 1200 }; // higher quality, pricier

describe("paretoFrontier", () => {
  it("excludes dominated candidates and keeps trade-offs", () => {
    const frontier = paretoFrontier([A, B, C]).map((c) => c.id);
    expect(frontier).toContain("b"); // cheapest at 0.9 quality
    expect(frontier).toContain("c"); // only one reaching 0.95
    expect(frontier).not.toContain("a"); // dominated by b
  });
});

describe("recommendSwitch", () => {
  it("recommends the cheapest model at equal-or-better quality and quantifies the saving", () => {
    const rec = recommendSwitch(A, [A, B, C]);
    expect(rec?.toId).toBe("b");
    expect(rec?.savingsPct).toBeCloseTo((0.02 - 0.005) / 0.02); // 75%
    expect(rec?.latencyDeltaMs).toBe(-200);
    expect(rec?.qualityDelta).toBe(0);
  });

  it("returns null when nothing is cheaper at held quality", () => {
    expect(recommendSwitch(B, [B, C])).toBeNull(); // c is pricier; nothing cheaper >= b quality
  });
});
