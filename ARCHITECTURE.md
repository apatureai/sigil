# ARCHITECTURE — Assurance Harness

> See PRD.md, TRD.md, RESEARCH.md. Decision of record: apatureai/core #134.

## 1. Where it sits
A **standalone, neutral** engine — deliberately NOT a component of the Apature product company (judgment-engine et al.), because the moat is structural independence (a validator owned by a vendor that sells models fails SR 26-2's separation test). It reuses Apature's calibration IP by importing `@engine/eval` **one-directionally**; nothing in the product company depends on this repo. When the #134 productization trigger fires, this repo *is* the neutral measurement-product company.

```
client VPC (their keys, their data)
   └── Gateway adapter (LiteLLM/OpenRouter)  ← injected; harness holds no key
         │  outputs + cost + latency  (never leave the VPC)
         ▼
   Assurance Harness (this repo)
     freeze corpus ─► run panel ─► calibrated judge ─► Pass^k ─► frontier
                                      │                                │
                                      ├── governance overlay (read-only)
                                      ▼                                ▼
                              report document ◄──────────────── router policy
         │  scores / metrics / report / policy  (results-only egress)
         ▼
   client's MRM / independent validation function  ─►  examiner artifact
```

## 2. Trust boundaries
- **VPC boundary:** raw prompts/outputs and keys stay inside; only scores, calibration metrics, the frontier, the report, and the router policy cross out. Enforced by the egress allow/deny lists (TRD §4).
- **Neutrality boundary:** the harness imports calibration math but ships and is operated independently; its provenance is its own, so the artifact can credibly say "produced by an entity with nothing to sell you but the verdict."
- **No-write boundary:** read-only on the client estate; no shape carries write/checkout capability.

## 3. Determinism
Content-addressed corpus + frozen panel + disclosed judge calibration ⇒ a third party (or an examiner) can reproduce the frontier and report from the artifacts. No wall clock / RNG in the analysis path; the only injected non-determinism is the clock for report timestamps (recorded, not computed-from).

## 4. Deployment modes
1. **customer-VPC** (default, FS): the harness + gateway adapter run inside the client boundary.
2. **hosted** (non-regulated pilots only).
3. **air-gapped signed-bundle exchange** (deferred): corpus + panel results exchanged as signed bundles for the most restricted environments.

## 5. Extensibility
New detectors (e.g. drift over time, multi-judge ensembles) and new gateway adapters plug in behind the existing ports without changing the contract. The productized continuous-monitoring layer (#134 trigger) is the same engine on a schedule with a persistence layer added — never a router.
