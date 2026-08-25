Part of [sigil](../README.md). Moved from the README on 2026-08-24; anchors preserved.

## How it works

The engine is a single pure pipeline over injected ports. It is designed to run inside your own
network boundary, with only derived numbers crossing out.

```
  your environment (your keys, your data)
     |
     |  Gateway adapter (OpenAI-compatible: LiteLLM proxy / OpenRouter)
     |  outputs + cost + latency
     v
  +------------------------- Sigil -------------------------+
  |                                                          |
  |  freeze corpus  ->  run panel  ->  calibrated judge       |
  |  (content-addressed)  (gateway)   (ECE / Brier / table)   |
  |        |                               |                  |
  |        |                               +-> risk certificates (Clopper-Pearson, LTT)
  |        |                               +-> drift monitors (e-process / e-detector)
  |        v                                                  |
  |   Pass^k reliability  ->  Pareto frontier  ->  McNemar gate|
  |        |                        |                    |    |
  |        +------------------------+--------------------+    |
  |                       |                     |             |
  |              report document          router policy       |
  |            (+ Ed25519 signed bundle)   (neutral export)    |
  |                       |                     |             |
  |                  [ egress guard: fail-closed ]             |
  +------------------------------------------------------------+
     |
     v  scores, metrics, frontier, report, policy: nothing raw
```

### Boundaries enforced in code, not prose

- **No key.** The production gateway takes a key *accessor* invoked per request; the key is never
  stored on the adapter, never logged, and is scrubbed from every error the module can throw.
- **No fabricated cost.** If the endpoint reports no cost (OpenRouter `usage.cost` or LiteLLM's
  `x-litellm-response-cost` header), the adapter throws instead of defaulting to `0`, because a
  zero would silently flatter every candidate's position on the frontier.
- **No write.** Nothing in the codebase accepts a write or checkout credential; the governance
  overlay reports least-privilege gaps and never mutates anything.
- **Egress allowlist:** scores, calibration metrics, frontier, report, router policy. **Denylist:**
  raw outputs, prompts, keys, corpus content beyond hashes.

### Deployment modes

1. **In your own environment** (the default): engine and gateway adapter both run inside your
   boundary.
2. **Hosted**, where the data sensitivity allows it.
3. **Air-gapped signed-bundle exchange:** corpus and panel results exchanged as Ed25519-signed
   bundles, verified fully offline (`bundle.ts`).

### Directory map

Single package, no workspaces. All source is in `src/`, one module per pipeline stage.

| Module | What it does |
|---|---|
| `corpus.ts` | Freezes and content-addresses the task set, rubric, and human labels; derives ground truth (unlabeled outputs are conservatively not-accepted) |
| `gateway.ts` | The `Gateway` port plus `StubGateway`, a fixture map that can vary output per trial to exercise run-to-run variance |
| `gateway-openai-compat.ts` | Adapter for any OpenAI-compatible chat-completions endpoint, behind a host allowlist checked before every call |
| `metrics.ts` | ECE, Brier, reliability table: the judge's own calibration |
| `reliability.ts` | Unbiased combinatorial Pass^k estimator (probability a random k-subset of observed runs all pass) |
| `frontier.ts` | Pareto frontier over quality x cost x latency; cheapest candidate at equal-or-better measured quality |
| `conformal.ts` | Exact Clopper-Pearson bounds; certified abstention threshold via fixed-sequence Learn-Then-Test |
| `stats.ts` | Exact McNemar gate on paired outcomes; certified Pass^k lower bound |
| `drift.ts` | E-process (Ville), changepoint e-detector (ARL), CUSUM baseline over bounded error streams |
| `aci.ts` | Adaptive conformal intervals (Gibbs-Candes) for forecast bands on short series; abstains when history is too short |
| `rank-score.ts` | Kendall tau-b + cardinal interval width (ordinal vs cardinal judge reliability) |
| `ensemble.ts` | Multi-judge majority vote (ties resolve to FAIL) with inter-judge disagreement disclosed as a first-class signal |
| `governance.ts` | Read-only agent to task to scope least-privilege gap map |
| `report.ts` | Content-addressed report document + deterministic markdown render; certificate blocks are optional and additive |
| `router-policy.ts` | Portable, vendor-neutral routing policy export (cheapest model clearing the quality floor, frontier as fallbacks) |
| `bundle.ts` | Ed25519-signed report bundle + fail-closed offline verification |
| `egress.ts` | Fail-closed guard: no raw output, prompt, or credential-shaped string may leave |
| `canonical.ts` | Canonical JSON + SHA-256 content hashing, the reproducibility primitive |
| `harness.ts` | `runAudit`: pure orchestration over the injected ports |
| `cli.ts`, `bin.ts` | Offline runner over a captured results bundle |
| `index.ts` | Public surface |

`test/` mirrors `src/` one-to-one, plus `golden-fs.test.ts` (a full end-to-end deterministic
regression on a finance-shaped fixture) and `certificates.property.test.ts` (property tests over
the certificate math via `fast-check`). `examples/credit-memo/` is the synthetic input bundle used
by the quickstart. `fixtures/calibration-contract.golden.json` pins the calibration math against a
sibling implementation; see [Status and roadmap](roadmap.md).

### Documented failure modes

- Incomplete labels: calibration runs over the labeled subset only, and the report discloses the
  sample size.
- Nothing clears the quality floor: the router policy falls back to the highest-quality candidate,
  never silently dropping a family, and that route carries a `note` saying the primary does not
  clear the floor. Without it, a policy entry pairing a `qualityFloor` with a `primary` reads as the
  claim that the primary met it.
- Judge poorly calibrated (high ECE): surfaced before any savings claim, never hidden.
- No abstention threshold certifies the target risk: the certificate says so explicitly ("abstain
  or collect more labels"). A wide bound from a small sample is a finding, never rounded away.
- Candidate significantly worse on paired tasks: the switch recommendation is reported **not
  defensible** regardless of the cost delta.
- Fewer recorded trials than `trialsPerTask` asks for: the CLI refuses the bundle and writes
  nothing; through the library, replayed responses are excluded from the sample and from Pass^k and
  the shortfall is stated in the report. The sample count is never padded to the requested number.
- Fewer recorded runs than `passK` asks for: Pass^k is not computable for those pairs, so the CLI
  refuses the bundle and writes nothing; through the library the pairs are listed in
  `report.passKCoverage.unmeasured` and printed under `NOT MEASURED` in the report. A pair missing
  from the reliability table is never left to read as a clean one.
