import {
  GAP_REQUIREMENTS_AGENTIC_TOOL_EVENT_TYPES,
  GAP_REQUIREMENTS_AGENTIC_TOOL_NAMES,
} from "./agentic-tool-gap-requirements.ts";
import {
  ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_EVENT_TYPES,
  ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_NAMES,
} from "./agentic-tool-admin-source-catalog.ts";

/** Shared value sets for the first protected agentic-evidence tools. */
export const AGENTIC_TOOL_NAMES = {
  getScanCoverage: "get_scan_coverage",
  getArtifactChain: "get_artifact_chain",
  getFindingDetail: "get_finding_detail",
  searchEvidence: "search_evidence",
  findProviderInvocations: "find_provider_invocations",
  getEvidenceSubgraph: "get_evidence_subgraph",
  getSymbolContext: "get_symbol_context",
  traceStaticFlow: "trace_static_flow",
  inspectHumanReviewPath: "inspect_human_review_path",
  inspectDecisionPath: "inspect_decision_path",
  inspectDataPath: "inspect_data_path",
  findSimilarSymbols: "find_similar_symbols",
  inspectDeploymentContext: "inspect_deployment_context",
  proposeMissingTargets: "propose_missing_targets",
  getReconciliationContext: "get_reconciliation_context",
  getLegalCorpusReadiness: "get_legal_corpus_readiness",
  retrieveLegalBasis: "retrieve_legal_basis",
  validateCitationSet: "validate_citation_set",
  evaluateGapMatrix: "evaluate_gap_matrix",
  getGapEvidenceTrace: "get_gap_evidence_trace",
  proposeGapRemediation: "propose_gap_remediation",
  extractOfficialText: "extract_official_text",
  runOcrFallback: "run_ocr_fallback",
  evaluateOcrQuality: "evaluate_ocr_quality",
  buildLegalChunks: "build_legal_chunks",
  validateChunkIntegrity: "validate_chunk_integrity",
  buildLegalRetrievalIndex: "build_legal_retrieval_index",
  resumeWaitingRuns: "resume_waiting_runs",
  requestTargetedReanalysis: "request_targeted_reanalysis",
  captureVerifiedEpisode: "capture_verified_episode",
  retrieveVerifiedEpisodes: "retrieve_verified_episodes",
  consolidateVerifiedEpisodes: "consolidate_verified_episodes",
  ...ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_NAMES,
  ...GAP_REQUIREMENTS_AGENTIC_TOOL_NAMES,
} as const;

export type AgenticToolName =
  (typeof AGENTIC_TOOL_NAMES)[keyof typeof AGENTIC_TOOL_NAMES];

export const AGENTIC_TOOL_STATUSES = {
  ready: "READY",
  needsInput: "NEEDS_INPUT",
  conflict: "CONFLICT",
  outOfCoverage: "OUT_OF_COVERAGE",
  blocked: "BLOCKED",
  failed: "FAILED",
} as const;

export type AgenticToolStatus =
  (typeof AGENTIC_TOOL_STATUSES)[keyof typeof AGENTIC_TOOL_STATUSES];

export const AGENTIC_TOOL_COVERAGE_STATES = {
  sufficient: "SUFFICIENT",
  partial: "PARTIAL",
  limited: "LIMITED",
  unavailable: "UNAVAILABLE",
} as const;

export type AgenticToolCoverageState =
  (typeof AGENTIC_TOOL_COVERAGE_STATES)[keyof typeof AGENTIC_TOOL_COVERAGE_STATES];

export const ARTIFACT_CHAIN_STAGES = {
  technicalEvidence: "TECHNICAL_EVIDENCE",
  aiUsageFlow: "AI_USAGE_FLOW",
  conflict: "CONFLICT",
  verifiedProfile: "VERIFIED_PROFILE",
} as const;

export type ArtifactChainStage =
  (typeof ARTIFACT_CHAIN_STAGES)[keyof typeof ARTIFACT_CHAIN_STAGES];

export const ARTIFACT_CHAIN_INTEGRITY = {
  valid: "VALID",
  limited: "LIMITED",
} as const;

