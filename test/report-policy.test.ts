import { describe, expect, it } from "vitest";
import {
  runAudit,
  StubGateway,
  buildReportDocument,
  renderMarkdown,
  exportRouterPolicy,
  mapGovernance,
  type AuditInput,
  type Judge,
  type GroundTruth,
} from "../src/index.js";

const gateway = new StubGateway({
  premium: { costUsd: 0.02, latencyMs: 900, outputs: { t1: ["good"], t2: ["good"] } },
  budget: { costUsd: 0.004, latencyMs: 500, outputs: { t1: ["good"], t2: ["good"] } },
  flaky: { costUsd: 0.004, latencyMs: 500, outputs: { t1: ["good", "bad", "good", "bad"], t2: ["good"] } },
});
const groundTruth: GroundTruth = { accept: (_t, o) => o === "good" };
const judge: Judge = { judge: (_t, o) => ({ pass: o === "good", confidence: 0.9 }) };
const input: AuditInput = {
  corpus: { tasks: [{ taskId: "t1", family: "support", input: "x" }, { taskId: "t2", family: "support", input: "y" }] },
  models: ["premium", "budget", "flaky"],
  gateway,
  judge,
  groundTruth,
  trialsPerTask: 4,
  passK: 2,
  currentModel: "premium",
};

describe("report document", () => {
  it("restates the equal-quality saving and discloses the judge's reliability", async () => {
    const report = await runAudit(input);
    const doc = buildReportDocument(report, { client: "Acme Bank", corpusHash: "sha256:abc", panel: input.models, generatedAt: "2026-06-30T00:00:00.000Z" });
    const support = doc.findings.find((f) => f.family === "support");
    expect(support?.recommendedFromTo).toEqual({ from: "premium", to: "budget" });
    expect(support?.qualityHeld).toBe(true);
    expect(doc.judge.sampleSize).toBe(24);
    expect(doc.documentHash).toMatch(/^sha256:/);
  });

  it("surfaces the flaky model's run-to-run reliability exposure", async () => {
    const report = await runAudit(input);
    const doc = buildReportDocument(report, { client: "Acme", corpusHash: "sha256:abc", panel: input.models, generatedAt: "t" });
    const flaky = doc.reliabilityExposure.find((r) => r.model === "flaky");
    expect(flaky?.minPassHatK).toBeLessThan(1);
  });

  it("renders deterministic markdown the same way twice", async () => {
    const report = await runAudit(input);
    const doc = buildReportDocument(report, { client: "Acme", corpusHash: "sha256:abc", panel: input.models, generatedAt: "t" });
    expect(renderMarkdown(doc)).toBe(renderMarkdown(doc));
    expect(renderMarkdown(doc)).toContain("Independent AI Quality & Efficiency Assurance");
  });
});

describe("neutral router policy", () => {
  it("routes each family to the cheapest frontier model at the quality floor, with fallbacks", async () => {
    const report = await runAudit(input);
    const policy = exportRouterPolicy(report, 0.9);
    expect(policy.policyVersion).toBe("neutral-route/1");
    const route = policy.routes.find((r) => r.family === "support");
    expect(route?.primary).toBe("budget"); // cheapest at >=0.9 quality
    expect(route?.fallbacks).not.toContain("budget");
  });

  it("never drops a family even if nothing clears the floor", async () => {
    const report = await runAudit(input);
    const policy = exportRouterPolicy(report, 1.01); // impossible floor
    expect(policy.routes.every((r) => r.primary.length > 0)).toBe(true);
  });
});

describe("governance overlay", () => {
  it("flags excess scope as a least-privilege gap and missing scope as info", () => {
    const findings = mapGovernance(
      [{ agentId: "a1", grantedScopes: ["read:tickets", "write:refunds"], tasks: ["support"] }],
      [{ family: "support", requiredScopes: ["read:tickets"] }],
    );
    expect(findings.find((f) => f.code === "excess_scope")?.scopes).toEqual(["write:refunds"]);
  });

  it("flags an untracked task family", () => {
    const findings = mapGovernance([{ agentId: "a1", grantedScopes: [], tasks: ["mystery"] }], []);
    expect(findings.some((f) => f.code === "untracked_task")).toBe(true);
  });
});
