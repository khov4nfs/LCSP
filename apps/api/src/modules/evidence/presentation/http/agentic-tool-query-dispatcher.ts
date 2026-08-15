import {
  AGENTIC_TOOL_NAMES,
  ARTIFACT_CHAIN_STAGES,
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  EVIDENCE_ERROR_CODES,
  VERIFIED_PROFILE_REQUIRED_FOR,
} from "@lcsp/contracts/evidence";
import { HttpStatus } from "@nestjs/common";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import { EvaluateGapMatrixQuery } from "../../../classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.query.js";
import { GetClassificationBaselineQuery } from "../../../classification/application/queries/get-classification-baseline/get-classification-baseline.query.js";
import { GetGapEvidenceTraceQuery } from "../../../classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.query.js";
import { GetGapRequirementsQuery } from "../../../classification/application/queries/get-gap-requirements/get-gap-requirements.query.js";
import { ProposeGapRemediationQuery } from "../../../classification/application/queries/propose-gap-remediation/propose-gap-remediation.query.js";
import { ValidateClassificationProposalQuery } from "../../../classification/application/queries/validate-classification-proposal/validate-classification-proposal.query.js";
import { GetAdminSourceCatalogQuery } from "../../../legal-rule-catalog/application/queries/get-admin-source-catalog/get-admin-source-catalog.query.js";
import { GetLegalCorpusReadinessQuery } from "../../../legal-rule-catalog/application/queries/get-legal-corpus-readiness/get-legal-corpus-readiness.query.js";
import { GetLegalRuleMatchQuery } from "../../../legal-rule-catalog/application/queries/get-legal-rule-match/get-legal-rule-match.query.js";
import { RetrieveLegalBasisQuery } from "../../../legal-rule-catalog/application/queries/retrieve-legal-basis/retrieve-legal-basis.query.js";
import { ValidateCitationSetQuery } from "../../../legal-rule-catalog/application/queries/validate-citation-set/validate-citation-set.query.js";
import { TARGET_CANDIDATE_KINDS } from "../../../reconciliation/application/contracts/missing-target-proposal.contract.js";
import { RECONCILIATION_CONTEXT_STATUSES } from "../../../reconciliation/application/contracts/reconciliation/reconciliation-context.contract.js";
import { GetArtifactChainQuery } from "../../../reconciliation/application/queries/get-artifact-chain/get-artifact-chain.query.js";
import { GetAssessmentContextQuery } from "../../../reconciliation/application/queries/get-assessment-context/get-assessment-context.query.js";
import { CompareWizardClaimQuery } from "../../../reconciliation/application/queries/compare-wizard-claim/compare-wizard-claim.query.js";
import { GetReconciliationContextQuery } from "../../../reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.query.js";
import { GetVerifiedProfileQuery } from "../../../reconciliation/application/queries/get-verified-profile/get-verified-profile.query.js";
import { ProposeMissingTargetsQuery } from "../../../reconciliation/application/queries/propose-missing-targets/propose-missing-targets.query.js";
import {
  parseSingleTargetId,
  parseWizardClaimComparisonScope,
  parseWizardClaimExpectedValue,
  parseWizardClaimField,
  parseWizardClaimMaxEvidenceRefs,
} from "../../../reconciliation/presentation/http/compare-wizard-claim.request.js";
import {
  DATA_CATEGORIES,
  DATA_PATH_DIRECTIONS,
} from "../../application/contracts/evidence/data-path.contract.js";
import { DECISION_ACTION_CATEGORIES } from "../../application/contracts/evidence/decision-path.contract.js";
import {
  DEPLOYMENT_ENVIRONMENTS,
  DEPLOYMENT_MANIFEST_KINDS,
} from "../../application/contracts/evidence/deployment-context.contract.js";
import { EVIDENCE_SUBGRAPH_DIRECTIONS } from "../../application/contracts/evidence/evidence-subgraph.contract.js";
import { FINDING_DETAIL_INCLUDES } from "../../application/contracts/evidence/finding-detail.contract.js";
import { HUMAN_REVIEW_KINDS } from "../../application/contracts/evidence/human-review-path.contract.js";
import {
  PROVIDER_INVOCATION_FRAMEWORKS,
  PROVIDER_INVOCATION_PROVIDERS,
} from "../../application/contracts/evidence/provider-invocation.contract.js";
import { SEARCH_EVIDENCE_CONFIDENCE } from "../../application/contracts/evidence/search-evidence.contract.js";
import { SYMBOL_SIMILARITY_DIMENSIONS } from "../../application/contracts/evidence/similar-symbols.contract.js";
import { STATIC_FLOW_DIRECTIONS } from "../../application/contracts/evidence/static-flow.contract.js";
import { SYMBOL_CONTEXT_INCLUDES } from "../../application/contracts/evidence/symbol-context.contract.js";
import { FindProviderInvocationsQuery } from "../../application/queries/find-provider-invocations/find-provider-invocations.query.js";
import { FindSimilarSymbolsQuery } from "../../application/queries/find-similar-symbols/find-similar-symbols.query.js";
import { GetEvidenceSubgraphQuery } from "../../application/queries/get-evidence-subgraph/get-evidence-subgraph.query.js";
import { GetFindingDetailQuery } from "../../application/queries/get-finding-detail/get-finding-detail.query.js";
import { GetScanCoverageQuery } from "../../application/queries/get-scan-coverage/get-scan-coverage.query.js";
import { GetSymbolContextQuery } from "../../application/queries/get-symbol-context/get-symbol-context.query.js";
import { InspectDataPathQuery } from "../../application/queries/inspect-data-path/inspect-data-path.query.js";
import { InspectDecisionPathQuery } from "../../application/queries/inspect-decision-path/inspect-decision-path.query.js";
import { InspectDeploymentContextQuery } from "../../application/queries/inspect-deployment-context/inspect-deployment-context.query.js";
import { InspectHumanReviewPathQuery } from "../../application/queries/inspect-human-review-path/inspect-human-review-path.query.js";
import { SearchEvidenceQuery } from "../../application/queries/search-evidence/search-evidence.query.js";
import { TraceStaticFlowQuery } from "../../application/queries/trace-static-flow/trace-static-flow.query.js";

