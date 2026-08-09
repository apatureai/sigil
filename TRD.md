# TRD — Sigil

> Technical contract for the engine behind the audit. See `README.md` and `ARCHITECTURE.md`.

## 1. Principles
1. **Neutral by construction.** The harness sells/operates no model, router, or platform. It runs candidates through an *injected* gateway and reports a verdict; it never has a stake in which candidate wins.
2. **Deterministic + reproducible.** Same frozen corpus + frozen panel ⇒ byte-identical frontier and report. Content-addressing (RFC-8785-style canonical JSON + SHA-256) is the reproducibility key.
3. **Fail-closed on data egress.** Runs inside the client's environment with the client's keys; only scores/metrics/derived artifacts leave; raw outputs and prompts never egress; zero-retention.
4. **No real model/key/network in tests.** Fixtures + injected ports only.
5. **No sibling dependency.** The calibration math follows a documented canonical convention so results stay comparable across implementations, but nothing is imported from — or exported to — any other repo. See the calibration-contract test.

## 2. Pipeline
`freeze corpus → run panel (gateway) → judge (calibrated) → reliability (Pass^k) → frontier → governance overlay → report + router policy`.

## 3. Components & contracts
### 3.1 Corpus (`corpus.ts`)
- `CorpusSpec = { rubric: Rubric, tasks: CorpusTask[] }`; `CorpusTask` carries `labels: LabeledExample[]` (human-confirmed accept/reject — ground truth + calibration anchors).
- `freezeCorpus()` validates non-empty + every task labeled, then content-addresses an order-independent projection → `FrozenCorpus.contentHash`. This is the examiner-relevant "labeled benchmark set" (SR 26-2).
- `groundTruthFrom()` derives `accept(taskId, output)`; unlabeled outputs are conservatively not-accepted.

### 3.2 Gateway (`gateway.ts`)
- `Gateway.run({model, taskId, trial, input}) → {output, costUsd, latencyMs}`. Production adapter wires LiteLLM/OpenRouter **inside the client environment**; the harness never holds a key. Tests inject `StubGateway` (fixtures, may vary output per trial for variance).

### 3.3 Calibrated judge metrics (`metrics.ts`)
- Input: `JudgePrediction[] = {confidence, correct}` where `correct = (judge verdict == human label)`.
- `expectedCalibrationError` (binned, count-weighted gap), `brierScore`, `reliabilityTable`. The quality number ships **with its own error bars**.

### 3.4 Reliability (`reliability.ts`)
- `passAtK(trials, k)` — unbiased combinatorial Pass^k estimator (∏ (passes−i)/(n−i)). Quantifies the run-to-run variance regulators flagged.

### 3.5 Frontier (`frontier.ts`)
- `paretoFrontier(candidates)` over quality (↑) × cost (↓) × latency (↓); `recommendSwitch(current, candidates, tol)` returns the cheapest model at held quality and its `savingsPct`. Savings claimed **only at equal-or-better measured quality**.

### 3.6 Governance overlay (`governance.ts`)
- `mapGovernance(agents, requirements)` → least-privilege gap findings (excess/missing scope, untracked task). Read-only; never mutates the IdP/estate.

### 3.7 Report (`report.ts`)
- `buildReportDocument(report, meta)` → content-addressed `AuditReportDocument` restating only measured facts; `renderMarkdown()` deterministic. The signable artifact.

### 3.8 Router policy (`router-policy.ts`)
- `exportRouterPolicy(report, qualityFloor)` → portable `RouterPolicy` (per family: cheapest model ≥ floor + frontier fallbacks). We export it; the client loads it into whatever router they run. Never silently drops a family.

### 3.9 Orchestration (`harness.ts`)
- `runAudit(input) → AuditReport { judgeReliability, families[], passK[] }`. Pure over injected ports.

