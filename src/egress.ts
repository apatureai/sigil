/**
 * Egress guard (TRD §4): the boundary that makes "your data never
 * leaves" enforceable, not just a promise.
 *
 * Every artifact that crosses out of the client VPC (report document, router
 * policy, governance map) must carry ONLY derived facts: scores, metrics, the
 * frontier, ids, hashes. This guard fails CLOSED: it refuses to release an
 * artifact that contains a raw model output / prompt (passed as the forbidden
 * set) or anything matching a credential pattern. In financial-services model
 * risk this is the control that lets the artifact leave the validation
 * environment at all.
 */

export class EgressViolation extends Error {
  constructor(public readonly code: "forbidden_content" | "credential_pattern", message: string) {
    super(message);
    this.name = "EgressViolation";
  }
}

/** Credential-shaped patterns blocked regardless of the forbidden set (defense-in-depth). */
const CREDENTIAL_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-[A-Za-z0-9]{16,}/, // OpenAI-style key
  /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /\b(api[_-]?key|secret|password|token)\b\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._-]{8,}/i,
];

/** Forbidden strings shorter than this are ignored to avoid trivial false positives. */
const MIN_FORBIDDEN_LEN = 3;

/**
 * Assert an artifact is safe to release. `forbidden` is the set of raw outputs /
 * prompts that must never appear in an exported artifact. Throws `EgressViolation`
 * (fail-closed) if any forbidden content or credential pattern is present;
 * otherwise returns the artifact unchanged.
 */
export function assertSafeEgress<T>(artifact: T, forbidden: readonly string[] = []): T {
  const serialized = JSON.stringify(artifact) ?? "";

  for (const secret of forbidden) {
    if (secret.length >= MIN_FORBIDDEN_LEN && serialized.includes(secret)) {
      throw new EgressViolation("forbidden_content", "egress artifact contains a raw output/prompt that must not leave the client environment");
    }
  }

  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new EgressViolation("credential_pattern", "egress artifact contains a credential-shaped string");
    }
  }

  return artifact;
}

/** Non-throwing probe: returns the violation (or null) without releasing. */
export function checkEgress(artifact: unknown, forbidden: readonly string[] = []): EgressViolation | null {
  try {
    assertSafeEgress(artifact, forbidden);
    return null;
  } catch (e) {
    return e instanceof EgressViolation ? e : null;
  }
}
