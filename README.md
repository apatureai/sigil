# assurance-harness

The engine behind an **independent, neutral AI quality & efficiency assurance audit** for regulated enterprises. It measures a client's OWN calibrated quality bar across model providers, finds where they overpay at equal quality, surfaces run-to-run reliability, and produces a finance/security-signable artifact — selling **no model, no router, no platform**.

Implements the open methodology (apatureai/core #130). Decision of record: apatureai/core #134.

> **Brand-neutral placeholder name.** The practice name is unratified; this repo is a private placeholder, easily renamed.

## Why it's a *standalone* repo
The moat is **structural neutrality** (#126/#134): in financial-services model risk, SR 11-7 requires independent model validation *separated from the builder*. If this engine lived inside a company that also sells models/routers, the artifact's independence would be contaminated. It stays standalone; it will reuse calibration IP by importing `@engine/eval` **one-directionally** (never the reverse).

## Hard rules
- **Never** calls a real model, key, sandbox, or network — the panel runs through an injected `Gateway`; tests use `StubGateway` (fixtures only).
- No BYOK; in a real engagement the client supplies keys **in their own VPC**, and only scores/metrics leave.
- Pure and deterministic: same frozen corpus + frozen panel ⇒ same frontier, byte-identical report.

## Components (methodology #130)
| step | module | what it does |
|------|--------|--------------|
| 1–2 | `corpus` | frozen, **content-addressed** corpus: task families + the client rubric + human labels (ground truth + judge calibration anchors) |
| 2 | `gateway` | injected panel runner port + `StubGateway` (no real model/key/network) |
| 3 | `metrics` | **calibrated judge** reliability — ECE, Brier, reliability table (the number ships with its own error bars) |
| 4 | `reliability` | **Pass^k** run-to-run variance (unbiased estimator) |
| 5 | `frontier` | **Pareto** frontier over quality × cost × latency + equal-quality savings |
| 6 | `governance` | read-only agent → task → identity least-privilege gap map (attach) |
| 7 | `report` | the signable **report document** + deterministic markdown render |
| 8 | `router-policy` | **neutral** router-policy export (cheapest-at-held-quality + fallbacks) the client keeps |
| — | `harness` | `runAudit` wiring the pipeline |
| — | `conformal` | **finite-sample risk certificates**: exact Clopper–Pearson bounds + a certified abstention threshold (fixed-sequence Learn-Then-Test) — "on the cases the judge accepts, error ≤ α with confidence 1−δ; the rest go to humans" |
| — | `stats` | evidence behind the headline claims: exact McNemar on paired outcomes gating "equal-quality switch", and a certified Pass^k lower bound |
| — | `bundle` | **signed report bundle** (#17): detached Ed25519 signature over the content-addressed document + markdown, verified fully offline — the air-gapped/examiner exchange format |
| — | `drift` | **anytime-valid ongoing monitoring**: e-process (Ville: P(ever false-alarm) ≤ α) + changepoint e-detector (ARL ≥ 1/α) over bounded judge-error streams, with classical CUSUM as the disclosed weaker baseline — the SR 26-2 "ongoing monitoring" companion to the static certificates |

## Status
v1 engine, green (typecheck · 95 tests · lint · CI). Vertical decided: **financial services**. Path decided: **boutique-first → productize the neutral measurement layer on a 3-part trigger** (#134). Next steps are external: secure the first FS/MRM design partner; ratify the brand; wire the real `@engine/eval` import when the harness graduates from fixtures.