### 3.10 Risk certificates (`conformal.ts`)
- ECE/Brier (§3.3) are diagnostics; certificates are guarantees. `clopperPearsonUpper/Lower` give exact one-sided binomial bounds on the judge's error rate over the labeled corpus. `certifyAbstentionThreshold` runs fixed-sequence Learn-Then-Test over a **data-independent** confidence grid and returns the maximal-coverage threshold whose selective error is ≤ α with confidence 1−δ — or an explicit refusal ("abstain or collect more labels"). Valid under exchangeability with the calibration draw; re-certification is expected on a recurring (e.g. quarterly) cadence. Fail-closed: empty/insufficient calibration certifies nothing.

### 3.11 Signed bundle (`bundle.ts`)
- Deployment mode 3 (air-gapped exchange): `signReportBundle` produces a portable bundle carrying the document, its deterministic markdown, and a detached Ed25519 signature over the canonical `{documentHash, markdownHash}` payload; `verifyReportBundle` re-derives everything offline and fails closed with named reasons (document-hash mismatch, markdown tamper, payload swap, signature failure, unknown keyId). Signer/verifier are injected ports — the harness ships no key; Ed25519 keeps signatures deterministic (RFC 8032) so bundles stay byte-stable.

### 3.12 Ongoing monitoring (`drift.ts`)
- Sequential drift monitors over bounded [0,1] observation streams (judge error indicators via `errorObservations`), built on betting supermartingales (e-detector line, arXiv 2203.03532). Two constructions with EXACTLY-stated guarantees: the fixed-null `EProcess` (Ville — under H0 "true rate ≤ μ0" the probability of EVER alarming is ≤ α over the unbounded horizon) and the changepoint `EDetector` (e-CUSUM — average run length to false alarm ≥ 1/α, retaining sensitivity to late changes). λ-grid mixtures replace tuning; state is plain serializable data so a monitoring run is persistable and independently replayable; classical Page CUSUM ships as the disclosed weaker baseline. This is the between-audit monitoring machinery: the same labeled streams the certificates (§3.10) consume, monitored BETWEEN audits with a false-alarm budget an examiner can hold.

### 3.13 Claim evidence (`stats.ts`)
- `verifySwitchQuality` gates the §3.5 "equal-or-better quality" claim with an exact two-sided McNemar test on paired per-task outcomes; a significantly-worse candidate makes the switch claim NOT defensible, and "no detected loss" is reported as exactly that, never as equality. `certifiedPassKLowerBound` turns the §3.4 point estimate into a finite-sample floor (Clopper–Pearson lower bound on the per-run pass rate, powered to k, i.i.d.-runs assumption disclosed in the statement).

## 4. Security & data handling
- Deployment modes: hosted (non-regulated), **customer-environment** (the default this was designed for), air-gapped signed-bundle exchange (`bundle.ts`).
- Egress allowlist: scores, calibration metrics, frontier, report, router policy. **Denylist:** raw outputs, prompts, keys, corpus content beyond hashes.
- No-write posture: no shape accepts repo-write/checkout credentials.

## 5. Versioning & determinism
- Each contract independently semver'd; additive-only within a major. `policyVersion`, `recordVersion`, corpus `contentHash`, and document `documentHash` make every artifact reproducible and auditable.

## 6. Failure modes (honest)
- Incomplete labels → calibration over labeled subset only; report discloses sample size.
- Nothing clears the quality floor → router policy falls back to highest-quality candidate (never drops a family); report flags it.
- Judge poorly calibrated (high ECE) → surfaced, not hidden; the audit reports its own measurement reliability before any savings claim.
- No abstention threshold certifies the target risk → the certificate says so explicitly ("abstain or collect more labels"); a wide bound from small n is a finding, never rounded away.
- Candidate significantly worse on paired tasks → the switch recommendation is reported NOT defensible regardless of the cost delta.

## 7. Eval criteria
Offline harness over golden finance-shaped fixtures must show: deterministic byte-stable output; calibration metrics correct on known sets; Pass^k matching the combinatorial truth; frontier dominance correct.
