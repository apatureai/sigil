/**
 * Canonical JSON + content hashing: the reproducibility primitive.
 *
 * The audit's promise is that the same corpus + frozen panel always produces the
 * same frontier (methodology: TRD §2). Content-addressing the corpus and the report
 * is what lets a third party reproduce the result. Deterministic: sorted keys,
 * no wall clock / RNG.
 */

import { createHash } from "node:crypto";

/** Stable JSON: object keys sorted by code unit; undefined dropped. */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join("");
}

function write(value: unknown, out: string[]): void {
  if (value === null || value === undefined) {
    out.push("null");
    return;
  }
  const t = typeof value;
  if (t === "number") {
    if (!Number.isFinite(value as number)) throw new Error("canonicalize: non-finite number");
    out.push(JSON.stringify(value));
    return;
  }
  if (t === "boolean" || t === "string") {
    out.push(JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    out.push("[");
    value.forEach((v, i) => {
      if (i > 0) out.push(",");
      write(v, out);
    });
    out.push("]");
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  out.push("{");
  keys.forEach((k, i) => {
    if (i > 0) out.push(",");
    out.push(JSON.stringify(k), ":");
    write(obj[k], out);
  });
  out.push("}");
}

/** `sha256:<hex>` content hash over the canonical form of a value. */
export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}
