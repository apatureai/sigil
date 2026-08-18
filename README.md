# Sigil

[![CI](https://img.shields.io/github/actions/workflow/status/apatureai/sigil/ci.yml?branch=main&label=CI)](https://github.com/apatureai/sigil/actions/workflows/ci.yml) [![license](https://img.shields.io/github/license/apatureai/sigil?color=blue)](https://github.com/apatureai/sigil/blob/main/LICENSE) [![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](#requirements)

**Error bars for LLM-as-judge evals: calibration, finite-sample risk certificates, and anytime-valid drift monitoring, in dependency-free TypeScript.**

If you use a model to grade another model's output, you have a ruler you have never measured.
Sigil measures it. Give it your judge's verdicts, a set of human-labeled examples, and a captured
run of the models you are comparing, and it will tell you how well calibrated the judge is, what
confidence threshold you can defensibly abstain at, how reliable each model is across repeated
runs, and which cheaper model actually holds quality once a paired significance test has had its
say.

It is a pure measurement engine. It calls no model, holds no key, and opens no socket. You supply
the judge and the labels; Sigil scores them and emits a byte-reproducible report.

```
pnpm install --frozen-lockfile && pnpm build
node dist/bin.js examples/credit-memo out/ && cat out/report.md
```

## Who this is for

- **People running LLM-as-judge eval pipelines in Node** who need calibration numbers with error
  bars rather than a single accuracy figure.
- **Anyone shipping selective prediction** who is currently choosing an abstention threshold by
  intuition and wants one with a finite-sample guarantee attached.
- **Teams doing model-cost work** who need "switch to the cheaper model" to be an evidenced claim
  rather than a comparison of two averages.
- **JS/TS people locked out of the stats ecosystem.** Conformal prediction, e-processes and
  sequential testing are almost entirely Python and R. This is one of very few JavaScript
  implementations, and it has zero runtime dependencies.

Sigil is deliberately vendor-neutral: it has no opinion about which model you should use and no
code path that could profit from the answer.

## Why it is technically interesting

Most eval harnesses report a number. Sigil's premise is that **an unqualified number is not
evidence**, and nearly every design decision follows from that.

**1. The measurement is itself measured.** Before any quality claim, `metrics.ts` scores the judge
against human labels: expected calibration error (does "0.8 confidence" hold about 80% of the
time?), Brier score, and a binned reliability table. A badly calibrated judge is surfaced, not
hidden.

**2. Finite-sample guarantees, not asymptotics.** `conformal.ts` computes exact one-sided
Clopper-Pearson binomial bounds on the judge's error rate, and certifies an *abstention threshold*
via fixed-sequence Learn-Then-Test over a data-independent confidence grid: walk thresholds from
most to least conservative, test at each with the exact bound, stop at the first failure. The
family-wise guarantee survives because the tests are ordered a priori. The output is a sentence you
can file: *"on the X% of cases the judge accepts, its error rate is at most alpha with confidence
1 minus delta; the rest go to human review."* Exact bounds were chosen over Gaussian intervals
because audit sample sizes are small. When nothing certifies, the module **refuses** rather than
returning an uncertified threshold. Split conformal plus LTT was chosen over full conformal because
it needs only the labeled corpus you already have.

**3. Anytime-valid sequential monitoring.** `drift.ts` implements betting supermartingales over
bounded [0,1] observation streams (judge-error indicators), with two constructions whose guarantees
are deliberately never blurred: a fixed-null **e-process** where Ville's inequality bounds the
probability of *ever* false-alarming over an unbounded horizon by alpha, and a changepoint
**e-detector** (e-CUSUM style) that trades that for an average-run-length-to-false-alarm bound of
at least 1/alpha in exchange for retained sensitivity to late changes. A lambda-grid mixture
replaces hyperparameter tuning (a mixture of supermartingales is a supermartingale). Classical Page
CUSUM ships alongside as the explicitly weaker disclosed baseline. Monitor state is plain
serializable data, so a run can be persisted, resumed, and replayed from the observation log.

**4. Headline claims are gated by evidence, and can fail.** "Switch model X to model Y, save 97% at
equal quality" is a point comparison of aggregate means, not evidence. `stats.ts` runs an exact
two-sided **McNemar test** on *paired* per-task outcomes and marks the switch **not defensible**
when the cheaper candidate is significantly worse, regardless of how good the cost delta looks. "No
detected loss" is reported as exactly that and never upgraded to "equal". Similarly, the Pass^k
point estimate gets a certified Clopper-Pearson floor, with the i.i.d.-runs assumption stated in
the output.

**5. Ordinal and cardinal reliability are separated.** `rank-score.ts` measures Kendall's tau-b
between judge scores and reference quality *and* the empirical width of the score-to-quality
residual interval. A judge frequently ranks well while its absolute numbers are noise; that is
precisely the regime where "use the ordering, distrust the magnitude" is the correct guidance, and
it is invisible to ECE alone.

**6. Determinism as an architectural constraint.** Canonical JSON (sorted keys, RFC-8785 style)
plus SHA-256 content addressing for the corpus and the report. No RNG and no wall clock anywhere in
the analysis path; the only injected non-determinism is the report timestamp, which is recorded
rather than read from a clock. The same frozen corpus plus the same frozen panel produces a
byte-identical report, which is what makes third-party reproduction possible at all.

**7. Fail-closed data egress.** `egress.ts` refuses to release any artifact whose serialization
contains a raw model output, a raw prompt, or a credential-shaped string. The end-to-end golden
test deliberately plants a PII-leaking model output in the corpus and asserts it cannot reach the
exported deliverable.

**8. Signed, offline-verifiable artifacts.** `bundle.ts` produces a detached Ed25519 signature over
the canonical `{documentHash, markdownHash}` payload. Verification re-derives everything with no
network and fails closed with named reasons (document-hash mismatch, markdown tamper, payload swap,
signature failure, unknown key id). Ed25519 is used because RFC 8032 signatures are deterministic,
keeping bundles byte-stable. Signer and verifier are injected ports; the repo ships no key.

**9. Ports all the way down.** `Gateway`, `Judge`, `GroundTruth`, `BundleSigner`/`BundleVerifier`,
`fetchImpl`, and the clock are all injected. That is why the whole test suite runs in under three
seconds with no model, key, or network, and why the property tests (`fast-check`) can hammer the
certificate math directly.

## Requirements

| Thing | Need | Check |
|---|---|---|
| Node | 24 or newer (`engines: >=24`; `.node-version` pins 24, which is what CI and every verification run used) | `node -v` |
| pnpm | 9 or 10 (`lockfileVersion: 9.0`) | `pnpm -v` |
| OS | verified on macOS 15 (Darwin 24.6.0); CI runs ubuntu-latest | n/a |

If pnpm is missing: `corepack enable pnpm` (ships with Node), or `npm install -g pnpm`.

**No credentials, no API keys, and no network access are needed for anything in this README.** Sigil
reads no environment variables at all; the only `process` use in `src/` is `argv`, `exit`, and
writes to stderr. Dependencies are pinned, `pnpm-lock.yaml` is committed, and every command below
installs with `--frozen-lockfile`.

Node 24 specifically is needed for one reason beyond `engines`: the library example below is a `.ts`
file run directly by Node's native type stripping.

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

Done in 804ms using pnpm v10.34.3

$ pnpm build

> @apatureai/sigil@0.1.0 build /path/to/sigil
> tsc -p tsconfig.build.json

```

## Quickstart

Run the shipped audit. `examples/credit-memo/` is a complete synthetic input bundle holding a
frozen corpus with human labels, a captured three-model panel run, and captured judge verdicts. No
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

**Success criterion:** `out/` contains four files (`report.json`, `report.md`,
`router-policy.json`, `governance.json`), and the document hash printed above is exactly
`sha256:91f91ffe93aca39e2b031feb3007e83104c08a8b78df8fdd77f63c068df8be42`. That hash is
content-addressed over the whole report, so matching it means your run reproduced the audit
byte for byte.

If `node dist/bin.js` reports `Cannot find module`, you skipped `pnpm build`.

### Reading the result

The numbers are the point of the exercise:

- `budget` costs 10x less than `frontier`, but it failed one of its four recorded runs, so its
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

`out-dir` defaults to `<bundle-dir>/out`, which writes inside the bundle directory, so pass an
explicit out-dir if you want the output somewhere else. Exit code `0` on success, `2` with a usage
message when `<bundle-dir>` is omitted, `1` on any failure (including an egress violation, a bundle
asking for more trials than it captured, or a `passK` larger than the recorded runs, in which case
the CLI writes nothing at all).

The package is not on npm yet, so there is no globally installable `sigil` command; invoke the
built entry point directly, as above. The usage line it prints on exit `2` reads
`usage: audit <corpus-dir> [out-dir]`, using the tool's internal name. Publishing is on the
[roadmap](#status-and-roadmap).

### The input bundle

A bundle directory contains four required JSON files and one optional one. To audit your own
system, copy `examples/credit-memo/` and replace the contents.

| File | Required | Contents |
|---|---|---|
| `config.json` | yes | Run configuration; see the table below |
| `corpus.json` | yes | `{ rubric, tasks[] }`; every task carries human `labels` of `{ output, accept }`. This is the frozen, content-addressed benchmark set, and the ground truth is derived from it (an unlabeled output is conservatively treated as not-accepted) |
| `panel.json` | yes | The captured panel run, per model: `{ costUsd, latencyMs, outputs: { [taskId]: string[] } }`. One array entry per **distinct recorded trial**, so run-to-run variance is expressible. Every `(model, taskId)` must hold at least `trialsPerTask` entries; see below |
| `judge.json` | yes | Judge verdicts keyed by raw output string: `{ pass, confidence }`. An output with no verdict is treated as `{ pass: false, confidence: 0.5 }` |
| `governance.json` | no | `{ agents[], requirements[] }` for the least-privilege overlay. Omit it and the overlay returns `[]` |

### Configuration

Sigil reads **no environment variables**. All configuration is the `config.json` in the bundle:

| Field | Required | Effect |
|---|---|---|
| `client` | yes | Name printed in the report header |
| `models` | yes | The candidate panel; must match the keys in `panel.json` |
| `trialsPerTask` | yes | How many recorded trials per task to consume. It may not exceed the shortest series in `panel.json`; the CLI refuses the bundle rather than repeat a recorded output (see [Asking for more trials than were captured](#asking-for-more-trials-than-were-captured)) |
| `passK` | yes | The `k` in Pass^k. The reliability question is "would `k` independent runs all pass?" It may not exceed `trialsPerTask`, because the estimator needs at least `k` observed runs; the CLI refuses the bundle rather than leave the pairs unmeasured (see [Asking for a Pass^k the capture cannot answer](#asking-for-a-passk-the-capture-cannot-answer)) |
| `currentModel` | yes | The incumbent the switch recommendation is measured against |
| `qualityFloor` | yes | Minimum measured quality a model must clear to be the primary route in the exported policy |
| `generatedAt` | yes | ISO timestamp recorded in the report. Supplied rather than read from the clock, so runs stay byte-identical |

### Asking for more trials than were captured

`trialsPerTask` names how many recorded trials to consume. It used to be allowed to exceed what
`panel.json` holds: the stub gateway replayed the last recorded output for every extra trial and the
harness counted each replay as a sample. On the shipped `examples/credit-memo` bundle, raising
`trialsPerTask` from 4 to 8 turned 12 real judgements into `sample: 24` and lifted the budget
model's worst-case Pass^3 from 0.25 to 0.625, at exit 0, with no warning, on a document that was
content-addressed and signable.

A replay is not evidence. It is the same recorded string handed back again, so it adds no
information about anything, and Pass^k in particular reads agreement between copies of one output
as consistency across runs. Both halves of the path now refuse it:

- **The CLI refuses the bundle.** `runBundleAudit` throws before building any document, naming each
  short `(model, task)` pair and the `trialsPerTask` value that would be honest. The process exits
  `1` and writes nothing, so no partial report can be picked up without the reason it was rejected.
  The missing trials are obtained by re-running the panel, never by repeating a recorded output.

  ```
  $ node dist/bin.js ./bundle-asking-for-8
  audit refused: bundle asks for trialsPerTask 8 but the captured panel holds fewer for 3
  (model, task) pairs: budget/memo-1 has 4, frontier/memo-1 has 4, thrifty/memo-1 has 4.
  Repeating a recorded output would inflate the sample size and Pass^k. Set trialsPerTask to 4
  or capture the missing trials.
  ```

- **The library counts only real trials and says what it dropped.** `runAudit` is usable with any
  gateway, so it degrades instead of throwing: a response flagged `replayed` is excluded from the
  judge's sample and from Pass^k, and `report.trialCoverage` records `realTrials`, `replayedTrials`
  and a per-`(model, task)` shortfall list. `buildReportDocument` carries that into the document as
  `trialCoverage` **only when the evidence fell short**, and `renderMarkdown` prints
  `INCOMPLETE EVIDENCE` next to the sample size plus a `## Trial coverage (INCOMPLETE)` section. A
  complete audit's document, and therefore its hash, is unchanged.

A custom `Gateway` should set `replayed: true` on any response that is not a distinct observation.
Omitting the field asserts that it is one.

### Asking for a Pass^k the capture cannot answer

The companion mistake. `passK` is the `k` in "would `k` independent runs all pass?", and the
unbiased estimator needs at least `k` observed runs, so a `(model, task)` holding fewer cannot be
estimated at all. It used to be skipped in silence: no row, no note. On the shipped
`examples/credit-memo` bundle, raising `passK` from 4 to 8 left the entire
`## Run-to-run reliability exposure (Pass^k)` section empty, at exit 0, on a content-addressed
document. The budget model's worst-case Pass^3 of 0.25, the one number in that report that rejects a
10x-cheaper model, simply disappeared, and a heading with no rows under it reads as "nothing to
flag".

Missing evidence is not a passing result, so both halves refuse it the same way they refuse a
replayed trial:

- **The CLI refuses the bundle**, naming each short pair and the `passK` that fits the capture,
  exits `1`, and writes nothing.

  ```
  $ node dist/bin.js ./bundle-asking-for-passk-8
  audit refused: bundle asks for Pass^8 but the captured panel holds fewer recorded runs for 3
  (model, task) pairs: budget/memo-1 has 4, frontier/memo-1 has 4, thrifty/memo-1 has 4. Pass^k
  over fewer than k runs is not a lower number, it is no measurement at all, and those pairs would
  leave the reliability table with no row and no reason. Set passK to at most 4 or capture the
  missing runs.
  ```

- **The library records what it could not measure.** `report.passKCoverage` gives `k`, the number of
  pairs `measured`, and every `unmeasured` pair with its recorded run count.
  `buildReportDocument` carries that into the document as `passKCoverage` **only when some pair was
  unmeasured**, and `renderMarkdown` prints `NOT MEASURED` plus a line per pair under the
  reliability heading. A fully measured audit's document, and therefore its hash, is unchanged.

### As a library

The same audit through the API. Save this as `example.ts` in the repo root and run it with
`node example.ts`. Node 24 strips the type annotations natively, and `./dist/index.js` exists
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

Note the `documentHash` is identical to the CLI's. The same frozen corpus plus the same frozen
panel produces the same report, whichever entry point you use.

To make that recommendation *defensible* rather than merely observed, pass the paired per-task
outcomes through `verifySwitchQuality` in `stats.ts` and feed the result into
`buildReportDocument`'s optional third `evidence` argument.

## What it does not do

- It does not include an LLM judge. `Judge` is an interface; you supply the judge and the human
  labels, Sigil scores them.
- It does not call a model, hold a key, or open a network socket in the analysis path. The panel run
  is captured upstream and supplied as data.
- It does not route traffic, edit code, or mutate anything on your estate. Every artifact it
  produces is derived facts only.
- It is not a scheduler or a service. See [Status and roadmap](#status-and-roadmap).

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
sibling implementation; see [Status and roadmap](#status-and-roadmap).

### Documented failure modes

- Incomplete labels: calibration runs over the labeled subset only, and the report discloses the
  sample size.
- Nothing clears the quality floor: the router policy falls back to the highest-quality candidate,
  never silently dropping a family, and the report flags it.
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

## Status and roadmap

Status values are exactly three: **Working**, **Partial**, **Planned**. Everything marked Planned is
a real gap today, described in enough detail to pick up.

### Working today

| Component | Notes |
|---|---|
| Calibration metrics (ECE / Brier / reliability) | Covered by tests and the quickstart |
| Risk certificates (Clopper-Pearson, Learn-Then-Test) | Property-tested in `test/certificates.property.test.ts` |
| Pass^k reliability + certified floor | Quickstart shows it rejecting a 10x-cheaper model |
| Pareto frontier + McNemar switch gate | Quickstart shows both |
| Report, router policy, governance overlay | Four artifacts written by the quickstart |
| Signed bundle + offline verification | Signer and verifier are injected ports; the repo ships no key |
| Egress guard | Golden test plants a PII leak and asserts it cannot escape |
| Drift monitors (e-process, e-detector, CUSUM) | Implemented and unit-tested; external cross-validation is a roadmap item below |
| Adaptive conformal intervals (`aci.ts`) | Abstains when the history is too short |
| CLI over a captured bundle | `node dist/bin.js <bundle-dir> [out-dir]` |

### Partial

**Live gateway adapter (`src/gateway-openai-compat.ts`).** Fully implemented and tested against an
injected `fetchImpl`, including the host allowlist, key scrubbing, and the throw-on-missing-cost
rule. It has never been run against a live LiteLLM or OpenRouter endpoint from this repo, so the
wire-level details (header names, error shapes, cost field placement per provider) are unverified
against a real server. **Good first contribution:** run it against your own endpoint, and send a
recorded-response fixture test for whatever needed fixing. The seam is `OpenAiCompatGatewayOptions`
in that module.

### Planned

**Continuous / trend mode.** `drift.ts` and `aci.ts` are the machinery, but there is no scheduler,
persistence layer, or service around them, so today drift monitoring is a library you drive
yourself. Monitor state is deliberately plain serializable data: `EProcessState` and `EDetectorState`
in `src/drift.ts` (and `AciState` in `src/aci.ts`) are values in and values out, with
`initEProcess` / `updateEProcess` and `initEDetector` / `updateEDetector` as the whole interface.
What is missing is the layer above: persist state between runs, replay an observation log,
and emit a trend report across a series of audits rather than a single point-in-time one.

**External cross-validation of `drift.ts`.** The e-process and e-detector guarantees are argued in
the module docs and property-tested internally, but never checked against an external reference
implementation. The concrete task: generate golden fixtures from CRAN's `stcpR6` on the same
observation streams and assert agreement to within tolerance, the same way
`fixtures/calibration-contract.golden.json` pins the calibration math. This is the single most
valuable contribution anyone could make to this repo, because it converts an internal argument into
external corroboration.

**Live upstream calibration import.** `metrics.ts` deliberately *mirrors* the canonical ECE/Brier
math rather than importing it, pinned by `fixtures/calibration-contract.golden.json` (generated from
`@engine/eval` in `apatureai/verdict`). If the contract test and the upstream ever disagree,
one side changed the math unilaterally, which is the failure the contract exists to catch. The
fixture is a frozen manual copy today, not a live check; regenerating it on a cadence, or in CI,
is open.

**Anchor-set drift attribution (system vs judge).** When drift fires, it does not tell you whether
the system got worse or the judge did. The design sketch is a held-out anchor set with a
rotate-with-overlap refresh policy, sitting on top of `drift.ts`. Nothing is implemented.

**npm publication.** Nothing is on npm yet, so `npm i @apatureai/sigil` does not work today. The
packaging is done and verified: the manifest is no longer `private`, it declares `bin`, `files`,
`exports`, `engines` and a `prepublishOnly` build, and the packed tarball has been installed from
disk and its `sigil` command run end to end against the shipped example bundle. What is left is the
publish itself and a release workflow to automate it. The unscoped name `sigil` was taken (the
registry holds a tombstoned entry from a 2013 package unpublished in October 2024), so the package
name is the scoped `@apatureai/sigil`.

### Out of scope on purpose

- **An LLM judge.** `Judge` is an interface. Sigil scores whatever judge you hand it, and the same
  is true of ground truth: human labels, supplied by you. Bundling a judge would make the harness
  non-neutral, which is the one thing it must not be.

### Stated preconditions

These are properties of the statistics, not bugs, and each is stated in the output as well as here:

- The abstention certificate assumes exchangeability between the calibration and deployment draws.
  Drift breaks that assumption, which is why re-certification is meant to be a recurring cadence.
- `certifiedPassKLowerBound` assumes i.i.d. runs.
- The ACI guarantee is long-run average coverage; locally it can under-cover, and the implementation
  clamps the adaptive level to [0.001, 0.999] to keep intervals finite, trading a corner of the
  asymptotic argument for bounded artifacts.
- Small samples give wide bounds, and that is the intended behavior. A wide interval is reported as
  a finding, and when nothing certifies at the requested level the certificate says so explicitly
  instead of returning a number.
- The regulatory framing in some module docs (SR 11-7, SR 26-2) explains *why* the code is shaped
  the way it is. It is not legal advice and not a compliance claim.

## Development

```
pnpm install --frozen-lockfile
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run  -> Test Files 20 passed (20), Tests 160 passed (160)
pnpm lint        # eslint .
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

Those five commands, in that order, are exactly what CI runs (`.github/workflows/ci.yml`). All five
pass on a clean checkout, verified 2026-08-09 on Node 24.14.0 with pnpm 10.34.3: 20 test files, 160
tests, 2.69s.

Run a single test file:

```
pnpm vitest run test/golden-fs.test.ts
```

One rule matters if you change the code: **Sigil is offline and deterministic by construction, and
the tests enforce it.** No test may call a real model, key, or network. The live adapter
(`src/gateway-openai-compat.ts`) is exercised only through an injected `fetchImpl`. No wall clock
and no RNG in the analysis path; `test/golden-fs.test.ts` and `test/canonical.test.ts` will catch
you. And do not widen what crosses the egress line.

[CONTRIBUTING.md](CONTRIBUTING.md) has the full setup, conventions, and review process.

## Prior work

The statistical machinery follows published lines rather than inventing any: split conformal
prediction and Learn-Then-Test risk control (Angelopoulos, Bates et al.); selective classification
with a reject option (Geifman and El-Yaniv); betting supermartingales and e-detectors (Waudby-Smith
and Ramdas; Shin, Ramdas and Rinaldo, arXiv:2203.03532); adaptive conformal inference under
distribution shift (Gibbs and Candes, NeurIPS 2021); Page's CUSUM; the exact McNemar test;
Clopper-Pearson intervals. The contribution here is putting them behind one deterministic,
reproducible, fail-closed audit contract in TypeScript, not the estimators themselves.

## Contributing

Contributions are welcome, and the roadmap above is the shortlist. Issues and pull requests are
read. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how review works.

## Security

No credentials, keys, or secrets are stored in this repository, and the analysis path opens no
sockets. To report a vulnerability, use GitHub's private vulnerability reporting on this repository.
[SECURITY.md](SECURITY.md) has the policy and the threat boundary.

## License

MIT. See [LICENSE](LICENSE).
