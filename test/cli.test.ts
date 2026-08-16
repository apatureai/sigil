import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runBundleAudit, loadBundle, writeArtifacts, type AuditBundle } from "../src/index.js";

const RAW_MID = "Adequate coverage; approval reasonable with covenants.";
const RAW_BAD = "idk approve";

function bundle(): AuditBundle {
  return {
    config: { client: "Example Bank", models: ["frontier", "budget"], trialsPerTask: 4, passK: 2, currentModel: "frontier", qualityFloor: 0.9, generatedAt: "2026-06-30T00:00:00.000Z" },
    corpus: {
      rubric: { id: "fs", version: "1", criteria: ["accurate"] },
      tasks: [{ taskId: "memo-1", family: "credit_memo", input: "Summarize creditworthiness for applicant 4821", labels: [{ output: RAW_MID, accept: true }, { output: RAW_BAD, accept: false }] }],
    },
    panel: {
      frontier: { costUsd: 0.03, latencyMs: 1400, outputs: { "memo-1": [RAW_MID, RAW_MID, RAW_MID, RAW_MID] } },
      budget: { costUsd: 0.003, latencyMs: 400, outputs: { "memo-1": [RAW_MID, RAW_MID, RAW_MID, RAW_MID] } },
    },
    judgeVerdicts: { [RAW_MID]: { pass: true, confidence: 0.9 }, [RAW_BAD]: { pass: false, confidence: 0.9 } },
    governance: { agents: [{ agentId: "credit-bot", grantedScopes: ["read:applications", "read:ssn"], tasks: ["credit_memo"] }], requirements: [{ family: "credit_memo", requiredScopes: ["read:applications"] }] },
  };
}

describe("runBundleAudit (CLI core)", () => {
  it("produces report + neutral policy + governance from a bundle, egress-enforced", async () => {
    const a = await runBundleAudit(bundle());
    expect(a.report.findings.find((f) => f.family === "credit_memo")?.recommendedFromTo).toEqual({ from: "frontier", to: "budget" });
    expect(a.routerPolicy.routes[0]?.primary).toBe("budget");
    expect(a.governance.find((g) => g.code === "excess_scope")?.scopes).toContain("read:ssn");
    expect(a.reportMarkdown).toContain("Independent AI Quality & Efficiency Assurance");
    // The raw prompt / applicant id never reaches the written artifacts.
    expect(JSON.stringify(a.report)).not.toContain("applicant 4821");
  });

  it("is deterministic for the same bundle", async () => {
    expect(await runBundleAudit(bundle())).toEqual(await runBundleAudit(bundle()));
  });

  it("round-trips through load/write on disk (offline, no model)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sigil-"));
    const b = bundle();
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(b.config));
    fs.writeFileSync(path.join(dir, "corpus.json"), JSON.stringify(b.corpus));
    fs.writeFileSync(path.join(dir, "panel.json"), JSON.stringify(b.panel));
    fs.writeFileSync(path.join(dir, "judge.json"), JSON.stringify(b.judgeVerdicts));
    fs.writeFileSync(path.join(dir, "governance.json"), JSON.stringify(b.governance));

    const artifacts = await runBundleAudit(loadBundle(dir));
    const out = path.join(dir, "out");
    writeArtifacts(out, artifacts);
    expect(fs.existsSync(path.join(out, "report.md"))).toBe(true);
    expect(fs.existsSync(path.join(out, "router-policy.json"))).toBe(true);
    const written = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
    expect(written.documentHash).toBe(artifacts.report.documentHash);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