export type AgenticToolQueryDispatchArgs = {
  toolName: string;
  assessmentId: string;
  organizationId: string;
  userId: string;
  correlationId: string;
  artifactVersions: Record<string, unknown>;
  input: Record<string, unknown>;
};

/**
 * Single Nest query-routing table. Every case delegates to a real exported
 * function whose name exactly matches the canonical snake_case tool name.
 */
export function buildAgenticToolQuery(args: AgenticToolQueryDispatchArgs) {
  switch (args.toolName) {
    case AGENTIC_TOOL_NAMES.getScanCoverage:
      return get_scan_coverage(args);
    case AGENTIC_TOOL_NAMES.searchEvidence:
      return search_evidence(args);
    case AGENTIC_TOOL_NAMES.getFindingDetail:
      return get_finding_detail(args);
    case AGENTIC_TOOL_NAMES.findProviderInvocations:
      return find_provider_invocations(args);
    case AGENTIC_TOOL_NAMES.getEvidenceSubgraph:
      return get_evidence_subgraph(args);
    case AGENTIC_TOOL_NAMES.getSymbolContext:
      return get_symbol_context(args);
    case AGENTIC_TOOL_NAMES.traceStaticFlow:
      return trace_static_flow(args);
    case AGENTIC_TOOL_NAMES.inspectHumanReviewPath:
      return inspect_human_review_path(args);
    case AGENTIC_TOOL_NAMES.inspectDecisionPath:
      return inspect_decision_path(args);
    case AGENTIC_TOOL_NAMES.inspectDataPath:
      return inspect_data_path(args);
    case AGENTIC_TOOL_NAMES.findSimilarSymbols:
      return find_similar_symbols(args);
    case AGENTIC_TOOL_NAMES.inspectDeploymentContext:
      return inspect_deployment_context(args);
    case AGENTIC_TOOL_NAMES.getAssessmentContext:
      return get_assessment_context(args);
    case AGENTIC_TOOL_NAMES.getArtifactChain:
      return get_artifact_chain(args);
    case AGENTIC_TOOL_NAMES.getReconciliationContext:
      return get_reconciliation_context(args);
    case AGENTIC_TOOL_NAMES.proposeMissingTargets:
      return propose_missing_targets(args);
    case AGENTIC_TOOL_NAMES.getVerifiedProfile:
      return get_verified_profile(args);
    case AGENTIC_TOOL_NAMES.compareWizardClaim:
      return compare_wizard_claim(args);
    case AGENTIC_TOOL_NAMES.getClassificationBaseline:
      return get_classification_baseline(args);
    case AGENTIC_TOOL_NAMES.getGapRequirements:
      return get_gap_requirements(args);
    case AGENTIC_TOOL_NAMES.getGapEvidenceTrace:
      return get_gap_evidence_trace(args);
    case AGENTIC_TOOL_NAMES.proposeGapRemediation:
      return propose_gap_remediation(args);
    case AGENTIC_TOOL_NAMES.validateClassificationProposal:
      return validate_classification_proposal(args);
    case AGENTIC_TOOL_NAMES.evaluateGapMatrix:
      return evaluate_gap_matrix(args);
    case AGENTIC_TOOL_NAMES.getAdminSourceCatalog:
      return get_admin_source_catalog(args);
    case AGENTIC_TOOL_NAMES.getLegalCorpusReadiness:
      return get_legal_corpus_readiness(args);
    case AGENTIC_TOOL_NAMES.retrieveLegalBasis:
      return retrieve_legal_basis(args);
    case AGENTIC_TOOL_NAMES.getLegalRuleMatch:
      return get_legal_rule_match(args);
    case AGENTIC_TOOL_NAMES.validateCitationSet:
      return validate_citation_set(args);
    default:
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        args.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
  }
}

