Part of [sigil](../README.md). Moved from the README on 2026-08-24; anchors preserved.

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
