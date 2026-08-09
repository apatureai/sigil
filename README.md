# Sigil

**Archived — provided as-is, no updates expected.** Issues and pull requests are not monitored. Last verified working 2026-08-09 on macOS 15 + Node 24.14.0 + pnpm 10.34.3.

Sigil audits an AI evaluation: it measures how trustworthy your LLM judge is, then finds the cheapest model that holds measured quality.

## Why this exists

Sigil was built inside Apature, a venture-stage product that has been wound down, and is released
here under the MIT License. It was aimed at model-risk management at a regulated financial
institution — a team that must independently validate a vendor LLM it cannot open up — but nothing
in the code is finance-specific. It is a general-purpose, dependency-free measurement engine that
calls no model, holds no key, and opens no socket.

That neutrality was a design constraint rather than an accident: an audit produced by a company
that also sells you a model or a router is not an independent audit, so this engine was kept
structurally separate from everything else in the stack and has zero code dependency on any
sibling repo.

## What it does

- **Scores the judge before it scores anything else** — expected calibration error, Brier score,
  and a binned reliability table over human-labeled examples.
- **Certifies an abstention threshold** with exact Clopper–Pearson bounds and fixed-sequence
  Learn-Then-Test, or explicitly refuses to certify when the sample cannot support it.
- **Measures run-to-run reliability** with an unbiased combinatorial Pass^k estimator, plus a
  certified finite-sample floor.
- **Builds a Pareto frontier** over quality × cost × latency and names the cheapest candidate that
  holds measured quality.
- **Gates the savings claim on paired evidence** — an exact two-sided McNemar test marks a switch
  *not defensible* when the cheaper candidate is significantly worse, whatever the cost delta.