export function get_scan_coverage(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new GetScanCoverageQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
    stringArray(input.pathPrefixes),
    stringArray(input.languages),
    stringArray(input.dispositions) as Array<
      "ANALYZED" | "SKIPPED" | "LIMITED"
    >,
    stringArray(input.toolNames),
    optionalString(input.cursor),
  );
}

export function search_evidence(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new SearchEvidenceQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
    stringArray(input.findingKinds),
    stringArray(input.providers),
    stringArray(input.pathPrefixes),
    optionalEnum(
      input.minConfidence,
      Object.values(SEARCH_EVIDENCE_CONFIDENCE),
    ),
    optionalString(input.cursor),
  );
}

export function get_finding_detail(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new GetFindingDetailQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.findingId), "finding:"),
    typedStringArray(input.include, Object.values(FINDING_DETAIL_INCLUDES)),
    args.correlationId,
  );
}

export function find_provider_invocations(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new FindProviderInvocationsQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
    optionalEnum(input.provider, Object.values(PROVIDER_INVOCATION_PROVIDERS)),
    stringArray(input.pathPrefixes),
    optionalEnum(
      input.framework,
      Object.values(PROVIDER_INVOCATION_FRAMEWORKS),
    ),
  );
}

export function get_evidence_subgraph(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new GetEvidenceSubgraphQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.seedRef), "node:"),
    requiredEnum(input.direction, Object.values(EVIDENCE_SUBGRAPH_DIRECTIONS)),
    numberWithDefault(input.maxDepth, 2),
    numberWithDefault(input.maxNodes, 25),
    numberWithDefault(input.maxEdges, 50),
    args.correlationId,
    stringArray(input.nodeTypes),
    stringArray(input.edgeTypes),
  );
}

export function get_symbol_context(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new GetSymbolContextQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.symbolRef), "symbol:"),
    typedStringArray(input.include, Object.values(SYMBOL_CONTEXT_INCLUDES)),
    numberWithDefault(input.maxNeighbors, 25),
    args.correlationId,
  );
}

export function trace_static_flow(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new TraceStaticFlowQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.startRef), "node:"),
    requiredEnum(input.direction, Object.values(STATIC_FLOW_DIRECTIONS)),
    numberWithDefault(input.maxHops, 5),
    args.correlationId,
    stringArray(input.desiredStages),
  );
}

