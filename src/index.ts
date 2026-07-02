export {
  expectedCalibrationError,
  brierScore,
  reliabilityTable,
  judgeReliability,
  type JudgePrediction,
  type ReliabilityBin,
  type JudgeReliability,
} from "./metrics.js";

export { passAtK, type PassKResult } from "./reliability.js";

export {
  paretoFrontier,
  recommendSwitch,
  type Candidate,
  type SwitchRecommendation,
} from "./frontier.js";

export { StubGateway, type Gateway, type GatewayRequest, type GatewayResponse, type StubModelFixture } from "./gateway.js";

export {
  runAudit,
  type AuditInput,
  type AuditReport,
  type Corpus,
  type Task,
  type GroundTruth,
  type Judge,
  type JudgeVerdict,
  type FamilyFrontier,
  type PassKRow,
} from "./harness.js";

export { canonicalize, contentHash } from "./canonical.js";

export {
  freezeCorpus,
  panelCorpus,
  groundTruthFrom,
  type CorpusSpec,
  type CorpusTask,
  type FrozenCorpus,
  type Rubric,
  type LabeledExample,
} from "./corpus.js";

export {
  buildReportDocument,
  renderMarkdown,
  type AuditReportDocument,
  type ReportMeta,
  type ReportFinding,
} from "./report.js";

export {
  exportRouterPolicy,
  type RouterPolicy,
  type RoutePolicyEntry,
} from "./router-policy.js";

export {
  mapGovernance,
  type AgentRecord,
  type TaskScopeRequirement,
  type GovernanceFinding,
  type GovernanceSeverity,
} from "./governance.js";

export { assertSafeEgress, checkEgress, EgressViolation } from "./egress.js";

export { JudgeEnsemble, type NamedJudge, type DisagreementSummary } from "./ensemble.js";

export {
  clopperPearsonUpper,
  clopperPearsonLower,
  certifyAbstentionThreshold,
  type AbstentionCertificate,
  type AbstentionCertificateInput,
} from "./conformal.js";

export {
  mcnemarExact,
  verifySwitchQuality,
  certifiedPassKLowerBound,
  type McNemarResult,
  type PairedOutcome,
  type SwitchQualityEvidence,
  type CertifiedPassK,
} from "./stats.js";

export {
  runBundleAudit,
  loadBundle,
  writeArtifacts,
  main,
  type AuditBundle,
  type AuditConfig,
  type AuditArtifacts,
} from "./cli.js";
