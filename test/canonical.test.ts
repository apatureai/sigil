import { describe, expect, it } from "vitest";
import { canonicalize, contentHash } from "../src/index.js";

describe("canonicalize", () => {
  it("emits primitives as their JSON form", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(1.5)).toBe("1.5");
    expect(canonicalize("hi")).toBe("\"hi\"");
  });

  it("treats top-level undefined as null", () => {
    expect(canonicalize(undefined)).toBe("null");
  });

  it("escapes strings like JSON.stringify", () => {
    expect(canonicalize("a\"b\n")).toBe(JSON.stringify("a\"b\n"));
  });

  it("normalizes negative zero to 0", () => {
    expect(canonicalize(-0)).toBe("0");
  });

  it("sorts object keys by code unit regardless of insertion order", () => {
    // Insertion order (and JS integer-key iteration order) differ from the sorted
    // result; canonicalize must impose "10" < "9" < "B" < "a" by UTF-16 code unit.
    expect(canonicalize({ b: 1, a: 2 })).toBe("{\"a\":2,\"b\":1}");
    expect(canonicalize({ 10: 3, 9: 4, B: 1, a: 2 })).toBe("{\"10\":3,\"9\":4,\"B\":1,\"a\":2}");
  });

  it("drops undefined-valued object keys but keeps null-valued ones", () => {
    expect(canonicalize({ a: undefined, b: 2 })).toBe("{\"b\":2}");
    expect(canonicalize({ a: null, b: 2 })).toBe("{\"a\":null,\"b\":2}");
  });

  it("preserves array order and renders holes/undefined as null", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
    expect(canonicalize([])).toBe("[]");
    expect(canonicalize([1, undefined, 2])).toBe("[1,null,2]");
  });

  it("recurses into nested structures with sorted keys throughout", () => {
    expect(canonicalize({ z: { y: 1, x: 2 }, a: [3, 1] })).toBe("{\"a\":[3,1],\"z\":{\"x\":2,\"y\":1}}");
  });

  it("is order-independent: reordered keys produce identical output", () => {
    expect(canonicalize({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalize({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("throws on non-finite numbers, including when nested", () => {
    expect(() => canonicalize(NaN)).toThrow(/non-finite/);
    expect(() => canonicalize(Infinity)).toThrow(/non-finite/);
    expect(() => canonicalize(-Infinity)).toThrow(/non-finite/);
    expect(() => canonicalize({ x: Infinity })).toThrow(/non-finite/);
    expect(() => canonicalize([1, NaN])).toThrow(/non-finite/);
  });
});

describe("contentHash", () => {
  it("returns a prefixed 64-hex-char sha256 digest", () => {
    expect(contentHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("matches known golden vectors over the canonical form", () => {
    // Anchors the canonicalize->sha256 pipeline: any drift in the canonical
    // encoding changes these digests, so a silent reproducibility regression fails here.
    expect(contentHash(null)).toBe("sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b");
    expect(contentHash({ b: 1, a: 2 })).toBe("sha256:d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772");
    expect(contentHash([1, undefined, 2])).toBe("sha256:1c23fa80cb2ff873ebd7b1ab23948cef02042de199810c9a58dc7e01ba709967");
    expect(contentHash("hi")).toBe("sha256:b49177e05868b7af8e82a644c1ce20e521af46497adeaffe861d294d9b4bb75e");
  });

  it("is invariant to key order but sensitive to values", () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(contentHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
  });
});
