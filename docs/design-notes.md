Part of [sigil](../README.md). Moved from the README on 2026-08-24; anchors preserved.

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

**7. Fail-closed data egress.** `egress.ts` refuses to release any artifact containing a raw model
output, a raw prompt, or a credential-shaped string. It searches both the artifact's own strings
(keys, values, array elements) and its JSON serialization, because matching only the serialization
misses every needle holding a character JSON escapes, which is to say every multi-line or quoted
model output. The end-to-end golden test deliberately plants a PII-leaking model output in the
corpus and asserts it cannot reach the exported deliverable.

**8. Signed, offline-verifiable artifacts.** `bundle.ts` produces a detached Ed25519 signature over
the canonical `{documentHash, markdownHash}` payload. Verification re-derives everything with no
network and fails closed with named reasons (document-hash mismatch, markdown tamper, payload swap,
signature failure, unknown key id). Ed25519 is used because RFC 8032 signatures are deterministic,
keeping bundles byte-stable. Signer and verifier are injected ports; the repo ships no key.

**9. Ports all the way down.** `Gateway`, `Judge`, `GroundTruth`, `BundleSigner`/`BundleVerifier`,
`fetchImpl`, and the clock are all injected. That is why the whole test suite runs in a few seconds
with no model, key, or network, and why the property tests (`fast-check`) can hammer the
certificate math directly.
