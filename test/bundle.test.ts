import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildReportDocument,
  signReportBundle,
  verifyReportBundle,
  ed25519Signer,
  ed25519Verifier,
  type AuditReport,
  type ReportMeta,
} from "../src/index.js";

/**
 * Signed report bundle tests (#17). Keys are generated in-process for the test
 * only; the harness itself holds no key (BundleSigner/Verifier are injected
 * ports). Verification is offline and fail-closed: every tamper class is a
 * named reason.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

const signer = ed25519Signer(privatePem, "audit-key-1");
const verifier = ed25519Verifier({ "audit-key-1": publicPem });

const meta: ReportMeta = {
  client: "First Example Bank",
  corpusHash: "sha256:" + "b".repeat(64),
  panel: ["frontier-1", "mid-1"],
  generatedAt: "2026-07-02T00:00:00Z",
};

const auditReport: AuditReport = {
  judgeReliability: { ece: 0.06, brier: 0.11, sampleSize: 120, table: [] },
  families: [],
  passK: [],
} as unknown as AuditReport;

const document = () => buildReportDocument(auditReport, meta);

describe("signReportBundle / verifyReportBundle (#17)", () => {
  it("round-trips: a signed bundle verifies offline", () => {
    const bundle = signReportBundle(document(), signer);
    expect(bundle.bundleVersion).toBe("signed-bundle/1");
    expect(bundle.keyId).toBe("audit-key-1");
    expect(verifyReportBundle(bundle, verifier)).toEqual({ ok: true, keyId: "audit-key-1" });
  });

  it("Ed25519 signing is deterministic (byte-stable artifacts)", () => {
    const a = signReportBundle(document(), signer);
    const b = signReportBundle(document(), signer);
    expect(a).toEqual(b);
  });

  it("a tampered document body fails with a named document-hash reason", () => {
    const bundle = signReportBundle(document(), signer);
    const tampered = {
      ...bundle,
      document: { ...bundle.document, judge: { ...bundle.document.judge, ece: 0.001 } },
    };
    const result = verifyReportBundle(tampered, verifier);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join(" ")).toContain("document hash mismatch");
  });

  it("tampered markdown fails even when the document is intact", () => {
    const bundle = signReportBundle(document(), signer);
    const tampered = { ...bundle, markdown: bundle.markdown + "\n- extra flattering line" };
    const result = verifyReportBundle(tampered, verifier);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join(" ")).toContain("markdown");
  });

  it("a forged signature fails verification", () => {
    const bundle = signReportBundle(document(), signer);
    const forged = { ...bundle, signature: Buffer.from("forged").toString("base64") };
    const result = verifyReportBundle(forged, verifier);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join(" ")).toContain("signature verification failed");
  });

  it("an unknown keyId fails closed", () => {
    const bundle = signReportBundle(document(), signer);
    const result = verifyReportBundle(bundle, ed25519Verifier({ "other-key": publicPem }));
    expect(result.ok).toBe(false);
  });

  it("a swapped signed payload is caught before signature checking", () => {
    const bundle = signReportBundle(document(), signer);
    const swapped = { ...bundle, signedPayload: bundle.signedPayload.replace("signed-bundle/1", "signed-bundle/9") };
    const result = verifyReportBundle(swapped, verifier);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reasons.join(" ")).toContain("signed payload");
  });
});
