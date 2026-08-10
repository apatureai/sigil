# Security Policy

## Status: unmaintained

This repository is an **archived public release**. The project it belonged to has been
wound down. There is:

- **no active security support** — no patches, no backports, no advisories;
- **no supported version** — nothing here is maintained, including `main`;
- **no bug bounty** and no reward of any kind.

The code is published as-is under the MIT License, whose warranty disclaimer applies in
full. Treat it as reference material, not as a maintained dependency.

## Reporting a vulnerability anyway

If you find something and want it on the record, use GitHub's private vulnerability
reporting on this repository (**Security** tab → **Report a vulnerability**). That keeps
the report out of public view while it is read.

Please do **not** open a public issue for a security problem.

Be aware of the honest expectation: reports may be read late or not at all, and there is
no commitment to triage, fix, publish an advisory, or reply. If GitHub's reporting form is
unavailable (it can be disabled per repository), there is no monitored channel —
assume the finding will not reach anyone and act accordingly. Forking and fixing is the
reliable path.

## If you are going to run this code

Sigil is an offline, deterministic audit harness with **zero runtime dependencies** — every
import outside the repo is a Node built-in (`node:crypto`, `node:fs`, `node:path`). That
keeps the supply-chain surface small, but there are specific things to review before
pointing it at anything real:

- **One module talks to the network.** `src/gateway-openai-compat.ts` is the only code that
  performs egress: it calls an OpenAI-compatible chat-completions endpoint via `fetch`, and
  it takes a `getApiKey()` accessor that is invoked per request. It enforces an explicit
  `allowedHosts` list and scrubs the key from the errors it raises. Everything else in the
  repo — the judge, frontier, certificates, drift, report, and the `audit` CLI — is pure and
  operates on captured fixtures. Review this adapter before wiring a live key to it.
- **The egress guard is defense-in-depth, not a guarantee.** `src/egress.ts` fails closed on
  a fixed list of credential-shaped regexes and a caller-supplied forbidden set. A regex list
  will not catch every secret shape, and it can only inspect what is passed to it. Do not
  treat it as a compliance control on its own.
- **Key custody is entirely the caller's.** `src/bundle.ts` signs and verifies report bundles
  with Ed25519, but the harness holds no key by design: `ed25519Signer(privateKeyPem, keyId)`
  takes a private key PEM directly into process memory. Production use was always intended to
  inject a KMS/HSM-backed `BundleSigner` instead. Verification is fail-closed; signing safety
  is on you.
- **Dependencies are frozen in time.** The dev toolchain (TypeScript, ESLint, Vitest, and
  their transitive tree, pinned by `pnpm-lock.yaml`) will accumulate published advisories and
  nobody here will bump them. Re-resolve dependencies yourself before building on this.

**Do not run this against production secrets, production endpoints, or regulated data
without your own review.** Nothing in this repository has been security-reviewed for use
outside its original private context.
