# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| `main` | Yes. Fixes land on `main` |
| Tagged releases | `v0.1.0` is the current release. Not yet published to npm. Track `main` |

Sigil has **zero runtime dependencies**: every import outside the repo is a Node built-in
(`node:crypto`, `node:fs`, `node:path`). The supply-chain surface is the dev toolchain only
(TypeScript, ESLint, Vitest and their transitive tree, pinned by `pnpm-lock.yaml`), and that is
updated periodically on `main`.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository: the **Security** tab, then
**Report a vulnerability**. It is enabled, and it keeps the report out of public view while it is
being handled.

**Please do not open a public issue for a security problem.**

What to include: affected file or module, what an attacker can do, and the smallest reproduction
you have. A failing test is ideal, given that the whole harness runs offline.

What to expect:

- An acknowledgement that the report was received, normally within a few days.
- An assessment of whether it is in scope and how severe it looks, with the reasoning shared with
  you rather than just a verdict.
- A fix on `main` for anything confirmed, and credit in the advisory unless you ask otherwise.
- A GitHub security advisory published for anything that affects people running the code.

This is a small project maintained by one person, so response times are best effort rather than
contractual. There is no bug bounty and no monetary reward.

## Scope

**In scope:** anything that lets an artifact leak data it should not carry (the `egress.ts`
boundary), anything that makes a signed bundle verify when it should not (`bundle.ts`), key
handling in `src/gateway-openai-compat.ts`, host-allowlist bypasses in that adapter, and any path
traversal or unsafe write in the CLI.

**Not in scope:** advisories in dev dependencies that do not affect anyone running the library
(report them as normal issues, they are still worth having), and statistical validity questions,
which are correctness bugs rather than vulnerabilities and belong in a public issue where they can
be argued in the open.

## If you are going to run this code

There are specific things to review before pointing it at anything real:

- **One module talks to the network.** `src/gateway-openai-compat.ts` is the only code that
  performs egress: it calls an OpenAI-compatible chat-completions endpoint via `fetch`, and it takes
  a `getApiKey()` accessor that is invoked per request. It enforces an explicit `allowedHosts` list
  and scrubs the key from the errors it raises. Everything else in the repo (the judge, frontier,
  certificates, drift, report, and the CLI) is pure and operates on captured fixtures. This adapter
  has not yet been run against a live endpoint from this repo, so review it before wiring a real key
  to it.
- **The egress guard is defense in depth, not a guarantee.** `src/egress.ts` fails closed on a fixed
  list of credential-shaped regexes and a caller-supplied forbidden set. A regex list will not catch
  every secret shape, and it can only inspect what is passed to it. Do not treat it as a compliance
  control on its own.
- **Key custody is the caller's.** `src/bundle.ts` signs and verifies report bundles with Ed25519,
  but the harness holds no key by design: `ed25519Signer(privateKeyPem, keyId)` takes a private key
  PEM directly into process memory. For production use, inject a KMS or HSM-backed `BundleSigner`
  instead. Verification is fail-closed; signing safety is on you.

Nothing in this repository has been through an external security audit. The MIT License's warranty
disclaimer applies in full.
