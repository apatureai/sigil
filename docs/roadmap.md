Part of [sigil](../README.md). Moved from the README on 2026-08-24; anchors preserved.

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
`@apatureai/verdict-eval` in `apatureai/verdict`). If the contract test and the upstream ever disagree,
one side changed the math unilaterally, which is the failure the contract exists to catch. The
fixture is a frozen manual copy today, not a live check; regenerating it on a cadence, or in CI,
is open.

**Anchor-set drift attribution (system vs judge).** When drift fires, it does not tell you whether
the system got worse or the judge did. The design sketch is a held-out anchor set with a
rotate-with-overlap refresh policy, sitting on top of `drift.ts`. Nothing is implemented.

**npm publication.** Nothing is on npm yet, so `npm i @apatureai/sigil` does not work today. The
packaging is done and verified: the manifest is no longer `private`, it declares `bin`, `files`,
`exports`, `engines` and a `prepublishOnly` build, and the packed tarball has been installed from
disk and its `sigil` command run end to end against the shipped example bundle. A tag-triggered
release workflow (`.github/workflows/release.yml`) now publishes with provenance on any `v*` tag;
what is left is the maintainer adding the `NPM_TOKEN` secret (see `CONTRIBUTING.md`) and pushing the
first tag. The unscoped name `sigil` was taken (the
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