- **Monitors drift anytime-validly** with betting supermartingales: a fixed-null e-process
  (Ville's inequality) and a changepoint e-detector (ARL bound), with classical Page CUSUM as the
  disclosed weaker baseline.
- **Emits a deterministic, content-addressed report** — same inputs, byte-identical output — plus a
  vendor-neutral router policy and a read-only least-privilege governance map.
- **Signs and verifies bundles offline** with detached Ed25519 signatures, failing closed with
  named reasons.
- **Refuses to leak** — a fail-closed egress guard blocks any artifact whose serialization contains
  a raw model output, a raw prompt, or a credential-shaped string.

## What it does not do

- It does not include an LLM judge. `Judge` is an interface; you supply the judge and the human
  labels, Sigil scores them.
- It does not call a model, hold a key, or open a network socket. The panel run is captured
  upstream and supplied as data.
- It does not route traffic, edit code, or mutate anything on your estate. Every artifact it
  produces is derived facts only.
- It is not a scheduler or a service. See [Limitations](#limitations).

## Requirements

| Thing | Need | Check |
|---|---|---|
| Node | v24.x (`engines: >=24 <25`, pinned by `.node-version`) | `node -v  # need v24.x` |
| pnpm | 9 or 10 (`lockfileVersion: 9.0`) | `pnpm -v  # need 9.x or 10.x` |
| OS | verified on macOS 15 (Darwin 24.6.0); CI runs ubuntu-latest | — |

If pnpm is missing: `corepack enable pnpm` (ships with Node), or `npm install -g pnpm`.

**No credentials, no API keys, no network access are needed for anything in this README.** Sigil
reads no environment variables at all (`grep -rn "process.env" src/` returns only `process.argv`).
Dependencies are pinned, `pnpm-lock.yaml` is committed, and every command below installs with
`--frozen-lockfile`.

The quickstart needs Node 24 specifically for one reason beyond `engines`: the library example is a
`.ts` file run directly by Node's native type stripping.

## Install

From the repo root, on a clean clone:

```
pnpm install --frozen-lockfile
pnpm build
```

`pnpm build` is part of installing, not an optional extra: `tsconfig.json` sets `noEmit: true`
(so `pnpm typecheck` is the real compile gate), and the CLI runs from the emitted `dist/`.

Transcript:

```
$ pnpm install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Packages: +132
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Progress: resolved 132, reused 131, downloaded 0, added 132, done

devDependencies:
+ @eslint/js 10.0.1
+ @types/node 26.1.1
+ eslint 10.7.0
+ fast-check 4.9.0
+ typescript 6.0.3
+ typescript-eslint 8.64.0
+ vitest 4.1.10

Done in 551ms using pnpm v10.34.3

$ pnpm build

> sigil@0.0.0 build /path/to/sigil
> tsc -p tsconfig.build.json

```

## Quickstart

Run the shipped audit. `examples/credit-memo/` is a complete synthetic input bundle — a frozen
corpus with human labels, a captured three-model panel run, and captured judge verdicts. No
credentials, no network.

```
node dist/bin.js examples/credit-memo out/
cat out/report.md
```

Transcript:

```
$ node dist/bin.js examples/credit-memo out/
wrote report.{json,md}, router-policy.json, governance.json to out/

$ cat out/report.md
# Independent AI Quality & Efficiency Assurance — Example Bank

- Corpus: `sha256:d0483ca33ca972f0651497eaa07e4c8d21abdc3c9743f9b92e9637ce39a974e1`
- Panel: frontier, budget, thrifty
- Generated: 2026-06-30T00:00:00.000Z
- Document hash: `sha256:91f91ffe93aca39e2b031feb3007e83104c08a8b78df8fdd77f63c068df8be42`

## Judge reliability (the number's own error bars)
- ECE: 0.1 · Brier: 0.01 · sample: 12

## Efficiency frontier — equal-quality savings
- **credit_memo**: switch frontier → thrifty, save 96.7% at equal-or-better measured quality

## Run-to-run reliability exposure (Pass^k)
- budget: worst-case Pass^k = 0.25 (inconsistent across runs)
- frontier: worst-case Pass^k = 1
- thrifty: worst-case Pass^k = 1
```

**Success criterion:** `out/` contains four files — `report.json`, `report.md`,
`router-policy.json`, `governance.json` — and the document hash printed above is exactly
`sha256:91f91ffe93aca39e2b031feb3007e83104c08a8b78df8fdd77f63c068df8be42`. That hash is
content-addressed over the whole report, so matching it means your run reproduced the audit
byte-for-byte.

If `node dist/bin.js` reports `Cannot find module`, you skipped `pnpm build`.

### Reading the result

The numbers are the point of the exercise:

- `budget` costs 10× less than `frontier`, but it failed one of its four recorded runs, so its
  Pass^3 collapses to 0.25. It is **not** recommended, and the cost delta does not rescue it.
- `thrifty` held quality exactly, at 1/30th the cost of `frontier`. That is the recommendation.
- ECE 0.1 is reported *before* any savings claim. If the judge were badly calibrated, you would see
  that first rather than being sold a saving measured with a broken ruler.
- The raw task input (`Summarize creditworthiness for applicant 4821`) and the raw model outputs
  appear in **none** of the four written files. The egress guard runs before anything is written.

The other three artifacts:

```
$ cat out/router-policy.json
{
  "policyVersion": "neutral-route/1",
  "qualityFloor": 0.9,
  "routes": [
    {
      "family": "credit_memo",
      "primary": "thrifty",
      "fallbacks": []
    }
  ]
}

$ cat out/governance.json
[
  {
    "agentId": "credit-bot",
    "code": "excess_scope",
    "severity": "warning",
    "detail": "agent holds scopes no observed task requires (least-privilege gap)",
    "scopes": [
      "read:ssn"
    ]
  }
]
```

`report.json` is the same content as `report.md` in structured form, ending in the `documentHash`.

## Usage

### CLI

```
node dist/bin.js <bundle-dir> [out-dir]
```

`out-dir` defaults to `<bundle-dir>/out`. Exit code `0` on success, `2` with a usage message when
`<bundle-dir>` is omitted, `1` on any failure (including an egress violation — the CLI writes
nothing at all in that case).

There is no `bin` field in `package.json` and the package was never published to npm, so there is
no installable `sigil` command. Invoke the built entry point directly, as above.

### The input bundle

A bundle directory contains four required JSON files and one optional one. To audit your own
system, copy `examples/credit-memo/` and replace the contents.

| File | Required | Contents |
|---|---|---|
| `config.json` | yes | Run configuration — see the table below |
| `corpus.json` | yes | `{ rubric, tasks[] }`; every task carries human `labels` of `{ output, accept }`. This is the frozen, content-addressed benchmark set, and the ground truth is derived from it (an unlabeled output is conservatively treated as not-accepted) |
| `panel.json` | yes | The captured panel run, per model: `{ costUsd, latencyMs, outputs: { [taskId]: string[] } }`. One array entry per trial, so run-to-run variance is expressible |
| `judge.json` | yes | Judge verdicts keyed by raw output string: `{ pass, confidence }`. An output with no verdict is treated as `{ pass: false, confidence: 0.5 }` |
| `governance.json` | no | `{ agents[], requirements[] }` for the least-privilege overlay. Omit it and the overlay returns `[]` |

### Configuration

Sigil reads **no environment variables**. All configuration is the `config.json` in the bundle:

| Field | Required | Default | Effect |
|---|---|---|---|
| `client` | yes | — | Name printed in the report header |
| `models` | yes | — | The candidate panel; must match the keys in `panel.json` |
| `trialsPerTask` | yes | — | How many recorded trials per task to consume |
| `passK` | yes | — | The `k` in Pass^k — the reliability question is "would `k` independent runs all pass?" |
| `currentModel` | yes | — | The incumbent the switch recommendation is measured against |
| `qualityFloor` | yes | — | Minimum measured quality a model must clear to be the primary route in the exported policy |
| `generatedAt` | yes | — | ISO timestamp recorded in the report. Supplied rather than read from the clock, so runs stay byte-identical |

### As a library

The same audit through the API. Save this as `example.ts` in the repo root and run it with
`node example.ts` — Node 24 strips the type annotations natively, and `./dist/index.js` exists
because Install ended with `pnpm build`. `.gitignore` covers `example.ts` and `out/`, so this
leaves your tree clean.

```ts
import {
  freezeCorpus, panelCorpus, groundTruthFrom, runAudit, StubGateway,
  buildReportDocument, renderMarkdown, exportRouterPolicy,
  type CorpusSpec, type Judge,
} from "./dist/index.js";

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

const doc = buildReportDocument(report, {
  client: "Example Bank",
  corpusHash: frozen.contentHash,
  panel: ["frontier", "budget", "thrifty"],
  generatedAt: "2026-06-30T00:00:00.000Z",
});

console.log("ece:", report.judgeReliability.ece);
console.log("recommendation:", JSON.stringify(report.families[0].recommendation));
console.log("documentHash:", doc.documentHash);
console.log("policy:", JSON.stringify(exportRouterPolicy(report, 0.9)));
console.log("markdown lines:", renderMarkdown(doc).split("\n").length);
```

```
$ node example.ts
ece: 0.09999999999999976
recommendation: {"fromId":"frontier","toId":"thrifty","savingsPct":0.9666666666666667,"latencyDeltaMs":-1100,"qualityDelta":0}
documentHash: sha256:91f91ffe93aca39e2b031feb3007e83104c08a8b78df8fdd77f63c068df8be42
policy: {"policyVersion":"neutral-route/1","qualityFloor":0.9,"routes":[{"family":"credit_memo","primary":"thrifty","fallbacks":[]}]}
markdown lines: 17
```

Note the `documentHash` is identical to the CLI's. Same frozen corpus plus same frozen panel
produces the same report, whichever entry point you use.

To make that recommendation *defensible* rather than merely observed, pass the paired per-task
outcomes through `verifySwitchQuality` in `stats.ts` and feed the result into
`buildReportDocument`'s optional third `evidence` argument.

## Why it is technically interesting

Most eval harnesses report a number. Sigil's premise is that **an unqualified number is not
evidence**, and nearly every design decision follows from that.

**1. The measurement is itself measured.** Before any quality claim, `metrics.ts` scores the judge
against human labels: expected calibration error (does "0.8 confidence" hold ~80% of the time?),
Brier score, and a binned reliability table. A badly calibrated judge is surfaced, not hidden.

**2. Finite-sample guarantees, not asymptotics.** `conformal.ts` computes exact one-sided
Clopper–Pearson binomial bounds on the judge's error rate, and certifies an *abstention threshold*
via fixed-sequence Learn-Then-Test over a data-independent confidence grid: walk thresholds from
most to least conservative, test at each with the exact bound, stop at the first failure. The
family-wise guarantee survives because the tests are ordered a priori. The output is a sentence you
can file: *"on the X% of cases the judge accepts, its error rate is ≤ α with confidence 1−δ; the
rest go to human review."* Exact bounds were chosen over Gaussian intervals because audit sample
sizes are small — and when nothing certifies, the module **refuses** rather than returning an
uncertified threshold. Split conformal / LTT was chosen over full conformal because it needs only
the labeled corpus that is already frozen.

**3. Anytime-valid sequential monitoring.** `drift.ts` implements betting supermartingales over
bounded [0,1] observation streams (judge-error indicators), with two constructions whose guarantees
are deliberately never blurred: a fixed-null **e-process** where Ville's inequality bounds the
probability of *ever* false-alarming over an unbounded horizon by α, and a changepoint
**e-detector** (e-CUSUM style) that trades that for an average-run-length-to-false-alarm bound
≥ 1/α in exchange for retained sensitivity to late changes. A λ-grid mixture replaces
hyperparameter tuning (a mixture of supermartingales is a supermartingale). Classical Page CUSUM
ships alongside as the explicitly-weaker disclosed baseline. Monitor state is plain serializable
data, so a run can be persisted, resumed, and replayed from the observation log.

**4. Headline claims are gated by evidence, and can fail.** "Switch model X to model Y, save 97% at
equal quality" is a point comparison of aggregate means — not evidence. `stats.ts` runs an exact
two-sided **McNemar test** on *paired* per-task outcomes and marks the switch **not defensible**
when the cheaper candidate is significantly worse, regardless of how good the cost delta looks. "No
detected loss" is reported as exactly that and never upgraded to "equal". Similarly, the Pass^k
point estimate gets a certified Clopper–Pearson floor, with the i.i.d.-runs assumption stated in
the output.

**5. Ordinal vs cardinal reliability are separated.** `rank-score.ts` measures Kendall's tau-b
between judge scores and reference quality *and* the empirical width of the score→quality residual
interval. A judge frequently ranks well while its absolute numbers are noise; that is precisely the
regime where "use the ordering, distrust the magnitude" is the correct guidance, and it is
invisible to ECE alone.

**6. Determinism as an architectural constraint.** Canonical JSON (sorted keys, RFC-8785-style)
plus SHA-256 content addressing for the corpus and the report. No RNG and no wall clock anywhere in
the analysis path — the only injected non-determinism is the report timestamp, which is recorded
rather than computed from. Same frozen corpus plus same frozen panel produces a byte-identical
report, which is what makes third-party reproduction possible at all.

**7. Fail-closed data egress.** `egress.ts` refuses to release any artifact whose serialization
contains a raw model output, a raw prompt, or a credential-shaped string. The end-to-end golden
test deliberately plants a PII-leaking model output in the corpus and asserts it cannot reach the
exported deliverable.

**8. Signed, offline-verifiable artifacts.** `bundle.ts` produces a detached Ed25519 signature over
the canonical `{documentHash, markdownHash}` payload. Verification re-derives everything with no
network and fails closed with named reasons (document-hash mismatch, markdown tamper, payload swap,
signature failure, unknown key id). Ed25519 is used because RFC 8032 signatures are deterministic,
keeping bundles byte-stable. Signer and verifier are injected ports — the harness ships no key.

**9. Ports all the way down.** `Gateway`, `Judge`, `GroundTruth`, `BundleSigner`/`BundleVerifier`,
`fetchImpl`, and the clock are all injected. That is why the entire test suite runs in under a
second with no model, key, or network, and why the property tests (`fast-check`) can hammer the
certificate math directly.

## How it works

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

### Boundaries enforced in code, not prose

- **No key.** The production gateway takes a key *accessor* invoked per request; the key is never
  stored on the adapter, never logged, and is scrubbed from every error the module can throw.
- **No fabricated cost.** If the endpoint reports no cost (OpenRouter `usage.cost` or LiteLLM's
  `x-litellm-response-cost` header), the adapter throws instead of defaulting to `0` — a zero would
  silently flatter every candidate's position on the frontier.
- **No write.** Nothing in the codebase accepts a write or checkout credential; the governance
  overlay reports least-privilege gaps and never mutates anything.
- **Egress allowlist:** scores, calibration metrics, frontier, report, router policy. **Denylist:**
  raw outputs, prompts, keys, corpus content beyond hashes.

### Deployment modes it was designed for

1. **Customer environment** (the default): engine and gateway adapter both run inside the client
   boundary.
2. **Hosted** (non-regulated use only).
3. **Air-gapped signed-bundle exchange:** corpus and panel results exchanged as Ed25519-signed
   bundles, verified fully offline (`bundle.ts`).

### Directory map

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
the certificate math via `fast-check`). `examples/credit-memo/` is the synthetic input bundle used
by the quickstart. `fixtures/calibration-contract.golden.json` pins the calibration math against a
sibling implementation — see [Limitations](#limitations).

### Documented failure modes

- Incomplete labels → calibration runs over the labeled subset only; the report discloses the
  sample size.
- Nothing clears the quality floor → the router policy falls back to the highest-quality candidate,
  never silently dropping a family, and the report flags it.
- Judge poorly calibrated (high ECE) → surfaced before any savings claim, never hidden.
- No abstention threshold certifies the target risk → the certificate says so explicitly ("abstain
  or collect more labels"). A wide bound from a small sample is a finding, never rounded away.
- Candidate significantly worse on paired tasks → the switch recommendation is reported **not
  defensible** regardless of the cost delta.

## Development

```
pnpm install --frozen-lockfile
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run  -> Test Files 20 passed (20), Tests 160 passed (160)
pnpm lint        # eslint .
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

Those five commands, in that order, are exactly what CI runs (`.github/workflows/ci.yml`). All five
pass on a clean checkout, verified 2026-08-09 on Node 24.14.0 with pnpm 10.34.3.

Run a single test file:

```
pnpm vitest run test/golden-fs.test.ts
```

One rule matters if you change the code: **Sigil is offline and deterministic by construction, and
the tests enforce it.** No test may call a real model, key, or network — the live adapter
(`src/gateway-openai-compat.ts`) is exercised only through an injected `fetchImpl`. No wall clock
and no RNG in the analysis path; `test/golden-fs.test.ts` and `test/canonical.test.ts` will catch
you. And do not widen what crosses the egress line.

## Limitations

Everything below is a boundary of the contract, stated so you can decide whether this repo is
useful to you. Status values are exactly three: **Working**, **Partial**, **Not implemented**.

| Component | Status | Notes |
|---|---|---|
| Calibration metrics (ECE / Brier / reliability) | Working | Covered by tests and the quickstart |
| Risk certificates (Clopper–Pearson, Learn-Then-Test) | Working | Property-tested in `test/certificates.property.test.ts` |
| Pass^k reliability + certified floor | Working | Quickstart shows it rejecting a 10×-cheaper model |
| Pareto frontier + McNemar switch gate | Working | Quickstart shows both |
| Report, router policy, governance overlay | Working | Four artifacts written by the quickstart |
| Signed bundle + offline verification | Working | Signer/verifier are injected ports; the repo ships no key |
| Egress guard | Working | Golden test plants a PII leak and asserts it cannot escape |
| Drift monitors (e-process, e-detector, CUSUM) | Working | Never cross-validated against an external reference — see below |
| Adaptive conformal intervals (`aci.ts`) | Working | Abstains when the history is too short |
| CLI over a captured bundle | Working | `node dist/bin.js <bundle-dir> [out-dir]` |
| Live gateway adapter (`gateway-openai-compat.ts`) | Partial | Fully implemented and tested against an injected `fetchImpl`; never exercised against a live LiteLLM or OpenRouter endpoint from this repo |
| Continuous / trend mode | Not implemented | `drift.ts` and `aci.ts` are the machinery; there is no scheduler, persistence layer, or service. Monitor state is plain serializable data — the seam is `EProcess`/`EDetector` state in `src/drift.ts`, and you serialize it |
| Upstream calibration import | Not implemented | `metrics.ts` deliberately *mirrors* the canonical ECE/Brier math instead of importing it, pinned by `fixtures/calibration-contract.golden.json`. If the contract test and the upstream ever disagree, one side changed the math unilaterally — which is the failure the contract exists to catch. The fixture is a frozen manual copy, not a live check |
| External cross-validation of `drift.ts` | Not implemented | Checking it against CRAN `stcpR6` outputs as golden fixtures was open at archive time. The guarantees are argued in the module docs and property-tested internally, not externally corroborated |
| Anchor-set drift attribution (system vs judge) | Not implemented | Out of scope; it would sit on top of `drift.ts` with a rotate-with-overlap anchor refresh policy |
| An LLM judge | Out of scope | `Judge` is an interface. Sigil scores whatever judge you hand it, and the same is true of ground truth — that is human labels, supplied |
| An installable `sigil` command | Out of scope | The package is `private: true` and was never published to npm. Run `node dist/bin.js` |

Further caveats:

- **Statistical validity has stated preconditions.** The abstention certificate assumes
  exchangeability between the calibration and deployment draws — drift breaks it, which is why
  re-certification was designed as a recurring cadence. `certifiedPassKLowerBound` assumes i.i.d.
  runs. The ACI guarantee is long-run average coverage; locally it can under-cover, and the
  implementation clamps the adaptive level to [0.001, 0.999] to keep intervals finite, trading a
  corner of the asymptotic argument for bounded artifacts. Each of these is stated in the output,
  not just here.
- **Small samples give wide bounds, and that is the intended behavior.** A wide interval is
  reported as a finding. When nothing certifies at the requested level, the certificate says so
  explicitly instead of returning a number.
- **The commercial plan behind this code was never executed.** No engagement ever ran. The
  regulatory framing that survives in the module docs (SR 11-7 / SR 26-2) explains *why* the code
  is shaped the way it is; it is not legal advice or a compliance claim.

## Prior work

The statistical machinery follows published lines rather than inventing any: split conformal
prediction and Learn-Then-Test risk control (Angelopoulos, Bates et al.); selective classification
with a reject option (Geifman & El-Yaniv); betting supermartingales and e-detectors (Waudby-Smith &
Ramdas; Shin, Ramdas & Rinaldo, arXiv:2203.03532); adaptive conformal inference under distribution
shift (Gibbs & Candès, NeurIPS 2021); Page's CUSUM; the exact McNemar test; Clopper–Pearson
intervals. The engineering contribution is putting them behind one deterministic, reproducible,
fail-closed audit contract — not the estimators themselves.

## Where this sat in the Apature stack

Apature was a GitHub-native AI design reviewer: it screenshotted a pull request's preview deploy,
critiqued the rendered UI against the repo's own design system with a vision-language model, and
posted an annotated review. Its boundary was that it judged and verified but never edited code or
drove the UI.

Sigil is the odd one out. It was built as a deliberately standalone, neutral measurement engine and
imports nothing from any sibling repo — the whole argument for it was that an audit cannot be
independent if the auditor also sells you the thing being audited. Its only connection to the rest
of the stack is a *contract*, not a dependency: the ECE/Brier/reliability math in `metrics.ts`
mirrors the canonical implementation that lived in a sibling repo, `judgment-engine`, pinned by a
copied golden fixture so the two can never silently diverge. The other components — `gate`,
`ui-graph`, `ui-dna`, `entropy-engine`, `mcp-review` — are separate repositories, each with its own
README.

## Contributing

This repository is archived. Pull requests are not accepted and issues are not monitored. Forking
is the intended path: the MIT License lets you take this code, rename it, change it, and ship it
without asking. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

No credentials, keys, or secrets are stored in this repository, and the code opens no sockets. The
project is archived, so there is no security-response process; report handling and the threat
boundary are described in [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
