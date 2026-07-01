# BACKLOG — Assurance Harness

Numbered backlog seeded as GitHub issues on this repo (mirrors the apatureai org pattern). `[x]` = built in the v1 engine; `[ ]` = open. Practice-level graduation gates (the #134 trigger) are tracked at the bottom.

## Engine
- [x] #2 — Calibrated-judge metrics: ECE, Brier, reliability table
- [x] #3 — Pass^k run-to-run reliability (unbiased estimator)
- [x] #4 — Pareto efficiency frontier + equal-quality savings
- [x] #5 — Gateway port + StubGateway (no real model/key/network)
- [x] #6 — Frozen, content-addressed corpus + rubric + labels; ground truth
- [x] #7 — Report document + deterministic markdown render
- [x] #8 — Neutral router-policy exporter
- [x] #9 — Governance overlay (read-only least-privilege gaps)
- [ ] #10 — Production gateway adapter (LiteLLM/OpenRouter) behind the VPC egress allowlist
- [ ] #11 — `@engine/eval` one-directional import to share calibration IP (replace the fresh impls)
- [x] #12 — CLI runner: `audit <corpus-dir>` -> report + policy + governance (offline results-bundle)
- [x] #13 — Golden FS-shaped end-to-end fixture audit (deterministic regression)
- [x] #14 — Egress guard: allowlist/denylist + fail-closed test that raw outputs/prompts/keys never serialize
- [x] #15 — Multi-judge ensemble + judge-disagreement disclosure
- [ ] #16 — Trend/continuous mode scaffolding (the productization seam; gated on #134 trigger)
- [ ] #17 — Signed report bundle + offline verification (air-gapped exchange)

## Practice graduation gates (#134 — do NOT productize until ALL fire)
- [ ] T1 — ≥5 paid engagements incl. ≥2 periodic-assurance retainers
- [ ] T2 — cross-client held-out ECE ≥30% lower when seeded from the accumulated corpus vs cold-start (the data-moat proof; falsifier if <~10% by engagement #3)
- [ ] T3 — ≥2 engagements where the client asks for continuous re-runs

## External (founder)
- [ ] Secure the first FS / MRM design partner (warm intro)
- [ ] Ratify the brand; rename repo + collateral off placeholders
