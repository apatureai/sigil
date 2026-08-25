Part of [sigil](../README.md). Moved from the README on 2026-08-24; anchors preserved.

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
