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
  premium: { costUsd: 0.02, latencyMs: 900, outputs: { t1: ["Customer SSN is 123-45-6789; approve the loan", "Customer SSN is 123-45-6789; approve the loan"] } },
  budget: { costUsd: 0.004, latencyMs: 500, outputs: { t1: ["Customer SSN is 123-45-6789; approve the loan", "Customer SSN is 123-45-6789; approve the loan"] } },
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

/**
 * The guard searched only `JSON.stringify(artifact)` but compared it against the
 * raw forbidden string. JSON escapes newlines, quotes, tabs, backslashes and
 * control characters, so a needle containing any of them could never match the
 * haystack: the guard passed exactly the outputs most worth blocking, since real
 * model outputs are almost always multi-line or quoted. Every fixture in the
 * suite above happened to be a single clean line, so nothing caught it.
 */
describe("assertSafeEgress across JSON-escaped characters", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["newline", "Applicant 4821 SSN 123-45-6789.\nApproved with covenants."],
    ["double quote", 'The memo says "approve" despite the covenant breach'],
    ["backslash", "Approve per policy C:\\risk\\credit\\memo for applicant 4821"],
    ["tab", "applicant\t4821\tapprove\tSSN 123-45-6789"],
    ["carriage return", "Approve applicant 4821.\r\nSSN 123-45-6789 on file."],
  ];

  for (const [label, raw] of cases) {
    it(`fails closed on a leaked output containing a ${label}`, () => {
      expect(() => assertSafeEgress({ note: raw }, [raw])).toThrow(EgressViolation);
      expect(checkEgress({ note: raw }, [raw])?.code).toBe("forbidden_content");
      // Nested in an array, and as an object key, are the same leak.
      expect(checkEgress({ findings: [{ detail: raw }] }, [raw])?.code).toBe("forbidden_content");
      expect(checkEgress({ [raw]: 1 }, [raw])?.code).toBe("forbidden_content");
    });
  }

  it("catches a credential split across an escaped character", () => {
    expect(checkEgress({ auth: "Bearer\nabcdefghijklmnopqrstuvwx" })?.code).toBe("credential_pattern");
  });

  it("still catches forbidden content that leaked as a non-string value", () => {
    // The raw-string walk alone cannot see this: the account number is a JSON
    // number, so it lives in no string leaf. Scanning the serialization too is
    // why the walk is an addition to that scan and not a replacement for it.
    expect(checkEgress({ accountNumber: 4821123456789 }, ["4821123456789"])?.code).toBe("forbidden_content");
    expect(checkEgress({ ids: [1, 4821123456789] }, ["4821123456789"])?.code).toBe("forbidden_content");
  });

  it("still releases an artifact that merely resembles the forbidden text", () => {
    const raw = "Applicant 4821 SSN 123-45-6789.\nApproved with covenants.";
    expect(() => assertSafeEgress({ note: "Applicant count: 1. Approved." }, [raw])).not.toThrow();
  });
});