export function inspect_human_review_path(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new InspectHumanReviewPathQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.startRef), "node:"),
    typedStringArray(input.reviewKinds, Object.values(HUMAN_REVIEW_KINDS)),
    numberWithDefault(input.maxHops, 5),
    args.correlationId,
  );
}

export function inspect_decision_path(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new InspectDecisionPathQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.startRef), "node:"),
    typedStringArray(
      input.actionCategories,
      Object.values(DECISION_ACTION_CATEGORIES),
    ),
    numberWithDefault(input.maxHops, 5),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
  );
}

export function inspect_data_path(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new InspectDataPathQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.startRef), "node:"),
    requiredEnum(input.direction, Object.values(DATA_PATH_DIRECTIONS)),
    typedStringArray(input.dataCategories, Object.values(DATA_CATEGORIES)),
    numberWithDefault(input.maxHops, 5),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
  );
}

export function find_similar_symbols(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new FindSimilarSymbolsQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    stripRef(requiredString(input.seedSymbolRef), "symbol:"),
    typedStringArray(
      input.dimensions,
      Object.values(SYMBOL_SIMILARITY_DIMENSIONS),
    ),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
    stringArray(input.pathPrefixes),
  );
}

export function inspect_deployment_context(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new InspectDeploymentContextQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    typedStringArray(
      input.manifestKinds,
      Object.values(DEPLOYMENT_MANIFEST_KINDS),
    ),
    typedStringArray(
      input.environments,
      Object.values(DEPLOYMENT_ENVIRONMENTS),
    ),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
    stringArray(input.pathPrefixes),
    optionalString(input.cursor),
  );
}

export function get_assessment_context(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new GetAssessmentContextQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "wizardProfileId"),
    typedStringArray(input.include, Object.values(ASSESSMENT_CONTEXT_INCLUDES)),
    typedStringArray(
      input.answerFields,
      Object.values(ASSESSMENT_CONTEXT_ANSWER_FIELDS),
    ),
    args.correlationId,
  );
}

export function get_artifact_chain(args: AgenticToolQueryDispatchArgs) {
  const { input } = args;
  return new GetArtifactChainQuery(
    args.assessmentId,
    args.organizationId,
    args.correlationId,
    optionalRecord(input.anchor)
      ? optionalString(optionalRecord(input.anchor)?.artifactRef)
      : null,
    typedStringArray(
      input.requiredStages,
      Object.values(ARTIFACT_CHAIN_STAGES),
    ),
    input.exactVersions === true,
  );
}

export function get_reconciliation_context(args: AgenticToolQueryDispatchArgs) {
  const { input } = args;
  return new GetReconciliationContextQuery(
    args.assessmentId,
    args.organizationId,
    args.correlationId,
    stripOptionalRef(optionalString(input.flowRef), "flow:"),
    stringArray(input.conflictIds).map((value) => stripRef(value, "conflict:")),
    optionalString(input.cursor),
    numberWithDefault(input.maxResults, 25),
    typedStringArray(
      input.statuses,
      Object.values(RECONCILIATION_CONTEXT_STATUSES),
    ),
  );
}

export function propose_missing_targets(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  return new ProposeMissingTargetsQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "wizardProfileId"),
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    typedStringArray(
      input.candidateKinds,
      Object.values(TARGET_CANDIDATE_KINDS),
    ),
    stringArray(input.seedRefs),
    stringArray(input.excludeTargetIds),
    numberWithDefault(input.maxResults, 25),
    args.correlationId,
  );
}

export function get_verified_profile(args: AgenticToolQueryDispatchArgs) {
  const { input } = args;
  return new GetVerifiedProfileQuery(
    args.assessmentId,
    args.organizationId,
    stripRef(requiredString(input.verifiedProfileId), "verified:"),
    requiredString(input.expectedVersion),
    requiredEnum(
      input.requiredFor,
      Object.values(VERIFIED_PROFILE_REQUIRED_FOR),
    ),
    args.correlationId,
  );
}

