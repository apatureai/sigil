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
  kendallTauB,
  cardinalIntervalWidth,
  rankScoreDecoupling,
  type ScoredObservation,
  type CardinalInterval,
  type CardinalIntervalOptions,
  type RankScoreDecoupling,
  type RankScoreOptions,
  type RankScoreVerdict,
} from "./rank-score.js";

export {
  paretoFrontier,
  recommendSwitch,
  type Candidate,
  type SwitchRecommendation,
} from "./frontier.js";

export { StubGateway, type Gateway, type GatewayRequest, type GatewayResponse, type StubModelFixture } from "./gateway.js";
export { createOpenAiCompatGateway, GatewayError, type OpenAiCompatGatewayOptions } from "./gateway-openai-compat.js";

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
  type PassKCoverage,
  type PassKGap,
  type TrialCoverage,
  type TrialShortfall,
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
  type ReportEvidence,
} from "./report.js";

export {
  exportRouterPolicy,
  type RouterPolicy,
  type RoutePolicyEntry,
  type RouterPolicyOptions,
} from "./router-policy.js";

export {
  signReportBundle,
  verifyReportBundle,
  ed25519Signer,
  ed25519Verifier,
  type BundleSigner,
  type BundleVerifier,
  type SignedReportBundle,
  type BundleVerification,
} from "./bundle.js";

export {
  initAci,
  intervalFor,
  updateAci,
  type AciOptions,
  type AciInterval,
  type AciState,
  type AciUpdate,
} from "./aci.js";

export {
  initEProcess,
  updateEProcess,
  initEDetector,
  updateEDetector,
  initCusum,
  updateCusum,
  errorObservations,
  type DriftMonitorOptions,
  type EProcessState,
  type EDetectorState,
  type CusumOptions,
  type CusumState,
} from "./drift.js";

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
