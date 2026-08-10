/**
 * Signed report bundle + offline verification (backlog #17; TRD §4 air-gapped
 * exchange, ARCHITECTURE §4 mode 3).
 *
 * The report document is already content-addressed; this module adds the
 * custody layer: a detached signature over the canonical projection of
 * `{documentHash, markdownHash}` so a third party (examiner, counterparty
 * validation function) can verify OFFLINE that the artifact they hold is the
 * artifact the auditor produced: no network, no shared platform, no trust in
 * the transport.
 *
 * Ports, per the hard rules: the harness holds NO key. `BundleSigner` /
 * `BundleVerifier` are injected; production wires a KMS/HSM-backed signer in
 * the client engagement tooling, tests use an in-process Ed25519 keypair
 * (Ed25519 signatures are deterministic per RFC 8032, keeping the byte-stable
 * discipline). Verification is pure and fail-closed: every mismatch is a named
 * reason, and an unverifiable bundle is never "probably fine".
 */

import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { canonicalize, contentHash } from "./canonical.js";
import { renderMarkdown, type AuditReportDocument } from "./report.js";

export interface BundleSigner {
  /** Advertised signer identity; the verifier selects its public key by this. */
  readonly keyId: string;
  readonly algorithm: "ed25519";
  /** Sign the canonical payload string; returns base64. */
  sign(payload: string): string;
}

export interface BundleVerifier {
  /** Verify a base64 signature over the payload for the given keyId. */
  verify(payload: string, signatureB64: string, keyId: string): boolean;
}

export interface SignedReportBundle {
  bundleVersion: "signed-bundle/1";
  document: AuditReportDocument;
  /** Deterministic markdown render carried alongside (what humans read/sign). */
  markdown: string;
  /** Hash of the markdown so prose tampering is detectable independently. */
  markdownHash: string;
  /** The exact canonical payload string that was signed. */
  signedPayload: string;
  signature: string;
  keyId: string;
  algorithm: "ed25519";
}

export type BundleVerification =
  | { ok: true; keyId: string }
  | { ok: false; reasons: string[] };

function signingPayload(documentHash: string, markdownHash: string): string {
  return canonicalize({ bundleVersion: "signed-bundle/1", documentHash, markdownHash });
}

/** Sign a report document (+ its deterministic markdown) into a portable bundle. */
export function signReportBundle(document: AuditReportDocument, signer: BundleSigner): SignedReportBundle {
  const markdown = renderMarkdown(document);
  const markdownHash = contentHash({ markdown });
  const signedPayload = signingPayload(document.documentHash, markdownHash);
  return {
    bundleVersion: "signed-bundle/1",
    document,
    markdown,
    markdownHash,
    signedPayload,
    signature: signer.sign(signedPayload),
    keyId: signer.keyId,
    algorithm: signer.algorithm,
  };
}

/**
 * Offline verification: recompute the document hash from the document body,
 * re-render the markdown, recompute the signed payload, and check the
 * signature. Every failure is named; any failure refuses the bundle.
 */
export function verifyReportBundle(bundle: SignedReportBundle, verifier: BundleVerifier): BundleVerification {
  const reasons: string[] = [];

  const { documentHash, ...documentBody } = bundle.document;
  const recomputedDocumentHash = contentHash(documentBody);
  if (recomputedDocumentHash !== documentHash) {
    reasons.push(`document hash mismatch: body recomputes to ${recomputedDocumentHash}, bundle claims ${documentHash}`);
  }

  const expectedMarkdown = renderMarkdown(bundle.document);
  if (expectedMarkdown !== bundle.markdown) {
    reasons.push("markdown does not match the deterministic render of the document");
  }
  const recomputedMarkdownHash = contentHash({ markdown: bundle.markdown });
  if (recomputedMarkdownHash !== bundle.markdownHash) {
    reasons.push("markdown hash mismatch");
  }

  const expectedPayload = signingPayload(documentHash, bundle.markdownHash);
  if (expectedPayload !== bundle.signedPayload) {
    reasons.push("signed payload does not match the recomputed canonical payload");
  }

  if (reasons.length === 0 && !verifier.verify(bundle.signedPayload, bundle.signature, bundle.keyId)) {
    reasons.push(`signature verification failed for keyId ${bundle.keyId}`);
  }

  return reasons.length === 0 ? { ok: true, keyId: bundle.keyId } : { ok: false, reasons };
}

// --- In-process Ed25519 ports (tests / engagement tooling) -----------------

/** Ed25519 signer over a PEM private key. Injected; the harness ships no key. */
export function ed25519Signer(privateKeyPem: string, keyId: string): BundleSigner {
  const key: KeyObject = createPrivateKey(privateKeyPem);
  return {
    keyId,
    algorithm: "ed25519",
    sign: (payload) => cryptoSign(null, Buffer.from(payload, "utf8"), key).toString("base64"),
  };
}

/** Ed25519 verifier over a keyId → PEM public key map. Unknown keyId fails closed. */
export function ed25519Verifier(publicKeysPemByKeyId: Record<string, string>): BundleVerifier {
  const keys = new Map<string, KeyObject>(
    Object.entries(publicKeysPemByKeyId).map(([id, pem]) => [id, createPublicKey(pem)]),
  );
  return {
    verify: (payload, signatureB64, keyId) => {
      const key = keys.get(keyId);
      if (key === undefined) return false;
      return cryptoVerify(null, Buffer.from(payload, "utf8"), key, Buffer.from(signatureB64, "base64"));
    },
  };
}
