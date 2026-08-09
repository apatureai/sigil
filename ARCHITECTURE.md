# ARCHITECTURE — Sigil

> See `README.md` for orientation and `TRD.md` for per-module contracts.

## 1. Where it sits

A standalone, neutral engine. Independent validation has to be structurally separated from
anything that builds or sells the thing being validated — in financial-services model risk that
separation is a regulatory requirement (SR 11-7 / SR 26-2), not a preference — so this repo
carries no dependency on, and is not depended on by, any other component. It calls no model and
holds no key.

```
client environment (their keys, their data)
   └── Gateway adapter (OpenAI-compatible: LiteLLM / OpenRouter)  ← injected; harness holds no key
         │  outputs + cost + latency  (never leave the client boundary)
         ▼
   Sigil (this repo)
     freeze corpus ─► run panel ─► calibrated judge ─► Pass^k ─► frontier
                                      │                                │
                                      ├── governance overlay (read-only)
                                      ├── risk certificates (Clopper–Pearson, Learn-Then-Test)
                                      ├── drift monitors (e-process / e-detector)
                                      ▼                                ▼
                              report document ◄──────────────── router policy
                         (+ Ed25519-signed bundle)
         │  scores / metrics / report / policy  (results-only egress)
         ▼
   the client's model-risk / independent validation function  ─►  examiner artifact
```

## 2. Trust boundaries

- **Data boundary:** raw prompts/outputs and keys stay inside the client environment; only scores,
  calibration metrics, the frontier, the report, and the router policy cross out. Enforced by the
  egress allow/deny lists (TRD §4) rather than promised in prose.
- **Independence boundary:** the engine ships and is operated on its own, so the artifact can
  credibly say it was produced by something with no stake in which candidate wins.
- **No-write boundary:** read-only on the client estate; no shape carries write/checkout
  capability.

## 3. Determinism

Content-addressed corpus + frozen panel + disclosed judge calibration ⇒ a third party (or an
examiner) can reproduce the frontier and report from the artifacts. No wall clock and no RNG in
the analysis path; the only injected non-determinism is the clock for report timestamps
(recorded, not computed-from).

## 4. Deployment modes

1. **customer-environment** (the default this was designed for): the engine and gateway adapter
   run inside the client boundary.
2. **hosted** (non-regulated use only).
3. **air-gapped signed-bundle exchange:** corpus + panel results exchanged as Ed25519-signed
   bundles, verified fully offline (`bundle.ts`).

## 5. Extensibility

New detectors (drift over time, multi-judge ensembles) and new gateway adapters plug in behind the
existing ports without changing the contract. A continuous-monitoring layer would be the same
engine on a schedule with a persistence layer added — never a router. That layer was never built;
see `BACKLOG.md`.

## 6. Design rationale (statistical method choices)

- **Distribution-free risk control:** the certificate layer (`conformal.ts`) is the deployable
  descendant of split conformal prediction and Learn-Then-Test risk control (Angelopoulos & Bates
  line) plus selective classification with a reject option (Geifman & El-Yaniv). Chosen over
  asymptotic/Gaussian intervals because a reviewer gets exact finite-sample statements at audit
  sample sizes; chosen over full conformal because split/LTT needs only the labeled corpus that is
  already frozen.
- **Honest caveat, disclosed in every statement:** validity assumes exchangeability between the
  calibration and deployment draws; drift is exactly what a recurring re-certification cadence
  measures. Small n ⇒ wide bounds ⇒ reported wide, never narrowed.
- **Anytime-valid monitoring:** `drift.ts` uses betting supermartingales rather than fixed-horizon
  tests so that a monitor can be watched continuously without inflating the false-alarm rate, and
  keeps the fixed-null e-process guarantee (Ville) and the changepoint e-detector guarantee (ARL)
  strictly separate rather than blurring them.
