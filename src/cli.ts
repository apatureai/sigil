/**
 * CLI / runner (backlog #12) — `audit <corpus-dir> [out-dir]`.
 *
 * The CLI operates OFFLINE on a results bundle: the panel run happens in the
 * client VPC and is captured as fixtures; the CLI then judges, scores, builds
 * the frontier, and writes the report + neutral router policy + governance map.
 * It calls no model itself (the panel outputs are supplied), and it enforces the
 * egress guard before writing anything — so nothing but derived facts is ever
 * written to disk. Deterministic for a given bundle.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { freezeCorpus, panelCorpus, groundTruthFrom, type CorpusSpec } from "./corpus.js";
import { runAudit, type Judge } from "./harness.js";
import { buildReportDocument, renderMarkdown, type AuditReportDocument } from "./report.js";
import { exportRouterPolicy, type RouterPolicy } from "./router-policy.js";
import { mapGovernance, type AgentRecord, type GovernanceFinding, type TaskScopeRequirement } from "./governance.js";
import { assertSafeEgress } from "./egress.js";
import { StubGateway, type StubModelFixture } from "./gateway.js";

export interface AuditConfig {
  client: string;
  models: string[];
  trialsPerTask: number;
  passK: number;
  currentModel: string;
  qualityFloor: number;
  generatedAt: string;
}

export interface AuditBundle {
  config: AuditConfig;
  corpus: CorpusSpec;
  /** Captured panel run (per model: cost/latency + per-task/trial outputs). */
  panel: Record<string, StubModelFixture>;
  /** Calibrated judge verdicts keyed by raw output (supplied; the CLI judges no live model). */
  judgeVerdicts: Record<string, { pass: boolean; confidence: number }>;
  governance?: { agents: AgentRecord[]; requirements: TaskScopeRequirement[] };
}

export interface AuditArtifacts {
  report: AuditReportDocument;
  reportMarkdown: string;
  routerPolicy: RouterPolicy;
  governance: GovernanceFinding[];
}

/** Run an audit from an in-memory bundle. Enforces egress before returning. */
export async function runBundleAudit(bundle: AuditBundle): Promise<AuditArtifacts> {
  const corpus = freezeCorpus(bundle.corpus);
  const gateway = new StubGateway(bundle.panel);
  const judge: Judge = { judge: (_t, output) => bundle.judgeVerdicts[output] ?? { pass: false, confidence: 0.5 } };

  const report = await runAudit({
    corpus: panelCorpus(corpus),
    models: bundle.config.models,
    gateway,
    judge,
    groundTruth: groundTruthFrom(corpus),
    trialsPerTask: bundle.config.trialsPerTask,
    passK: bundle.config.passK,
    currentModel: bundle.config.currentModel,
  });

  const doc = buildReportDocument(report, {
    client: bundle.config.client,
    corpusHash: corpus.contentHash,
    panel: bundle.config.models,
    generatedAt: bundle.config.generatedAt,
  });
  const routerPolicy = exportRouterPolicy(report, bundle.config.qualityFloor);
  const governance = bundle.governance ? mapGovernance(bundle.governance.agents, bundle.governance.requirements) : [];

  // Fail-closed: no raw output or prompt may leave in any artifact.
  const forbidden = [
    ...Object.values(bundle.panel).flatMap((m) => Object.values(m.outputs).flat()),
    ...bundle.corpus.tasks.map((t) => t.input),
  ];
  assertSafeEgress(doc, forbidden);
  assertSafeEgress(routerPolicy, forbidden);
  assertSafeEgress(governance, forbidden);

  return { report: doc, reportMarkdown: renderMarkdown(doc), routerPolicy, governance };
}

const readJson = (dir: string, file: string): unknown => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

/** Load a bundle from a directory of JSON files. */
export function loadBundle(dir: string): AuditBundle {
  const bundle: AuditBundle = {
    config: readJson(dir, "config.json") as AuditConfig,
    corpus: readJson(dir, "corpus.json") as CorpusSpec,
    panel: readJson(dir, "panel.json") as Record<string, StubModelFixture>,
    judgeVerdicts: readJson(dir, "judge.json") as Record<string, { pass: boolean; confidence: number }>,
  };
  if (fs.existsSync(path.join(dir, "governance.json"))) {
    bundle.governance = readJson(dir, "governance.json") as AuditBundle["governance"];
  }
  return bundle;
}

/** Write the artifacts to an output directory (derived facts only — egress already enforced). */
export function writeArtifacts(outDir: string, artifacts: AuditArtifacts): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(artifacts.report, null, 2));
  fs.writeFileSync(path.join(outDir, "report.md"), artifacts.reportMarkdown);
  fs.writeFileSync(path.join(outDir, "router-policy.json"), JSON.stringify(artifacts.routerPolicy, null, 2));
  fs.writeFileSync(path.join(outDir, "governance.json"), JSON.stringify(artifacts.governance, null, 2));
}

/** CLI entry: `audit <corpus-dir> [out-dir]`. Returns a process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const dir = argv[0];
  if (dir === undefined) {
    process.stderr.write("usage: audit <corpus-dir> [out-dir]\n");
    return 2;
  }
  const outDir = argv[1] ?? path.join(dir, "out");
  const artifacts = await runBundleAudit(loadBundle(dir));
  writeArtifacts(outDir, artifacts);
  process.stderr.write(`wrote report.{json,md}, router-policy.json, governance.json to ${outDir}\n`);
  return 0;
}
