# assay-harness (v0)

The engine behind the **independent agent-efficiency & assurance audit** (engagement #1). Implements the open methodology (core #130): turn a frozen task corpus + the client's calibrated quality bar into an efficiency frontier with run-to-run reliability and a judge whose own error bars are disclosed.

> **Codename only.** The practice name is unsettled (see core #126/#129 naming discussion). This package is intentionally **decoupled** — it implements ECE/Brier/Pass^k fresh rather than importing the product company's eval lib, to keep the neutrality posture.

## Hard rules (matched to the cluster)
- **Never** calls a real model, key, sandbox, or network — the panel runs through an injected `Gateway`; tests inject `StubGateway` (fixtures only).
- No BYOK; in a real engagement the client supplies keys **in their own VPC**, and only scores/metrics leave.
- Pure and deterministic: same corpus + frozen panel ⇒ same frontier.

## Pipeline (`runAudit`)
1. **Panel run** — each candidate model over each task, `trialsPerTask` times, via the gateway.
2. **Calibrated judge** — score each output; calibration is measured against human-labeled `GroundTruth`.
3. **Judge reliability** — ECE, Brier, and a reliability table (the differentiator: the quality number ships with its own error bars).
4. **Pass^k** — unbiased run-to-run reliability per (model, task) — the "different output every run" axis.
5. **Efficiency frontier** — per task family, the Pareto set over quality × cost × latency + the cheapest equal-quality switch and its `savingsPct`.

## Status
v0, local. Decision pending (founder): final **home** (a new standalone repo vs. a package reusing `@engine/eval` inside judgment-engine) and the **moat-vs-scale** call (this is the seed of either the audit tool or a monitoring SaaS — see core #131). Not yet pushed anywhere.