export type ArtifactChainIntegrity =
  (typeof ARTIFACT_CHAIN_INTEGRITY)[keyof typeof ARTIFACT_CHAIN_INTEGRITY];

export const AGENTIC_TOOL_EVENT_TYPES = {
  scanCoverageRead: "AGENTIC_TOOL_SCAN_COVERAGE_READ",
  artifactChainRead: "AGENTIC_TOOL_ARTIFACT_CHAIN_READ",
  reconciliationContextRead: "AGENTIC_TOOL_RECONCILIATION_CONTEXT_READ",
  legalCorpusReadinessRead: "AGENTIC_TOOL_LEGAL_CORPUS_READINESS_READ",
  legalBasisRetrieved: "AGENTIC_TOOL_LEGAL_BASIS_RETRIEVED",
  citationSetValidated: "AGENTIC_TOOL_CITATION_SET_VALIDATED",
  gapMatrixEvaluated: "AGENTIC_TOOL_GAP_MATRIX_EVALUATED",
  gapEvidenceTraceRead: "AGENTIC_TOOL_GAP_EVIDENCE_TRACE_READ",
  gapRemediationProposed: "AGENTIC_TOOL_GAP_REMEDIATION_PROPOSED",
  officialTextExtracted: "AGENTIC_TOOL_OFFICIAL_TEXT_EXTRACTED",
  ocrFallbackRun: "AGENTIC_TOOL_OCR_FALLBACK_RUN",
  ocrQualityEvaluated: "AGENTIC_TOOL_OCR_QUALITY_EVALUATED",
  legalChunksBuilt: "AGENTIC_TOOL_LEGAL_CHUNKS_BUILT",
  chunkIntegrityValidated: "AGENTIC_TOOL_CHUNK_INTEGRITY_VALIDATED",
  legalRetrievalIndexBuilt: "AGENTIC_TOOL_LEGAL_RETRIEVAL_INDEX_BUILT",
  waitingRunsResumed: "AGENTIC_TOOL_WAITING_RUNS_RESUMED",
  targetedReanalysisRequested: "AGENTIC_TOOL_TARGETED_REANALYSIS_REQUESTED",
  verifiedEpisodeCaptured: "AGENTIC_TOOL_VERIFIED_EPISODE_CAPTURED",
  verifiedEpisodesRetrieved: "AGENTIC_TOOL_VERIFIED_EPISODES_RETRIEVED",
  verifiedEpisodesConsolidated: "AGENTIC_TOOL_VERIFIED_EPISODES_CONSOLIDATED",
  findingDetailRead: "AGENTIC_TOOL_FINDING_DETAIL_READ",
  evidenceSearchRead: "AGENTIC_TOOL_EVIDENCE_SEARCH_READ",
  providerInvocationRead: "AGENTIC_TOOL_PROVIDER_INVOCATION_READ",
  evidenceSubgraphRead: "AGENTIC_TOOL_EVIDENCE_SUBGRAPH_READ",
  symbolContextRead: "AGENTIC_TOOL_SYMBOL_CONTEXT_READ",
  staticFlowRead: "AGENTIC_TOOL_STATIC_FLOW_READ",
  humanReviewPathRead: "AGENTIC_TOOL_HUMAN_REVIEW_PATH_READ",
  decisionPathRead: "AGENTIC_TOOL_DECISION_PATH_READ",
  dataPathRead: "AGENTIC_TOOL_DATA_PATH_READ",
  similarSymbolsRead: "AGENTIC_TOOL_SIMILAR_SYMBOLS_READ",
  deploymentContextRead: "AGENTIC_TOOL_DEPLOYMENT_CONTEXT_READ",
  missingTargetProposalRead: "AGENTIC_TOOL_MISSING_TARGET_PROPOSAL_READ",
  ...ADMIN_SOURCE_CATALOG_AGENTIC_TOOL_EVENT_TYPES,
  ...GAP_REQUIREMENTS_AGENTIC_TOOL_EVENT_TYPES,
} as const;
