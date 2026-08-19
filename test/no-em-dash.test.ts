import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildReportDocument,
  renderMarkdown,
  certifyAbstentionThreshold,
  verifySwitchQuality,
  certifiedPassKLowerBound,
  initEProcess,
  updateEProcess,
  initEDetector,
  updateEDetector,
  type AuditReport,
  type ReportMeta,
  type JudgePrediction,
  type PairedOutcome,
} from "../src/index.js";

/**
 * House rule: no em dash (U+2014) in prose or in program output.
 *
 * Two guards, because either alone is escapable. The first reads the shipped
 * text out of the running code, so a reintroduced em dash in a *rendered*
 * string fails even if it is built by concatenation the source scan cannot see
 * whole. The second scans the checked-in files, so an em dash in a doc, a
 * fixture, or a branch no test happens to render still fails.
 *
 * report.ts writes the content-addressed document whose hash the README pins,
 * so a stray em dash there is not just a style slip: it silently moves a hash
 * the README claims is reproducible.
 */

// Built from its code point, not typed literally: this file is scanned by the
// checked-in-files guard below, and an em dash literal here would trip it.
const EM_DASH = String.fromCharCode(0x2014);

// --- Guard 1: rendered program output ---------------------------------------

const meta: ReportMeta = {
  client: "First Example Bank",
  corpusHash: "sha256:" + "a".repeat(64),
  panel: ["frontier-1", "mid-1", "budget-1"],
  generatedAt: "2026-07-02T00:00:00Z",
};

const auditReport: AuditReport = {
  judgeReliability: { ece: 0.07, brier: 0.12, sampleSize: 160, table: [] },
  families: [
    {
      family: "credit_memo",
      candidates: [],
      frontier: [],
      recommendation: { fromId: "frontier-1", toId: "mid-1", savingsPct: 0.75, latencyDeltaMs: -200, qualityDelta: -0.02 },
    },
    // The no-recommendation branch renders a different line; cover it too.
    { family: "sar_narrative", candidates: [], frontier: [], recommendation: null },
  ],
  passK: [{ model: "mid-1", family: "credit_memo", n: 10, passes: 9, passRate: 0.9, passHatK: 0.867 }],
  trialCoverage: {
    complete: false,
    requestedTrialsPerTask: 4,
    realTrials: 9,
    replayedTrials: 3,
    shortfalls: [{ model: "mid-1", taskId: "t1", recorded: 2, requested: 4 }],
  },
  passKCoverage: {
    k: 3,
    measured: 1,
    unmeasured: [{ model: "budget-1", taskId: "t2", trials: 1 }],
  },
} as unknown as AuditReport;

const calibration: JudgePrediction[] = [
  ...Array.from({ length: 80 }, (_, i) => ({ confidence: 0.95, correct: i >= 1 })),
  ...Array.from({ length: 40 }, (_, i) => ({ confidence: 0.55, correct: i >= 14 })),
];

const pairsDefensible: PairedOutcome[] = [
  ...Array.from({ length: 4 }, () => ({ currentPassed: true, candidatePassed: false })),
  ...Array.from({ length: 3 }, () => ({ currentPassed: false, candidatePassed: true })),
  ...Array.from({ length: 40 }, () => ({ currentPassed: true, candidatePassed: true })),
];

const pairsNotDefensible: PairedOutcome[] = [
  ...Array.from({ length: 12 }, () => ({ currentPassed: true, candidatePassed: false })),
  ...Array.from({ length: 40 }, () => ({ currentPassed: true, candidatePassed: true })),
];

describe("no em dash in program output", () => {
  it("renders the fully populated report document and markdown without an em dash", () => {
    const doc = buildReportDocument(auditReport, meta, {
      abstention: certifyAbstentionThreshold(calibration, { targetErrorRate: 0.1, delta: 0.05 }),
      switchEvidence: {
        credit_memo: verifySwitchQuality(pairsDefensible),
        sar_narrative: verifySwitchQuality(pairsNotDefensible),
      },
      certifiedReliability: [
        {
          model: "mid-1",
          family: "credit_memo",
          cert: certifiedPassKLowerBound(Array.from({ length: 10 }, () => true), 3, 0.05),
        },
      ],
    });

    // Every optional block must actually be present, or this guard is vacuous.
    expect(doc.abstention).toBeDefined();
    expect(doc.switchEvidence).toBeDefined();
    expect(doc.certifiedReliability).toBeDefined();
    expect(doc.trialCoverage).toBeDefined();
    expect(doc.passKCoverage).toBeDefined();

    expect(JSON.stringify(doc)).not.toContain(EM_DASH);
    expect(renderMarkdown(doc)).not.toContain(EM_DASH);
  });

  it("states both McNemar verdicts without an em dash", () => {
    const defensible = verifySwitchQuality(pairsDefensible);
    const notDefensible = verifySwitchQuality(pairsNotDefensible);
    expect(defensible.defensible).toBe(true);
    expect(notDefensible.defensible).toBe(false);
    expect(defensible.statement).not.toContain(EM_DASH);
    expect(notDefensible.statement).not.toContain(EM_DASH);
  });

  it("states the drift alarm without an em dash", () => {
    let e = initEProcess({ mu0: 0.05, alpha: 0.05 });
    let d = initEDetector({ mu0: 0.05, alpha: 0.05 });
    for (let i = 0; i < 6; i++) {
      e = updateEProcess(e, 1);
      d = updateEDetector(d, 1);
    }
    // The em dash lived in the alarmed branch only, so assert it is taken.
    expect(e.alarmed).toBe(true);
    expect(d.alarmed).toBe(true);
    expect(e.statement).toContain("ALARMED at observation");
    expect(d.statement).toContain("ALARMED at observation");
    expect(e.statement).not.toContain(EM_DASH);
    expect(d.statement).not.toContain(EM_DASH);
  });
});

// --- Guard 2: checked-in source, docs and fixtures ---------------------------

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "out", "coverage", ".vitest"]);
const SCAN_EXT = [".ts", ".js", ".md", ".json", ".yml", ".yaml"];

function filesToScan(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) filesToScan(full, found);
    } else if (SCAN_EXT.some((ext) => entry.endsWith(ext)) && entry !== "pnpm-lock.yaml") {
      found.push(full);
    }
  }
  return found;
}

function emDashOffenders(files: readonly string[]): string[] {
  return files.filter((f) => readFileSync(f, "utf8").includes(EM_DASH));
}

describe("no em dash in checked-in files", () => {
  // Positive control. Without it, a scan that inspects nothing at all is
  // indistinguishable from a scan that inspects everything and finds nothing,
  // and the guard below would pass while guarding nothing.
  it("detects an em dash when one is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "sigil-emdash-"));
    try {
      const dirty = join(dir, "dirty.md");
      const clean = join(dir, "clean.md");
      writeFileSync(dirty, `a sentence ${EM_DASH} interrupted\n`, "utf8");
      writeFileSync(clean, "a sentence, uninterrupted\n", "utf8");
      expect(emDashOffenders([dirty, clean])).toEqual([dirty]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds no em dash in source, docs, examples or fixtures", () => {
    const scanned = filesToScan(REPO_ROOT);
    // Guard the guard: if the walk silently stops finding files, it must fail.
    expect(scanned.length).toBeGreaterThan(30);
    expect(scanned.some((f) => f.endsWith("README.md"))).toBe(true);
    expect(scanned.some((f) => f.endsWith(join("src", "report.ts")))).toBe(true);

    const offenders = emDashOffenders(scanned).map((f) => f.slice(REPO_ROOT.length));
    expect(offenders).toEqual([]);
  });
});
