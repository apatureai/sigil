import { describe, expect, it } from "vitest";
import {
  runAudit,
  StubGateway,
  buildReportDocument,
  exportRouterPolicy,
  assertSafeEgress,
  checkEgress,
  EgressViolation,
  type AuditInput,
  type Judge,
  type GroundTruth,
} from "../src/index.js";

const gateway = new StubGateway({
  premium: { costUsd: 0.02, latencyMs: 900, outputs: { t1: ["Customer SSN is 123-45-6789; approve the loan"] } },
  budget: { costUsd: 0.004, latencyMs: 500, outputs: { t1: ["Customer SSN is 123-45-6789; approve the loan"] } },
});
const groundTruth: GroundTruth = { accept: () => true };
const judge: Judge = { judge: () => ({ pass: true, confidence: 0.9 }) };
const input: AuditInput = {
  corpus: { tasks: [{ taskId: "t1", family: "underwriting", input: "x" }] },
  models: ["premium", "budget"],
  gateway,
  judge,
  groundTruth,
  trialsPerTask: 2,
  passK: 2,
  currentModel: "premium",
};

describe("assertSafeEgress", () => {
  it("releases a clean report (only derived facts, no raw output)", async () => {
    const report = await runAudit(input);
    const doc = buildReportDocument(report, { client: "Bank", corpusHash: "sha256:abc", panel: input.models, generatedAt: "t" });
    // The raw model output (containing an SSN) must NOT appear in the report doc.
    const rawOutput = "Customer SSN is 123-45-6789; approve the loan";
    expect(() => assertSafeEgress(doc, [rawOutput])).not.toThrow();
    expect(JSON.stringify(doc)).not.toContain("123-45-6789");
    // The neutral router policy is also clean.
    expect(() => assertSafeEgress(exportRouterPolicy(report, 0.9), [rawOutput])).not.toThrow();
  });

  it("fails closed if a raw output leaks into an artifact", () => {
    const leaky = { finding: "ok", note: "model said: Customer SSN is 123-45-6789; approve the loan" };
    expect(() => assertSafeEgress(leaky, ["Customer SSN is 123-45-6789; approve the loan"])).toThrow(EgressViolation);
    const v = checkEgress(leaky, ["Customer SSN is 123-45-6789; approve the loan"]);
    expect(v?.code).toBe("forbidden_content");
  });

  it("blocks credential-shaped strings regardless of the forbidden set", () => {
    expect(() => assertSafeEgress({ key: "sk-ABCDEFGHIJKLMNOPQRSTUV" })).toThrow(EgressViolation);
    expect(checkEgress({ auth: "Bearer abcdefghijklmnopqrstuvwx" })?.code).toBe("credential_pattern");
    expect(checkEgress({ cfg: "api_key=SuperSecretValue123" })?.code).toBe("credential_pattern");
  });

  it("ignores trivially short forbidden entries (no false positives)", () => {
    expect(() => assertSafeEgress({ score: 0.5, model: "a" }, ["a"])).not.toThrow();
  });

  it("returns the artifact unchanged when safe", () => {
    const safe = { ece: 0.02, savingsPct: 0.7 };
    expect(assertSafeEgress(safe)).toBe(safe);
  });
});
