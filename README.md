# Sigil

> **Status: archived.** Sigil was built inside Apature, a venture-stage product that has been
> wound down. It is released as-is under the MIT License, is no longer actively developed, and
> issues and pull requests are unlikely to be reviewed. The code is in working order — typecheck,
> lint, and 160 tests across 20 files pass on Node 24 (verified before archiving) — but nobody is
> on the other end.

Sigil is a harness for auditing an AI system on two questions at once: **is the quality
measurement itself trustworthy**, and **where is money being spent on quality you already
have?** You give it a frozen set of human-labeled tasks, the recorded outputs of several
candidate models over those tasks, and the verdicts of an automated judge (an "LLM-as-judge" —
a model scoring another model's output). It returns how well-calibrated that judge actually is
(ECE, Brier score, a reliability table), how stable each candidate is when you run it repeatedly
(Pass^k), a Pareto frontier over quality × cost × latency with the cheapest model that holds
measured quality, and a content-addressed report that can be signed and verified offline.

It was designed for a specific buyer — model-risk management at a regulated financial
institution, who must independently validate a vendor LLM they cannot open up — but nothing in
the code is finance-specific. It is a general-purpose, dependency-free measurement engine.

Sigil calls no model, holds no key, and has **zero code dependency on any other Apature repo**.
That was a design constraint, not an accident: an audit produced by a company that also sells
you a model or a router is not an independent audit, so the engine was kept structurally
separate from the rest of the stack.

---

## Why it is technically interesting

Most eval harnesses report a number. Sigil's premise is that **an unqualified number is not
evidence**, and nearly every design decision follows from that.

**1. The measurement is itself measured.** Before any quality claim, `metrics.ts` scores the
judge against human labels: expected calibration error (does "0.8 confidence" hold ~80% of the
time?), Brier score, and a binned reliability table. A badly calibrated judge is surfaced, not
hidden — the audit reports its own reliability before it reports anyone else's.

**2. Finite-sample guarantees, not asymptotics.** `conformal.ts` computes exact one-sided
Clopper–Pearson binomial bounds on the judge's error rate, and certifies an *abstention
threshold* via fixed-sequence Learn-Then-Test over a data-independent confidence grid: walk
thresholds from most to least conservative, test at each with the exact bound, stop at the first
failure. The family-wise guarantee survives because the tests are ordered a priori. The output
is a sentence you can file: *"on the X% of cases the judge accepts, its error rate is ≤ α with
confidence 1−δ; the rest go to human review."* Exact bounds were chosen over Gaussian intervals
because audit sample sizes are small — and when nothing certifies, the module **refuses** rather
than returning an uncertified threshold.

**3. Anytime-valid sequential monitoring.** `drift.ts` implements betting supermartingales over
bounded [0,1] observation streams (judge-error indicators), with two constructions whose
guarantees are deliberately never blurred: a fixed-null **e-process** where Ville's inequality
bounds the probability of *ever* false-alarming over an unbounded horizon by α, and a
changepoint **e-detector** (e-CUSUM style) that trades that for an average-run-length-to-false-
alarm bound ≥ 1/α in exchange for retained sensitivity to late changes. A λ-grid mixture
replaces hyperparameter tuning (a mixture of supermartingales is a supermartingale). Classical
Page CUSUM ships alongside as the explicitly-weaker disclosed baseline. Monitor state is plain
serializable data, so a run can be persisted, resumed, and replayed from the observation log.

**4. Headline claims are gated by evidence, and can fail.** "Switch model X to model Y, save
97% at equal quality" is a point comparison of aggregate means — not evidence. `stats.ts` runs
an exact two-sided **McNemar test** on *paired* per-task outcomes and marks the switch **not
defensible** when the cheaper candidate is significantly worse, regardless of how good the cost
delta looks. "No detected loss" is reported as exactly that and never upgraded to "equal".
Similarly, the Pass^k point estimate gets a certified Clopper–Pearson floor, with the i.i.d.-runs
assumption stated in the output.

**5. Ordinal vs cardinal reliability are separated.** `rank-score.ts` measures Kendall's tau-b
between judge scores and reference quality *and* the empirical width of the score→quality
residual interval. A judge frequently ranks well while its absolute numbers are noise; that is
precisely the regime where "use the ordering, distrust the magnitude" is the correct guidance,
and it is invisible to ECE alone.

**6. Determinism as an architectural constraint.** Canonical JSON (sorted keys, RFC-8785-style)
plus SHA-256 content addressing for the corpus and the report. No RNG and no wall clock anywhere
in the analysis path — the only injected non-determinism is the report timestamp, which is
recorded rather than computed from. Same frozen corpus plus same frozen panel produces a
byte-identical report, which is what makes third-party reproduction possible at all.

**7. Fail-closed data egress.** `egress.ts` refuses to release any artifact whose serialization
contains a raw model output, a raw prompt, or a credential-shaped string. The end-to-end golden
test deliberately plants a PII-leaking model output in the corpus and asserts it cannot reach
the exported deliverable.

**8. Signed, offline-verifiable artifacts.** `bundle.ts` produces a detached Ed25519 signature
over the canonical `{documentHash, markdownHash}` payload. Verification re-derives everything
with no network and fails closed with named reasons (document-hash mismatch, markdown tamper,
payload swap, signature failure, unknown key id). Ed25519 is used because RFC 8032 signatures
are deterministic, keeping bundles byte-stable. Signer and verifier are injected ports — the
harness ships no key.

**9. Ports all the way down.** `Gateway`, `Judge`, `GroundTruth`, `BundleSigner`/`BundleVerifier`,
`fetchImpl`, and the clock are all injected. That is why the entire test suite runs in a few
seconds with no model, key, or network, and why the property tests (`fast-check`) can hammer the
certificate math directly.

---

## Architecture

The engine is a single pure pipeline over injected ports. In the deployment it was written for,
everything ran inside the client's own network boundary; only derived numbers crossed out.

```
  client environment (their keys, their data)
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
     v  scores, metrics, frontier, report, policy — nothing raw
```

Three boundaries are enforced in code rather than promised in prose:

- **No key.** The production gateway takes a key *accessor* invoked per request; the key is never
  stored on the adapter, never logged, and scrubbed from every error the module can throw.
- **No fabricated cost.** If the endpoint reports no cost (OpenRouter `usage.cost` or LiteLLM's
  `x-litellm-response-cost` header), the adapter throws instead of defaulting to `0` — a zero
  would silently flatter every candidate's position on the frontier.
- **No write.** Nothing in the codebase accepts a write or checkout credential; the governance
  overlay reports least-privilege gaps and never mutates anything.

## Repo layout

Single package, no workspaces. All source is in `src/`, one module per pipeline stage.

| Module | What it does |
|---|---|
| `corpus.ts` | Freezes and content-addresses the task set, rubric, and human labels; derives ground truth (unlabeled outputs are conservatively not-accepted) |
| `gateway.ts` | The `Gateway` port plus `StubGateway`, a fixture map that can vary output per trial to exercise run-to-run variance |
| `gateway-openai-compat.ts` | Production adapter for any OpenAI-compatible chat-completions endpoint, behind a host allowlist checked before every call |
| `metrics.ts` | ECE, Brier, reliability table — the judge's own calibration |
| `reliability.ts` | Unbiased combinatorial Pass^k estimator (probability a random k-subset of observed runs all pass) |
| `frontier.ts` | Pareto frontier over quality × cost × latency; cheapest candidate at equal-or-better measured quality |
| `conformal.ts` | Exact Clopper–Pearson bounds; certified abstention threshold via fixed-sequence Learn-Then-Test |
| `stats.ts` | Exact McNemar gate on paired outcomes; certified Pass^k lower bound |
| `drift.ts` | E-process (Ville), changepoint e-detector (ARL), CUSUM baseline over bounded error streams |
| `aci.ts` | Adaptive conformal intervals (Gibbs–Candès) for forecast bands on short series; abstains when history is too short |
| `rank-score.ts` | Kendall tau-b + cardinal interval width — ordinal vs cardinal judge reliability |
| `ensemble.ts` | Multi-judge majority vote (ties resolve to FAIL) with inter-judge disagreement disclosed as a first-class signal |
| `governance.ts` | Read-only agent → task → scope least-privilege gap map |
| `report.ts` | Content-addressed report document + deterministic markdown render; certificate blocks are optional and additive |
| `router-policy.ts` | Portable, vendor-neutral routing policy export (cheapest model clearing the quality floor, frontier as fallbacks) |
| `bundle.ts` | Ed25519-signed report bundle + fail-closed offline verification |
| `egress.ts` | Fail-closed guard: no raw output, prompt, or credential-shaped string may leave |
| `canonical.ts` | Canonical JSON + SHA-256 content hashing — the reproducibility primitive |
| `harness.ts` | `runAudit` — pure orchestration over the injected ports |
| `cli.ts`, `bin.ts` | Offline runner over a captured results bundle |
| `index.ts` | Public surface |

`test/` mirrors `src/` one-to-one, plus `golden-fs.test.ts` (a full end-to-end deterministic
regression on a finance-shaped fixture) and `certificates.property.test.ts` (property tests over
the certificate math via `fast-check`). `fixtures/calibration-contract.golden.json` pins the
calibration math against a sibling implementation — see below.

## Quickstart

Requires Node 24 (`engines: >=24 <25`, pinned by `.node-version`) and pnpm 9 or 10
(`lockfileVersion: 9.0`).

```bash
pnpm install --frozen-lockfile
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run  -> 20 files, 160 tests
pnpm lint        # eslint .
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

Those five commands, in that order, are exactly what CI runs (`.github/workflows/ci.yml`). The
package is `private: true` and was consumed from source in-repo, so `tsc --noEmit` is the real
compile gate; `pnpm build` exists so the CLI below can actually be run.

### Run the example audit

A complete input bundle ships in `examples/credit-memo/`:

```bash
pnpm build
node dist/bin.js examples/credit-memo out/
```

That writes `report.json`, `report.md`, `router-policy.json`, and `governance.json` to `out/`.
The report is deterministic — it comes out with
`documentHash: sha256:91f91ffe93aca39e2b031feb3007e83104c08a8b78df8fdd77f63c068df8be42` every
time — and reads:

```
## Judge reliability (the number's own error bars)
- ECE: 0.1 · Brier: 0.01 · sample: 12

## Efficiency frontier — equal-quality savings
- credit_memo: switch frontier → thrifty, save 96.7% at equal-or-better measured quality

## Run-to-run reliability exposure (Pass^k)
- budget: worst-case Pass^k = 0.25 (inconsistent across runs)
- frontier: worst-case Pass^k = 1
- thrifty: worst-case Pass^k = 1
```

Note what the numbers do. `budget` is 10× cheaper than `frontier` but failed one of its four
recorded runs, so its Pass^3 drops to 0.25 and it is not recommended. `thrifty` held quality
exactly at 1/30th the cost, so it is. The raw task input (`Summarize creditworthiness for
applicant 4821`) and the raw model outputs appear nowhere in the written artifacts — the egress
guard runs before anything is written.

The CLI is offline by construction: the panel run is supplied as captured fixtures in
`panel.json`, and the judge verdicts in `judge.json`. It calls no model itself. Note that
`package.json` declares no `bin` field, so there is no installable `audit` command — invoke the
built entry point directly as above.

### Using it as a library

The same audit through the API. It runs against `StubGateway`, so it touches no network:

```ts
import {
  freezeCorpus, panelCorpus, groundTruthFrom, runAudit, StubGateway,
  buildReportDocument, renderMarkdown, exportRouterPolicy,
  type CorpusSpec, type Judge,
} from "./src/index.js";

const GOOD = "Adequate coverage; approval reasonable with covenants.";
const BAD = "idk approve i guess";

const corpus: CorpusSpec = {
  rubric: { id: "fs-credit-qa", version: "1", criteria: ["accurate", "policy-compliant"] },
  tasks: [{
    taskId: "memo-1",
    family: "credit_memo",
    input: "Summarize creditworthiness for applicant 4821",
    labels: [{ output: GOOD, accept: true }, { output: BAD, accept: false }],
  }],
};

const frozen = freezeCorpus(corpus);           // -> content-addressed
const gateway = new StubGateway({              // captured panel run, per trial
  frontier: { costUsd: 0.03,  latencyMs: 1400, outputs: { "memo-1": [GOOD, GOOD, GOOD, GOOD] } },
  budget:   { costUsd: 0.003, latencyMs: 400,  outputs: { "memo-1": [GOOD, GOOD, BAD,  GOOD] } },
  thrifty:  { costUsd: 0.001, latencyMs: 300,  outputs: { "memo-1": [GOOD, GOOD, GOOD, GOOD] } },
});
const judge: Judge = { judge: (_taskId, output) => ({ pass: output === GOOD, confidence: 0.9 }) };

const report = await runAudit({
  corpus: panelCorpus(frozen),
  models: ["frontier", "budget", "thrifty"],
  gateway,
  judge,
  groundTruth: groundTruthFrom(frozen),
  trialsPerTask: 4,
  passK: 3,
  currentModel: "frontier",
});

report.judgeReliability.ece;              // 0.0999...  (judge calibration, reported first)
report.passK;                             // budget: passHatK 0.25 — 3/4 runs passed, Pass^3 is 0.25
report.families[0].recommendation;        // { fromId: "frontier", toId: "thrifty",
                                          //   savingsPct: 0.9666..., qualityDelta: 0 }

const doc = buildReportDocument(report, {
  client: "Example Bank",
  corpusHash: frozen.contentHash,
  panel: ["frontier", "budget", "thrifty"],
  generatedAt: "2026-06-30T00:00:00.000Z",
});
doc.documentHash;                         // sha256:91f91ffe...  stable across runs
renderMarkdown(doc);                      // deterministic markdown
exportRouterPolicy(report, 0.9);          // { policyVersion: "neutral-route/1", routes: [...] }
```

To make that recommendation *defensible* rather than merely observed, additionally pass the
paired per-task outcomes through `verifySwitchQuality` in `stats.ts`, and feed the result into
`buildReportDocument`'s optional third `evidence` argument.

## Honest limits

- **No LLM judge is included.** `Judge` is an interface. Sigil scores whatever judge you hand it;
  it does not provide one. The same is true of ground truth — that is human labels, supplied.
- **The production gateway has never run against a live endpoint here.** `gateway-openai-compat.ts`
  is fully implemented and tested against an injected `fetchImpl`, but every test in this repo
  uses fixtures by hard rule, so its behavior against a real LiteLLM or OpenRouter deployment is
  unverified in-repo. Using it requires a client-supplied API key and an explicit host allowlist.
- **The planned dependency on the upstream calibration package was never wired.** `metrics.ts`
  deliberately *mirrors* the canonical ECE/Brier math (including its floating-point bin-edge
  behavior) rather than importing it, pinned by `fixtures/calibration-contract.golden.json`. If
  that contract test and the upstream's ever disagree, one side changed the math unilaterally —
  which is the failure the contract exists to catch. It also means the golden fixture is a frozen
  manual copy, not a live check, and regenerating it requires the upstream repo.
- **Continuous / trend mode was never built.** `drift.ts` and `aci.ts` provide the machinery for
  ongoing monitoring, but there is no scheduler, no persistence layer, and no service around
  them. Monitor state is serializable; nothing serializes it for you.
- **`drift.ts` was never cross-validated against an external reference implementation.** Checking
  it against CRAN `stcpR6` outputs as golden fixtures was an open task at archive time. The
  guarantees are argued in the module docs and property-tested internally, not externally
  corroborated.
- **Statistical validity has stated preconditions.** The abstention certificate assumes
  exchangeability between the calibration and deployment draws — drift breaks it, which is why
  re-certification was designed as a recurring cadence. `certifiedPassKLowerBound` assumes i.i.d.
  runs. The ACI guarantee is long-run average coverage; locally it can under-cover, and the
  implementation clamps the adaptive level to [0.001, 0.999] to keep intervals finite, trading a
  corner of the asymptotic argument for bounded artifacts. Each of these is stated in the output,
  not just the docs.
- **Small samples give wide bounds, and that is the intended behavior.** A wide interval is
  reported as a finding. When nothing certifies at the requested level, the certificate says so
  explicitly instead of returning a number.
- **The commercial plan behind this code was never executed.** No engagement ever ran; no design
  partner was ever secured. The original product-requirements and market-research documents were
  removed before archiving, since they were an unexecuted business plan rather than engineering
  documentation. What is left — `ARCHITECTURE.md`, `TRD.md`, `BACKLOG.md` — is the technical
  record. The regulatory framing that survives in the module docs (SR 11-7 / SR 26-2) is there to
  explain *why* the code is shaped this way, not as legal advice or a compliance claim.

## Where this sat in the Apature stack

Apature was a GitHub-native AI design reviewer: it screenshotted a pull request's preview deploy,
critiqued the rendered UI against the repo's own design system with a vision-language model, and
posted an annotated review. Its boundary was that it judged and verified but never edited code or
drove the UI.

Sigil is the odd one out. It was built as a deliberately standalone, neutral measurement engine
and **imports nothing from any sibling repo** — the whole argument for it was that an audit
cannot be independent if the auditor also sells you the thing being audited. Its only connection
to the rest of the stack is a *contract*, not a dependency: the ECE/Brier/reliability math in
`metrics.ts` mirrors the canonical implementation that lives in
[judgment-engine](https://github.com/apatureai/judgment-engine), pinned by a copied golden
fixture so the two can never silently diverge.

The other Apature components are published separately, each with its own README:
[judgment-engine](https://github.com/apatureai/judgment-engine),
[gate](https://github.com/apatureai/gate),
[ui-graph](https://github.com/apatureai/ui-graph),
[ui-dna](https://github.com/apatureai/ui-dna),
[entropy-engine](https://github.com/apatureai/entropy-engine), and
[mcp-review](https://github.com/apatureai/mcp-review).

Additional design documents kept in this repo: `ARCHITECTURE.md` (boundaries, deployment modes,
and the statistical design rationale), `TRD.md` (per-module contracts and stated failure modes),
`BACKLOG.md` (what shipped and what did not).

## Prior work

The statistical machinery follows published lines rather than inventing any: split conformal
prediction and Learn-Then-Test risk control (Angelopoulos, Bates et al.); selective classification
with a reject option (Geifman & El-Yaniv); betting supermartingales and e-detectors
(Waudby-Smith & Ramdas; Shin, Ramdas & Rinaldo, arXiv:2203.03532); adaptive conformal inference
under distribution shift (Gibbs & Candès, NeurIPS 2021); Page's CUSUM; the exact McNemar test;
Clopper–Pearson intervals. The engineering contribution is putting them behind one deterministic,
reproducible, fail-closed audit contract — not the estimators themselves.

## License

MIT. See `LICENSE`.