export function compare_wizard_claim(args: AgenticToolQueryDispatchArgs) {
  const { input, artifactVersions } = args;
  const claimField = parseWizardClaimField(
    optionalString(input.claimField) ?? undefined,
    args.correlationId,
  );
  const rawMaxEvidenceRefs =
    typeof input.maxEvidenceRefs === "number"
      ? String(input.maxEvidenceRefs)
      : (optionalString(input.maxEvidenceRefs) ?? undefined);
  return new CompareWizardClaimQuery(
    args.assessmentId,
    args.organizationId,
    requiredArtifactVersion(artifactVersions, "wizardProfileId"),
    requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
    parseSingleTargetId(requiredString(input.targetId), args.correlationId),
    claimField,
    parseWizardClaimExpectedValue(
      optionalString(input.expectedValue) ?? undefined,
      claimField,
      args.correlationId,
    ),
    parseWizardClaimComparisonScope(
      optionalString(input.comparisonScope) ?? undefined,
      args.correlationId,
    ),
    parseWizardClaimMaxEvidenceRefs(rawMaxEvidenceRefs, args.correlationId),
    args.correlationId,
  );
}

export function get_classification_baseline(
  args: AgenticToolQueryDispatchArgs,
) {
  return new GetClassificationBaselineQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

export function get_gap_requirements(args: AgenticToolQueryDispatchArgs) {
  return new GetGapRequirementsQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

export function get_gap_evidence_trace(args: AgenticToolQueryDispatchArgs) {
  return new GetGapEvidenceTraceQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    args.correlationId,
  );
}

export function propose_gap_remediation(args: AgenticToolQueryDispatchArgs) {
  return new ProposeGapRemediationQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    args.correlationId,
  );
}

export function validate_classification_proposal(
  args: AgenticToolQueryDispatchArgs,
) {
  return new ValidateClassificationProposalQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

export function evaluate_gap_matrix(args: AgenticToolQueryDispatchArgs) {
  return new EvaluateGapMatrixQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    args.correlationId,
  );
}

export function get_admin_source_catalog(args: AgenticToolQueryDispatchArgs) {
  return new GetAdminSourceCatalogQuery(
    args.assessmentId,
    args.organizationId,
    args.input,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

export function get_legal_corpus_readiness(args: AgenticToolQueryDispatchArgs) {
  const { input } = args;
  return new GetLegalCorpusReadinessQuery(
    args.assessmentId,
    args.organizationId,
    new Date(`${requiredString(input.effectiveDate)}T00:00:00.000Z`),
    stripOptionalRef(optionalString(input.pinnedCorpusVersionId), "corpus_"),
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

export function retrieve_legal_basis(args: AgenticToolQueryDispatchArgs) {
  return new RetrieveLegalBasisQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

export function get_legal_rule_match(args: AgenticToolQueryDispatchArgs) {
  return new GetLegalRuleMatchQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

export function validate_citation_set(args: AgenticToolQueryDispatchArgs) {
  return new ValidateCitationSetQuery(
    args.assessmentId,
    args.organizationId,
    args.input as never,
    args.userId,
    null,
    null,
    args.correlationId,
  );
}

function requiredArtifactVersion(
  input: Record<string, unknown>,
  key: string,
): string {
  return requiredString(input[key]);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return record(value);
}

function requiredString(value: unknown): string {
  const result = optionalString(value);
  if (!result) {
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      { status: HttpStatus.NOT_FOUND },
    );
  }
  return result;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function numberWithDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function stripRef(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function stripOptionalRef(value: string | null, prefix: string): string | null {
  return value ? stripRef(value, prefix) : null;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : undefined;
}

function requiredEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  const parsed = optionalEnum(value, allowed);
  if (!parsed) {
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      { status: HttpStatus.NOT_FOUND },
    );
  }
  return parsed;
}

function typedStringArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T[] {
  const values = stringArray(value);
  if (values.length === 0) {
    return [];
  }
  const allowedSet = new Set(allowed);
  if (
    values.some((item) => !allowedSet.has(item as T)) ||
    new Set(values).size !== values.length
  ) {
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      { status: HttpStatus.NOT_FOUND },
    );
  }
  return values as T[];
}
