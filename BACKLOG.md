# BACKLOG — Sigil

What was built and what was not, at the point the project was archived. `[x]` = shipped in the v1
engine; `[ ]` = never built. Numbers are the issue numbers this repo's backlog was seeded from.

## Engine

- [x] #2 — Calibrated-judge metrics: ECE, Brier, reliability table
- [x] #3 — Pass^k run-to-run reliability (unbiased estimator)
- [x] #4 — Pareto efficiency frontier + equal-quality savings
- [x] #5 — Gateway port + StubGateway (no real model/key/network)
- [x] #6 — Frozen, content-addressed corpus + rubric + labels; ground truth
- [x] #7 — Report document + deterministic markdown render
- [x] #8 — Neutral router-policy exporter
- [x] #9 — Governance overlay (read-only least-privilege gaps)
- [x] #10 — Production gateway adapter (OpenAI-compatible: LiteLLM/OpenRouter) behind a host
  allowlist (`gateway-openai-compat.ts`). Implemented and tested against an injected `fetchImpl`
  only — never exercised against a live endpoint from this repo.
- [ ] #11 — Import the upstream canonical calibration implementation instead of mirroring it.
  Never wired; `metrics.ts` mirrors the math and `fixtures/calibration-contract.golden.json` pins
  the two together.
- [x] #12 — CLI runner: `audit <corpus-dir>` -> report + policy + governance (offline
  results-bundle)
- [x] #13 — Golden finance-shaped end-to-end fixture audit (deterministic regression)
- [x] #14 — Egress guard: allowlist/denylist + fail-closed test that raw outputs/prompts/keys
  never serialize
- [x] #15 — Multi-judge ensemble + judge-disagreement disclosure
- [ ] #16 — Trend/continuous mode scaffolding. Never built: `drift.ts` and `aci.ts` provide the
  machinery, but there is no scheduler, persistence layer, or service around them.
- [x] #17 — Signed report bundle + offline verification (`bundle.ts`: detached Ed25519 signature
  over {documentHash, markdownHash} behind injected signer/verifier ports; fail-closed
  named-reason verification)
- [x] — Finite-sample risk certificates: exact Clopper–Pearson bounds + certified abstention
  threshold via fixed-sequence Learn-Then-Test (`conformal.ts`)
- [x] — Claim evidence: exact McNemar gate on "equal-quality switch" + certified Pass^k lower
  bound (`stats.ts`)
- [x] — Wire certificates + switch evidence into the report document (TRD §3.7: additive
  `abstention`/`switchEvidence`/`certifiedReliability` blocks + markdown sections) and the router
  policy (TRD §3.8: quality-first ordering + annotation when the paired evidence refuses the
  cost-first switch)
- [x] — Anytime-valid ongoing monitoring (`drift.ts`): betting e-process (Ville false-alarm bound)
  + changepoint e-detector (ARL bound) + CUSUM baseline over bounded judge-error streams
- [x] — `aci.ts`: adaptive conformal intervals (Gibbs–Candès) for trend bands
- [ ] — Cross-validate `drift.ts` against CRAN `stcpR6` outputs as golden fixtures. **Open
  NEEDS-VERIFICATION item at archive time:** the guarantees are argued in the module docs and
  property-tested internally, but never corroborated against an external reference
  implementation.
- [ ] — Anchor-set drift attribution protocol (system-vs-judge) on top of `drift.ts`, with a
  rotate-with-overlap anchor refresh policy
