import {
  AGENTIC_TOOL_NAMES,
  ARTIFACT_CHAIN_STAGES,
  ASSESSMENT_CONTEXT_ANSWER_FIELDS,
  ASSESSMENT_CONTEXT_INCLUDES,
  EVIDENCE_ERROR_CODES,
  VERIFIED_PROFILE_REQUIRED_FOR,
} from "@lcsp/contracts/evidence";
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";

import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { EvaluateGapMatrixQuery } from "../../../classification/application/queries/evaluate-gap-matrix/evaluate-gap-matrix.query.js";
import { GetClassificationBaselineQuery } from "../../../classification/application/queries/get-classification-baseline/get-classification-baseline.query.js";
import { GetGapEvidenceTraceQuery } from "../../../classification/application/queries/get-gap-evidence-trace/get-gap-evidence-trace.query.js";
import { ProposeGapRemediationQuery } from "../../../classification/application/queries/propose-gap-remediation/propose-gap-remediation.query.js";
import { ValidateClassificationProposalQuery } from "../../../classification/application/queries/validate-classification-proposal/validate-classification-proposal.query.js";
import { GetLegalCorpusReadinessQuery } from "../../../legal-rule-catalog/application/queries/get-legal-corpus-readiness/get-legal-corpus-readiness.query.js";
import { GetLegalRuleMatchQuery } from "../../../legal-rule-catalog/application/queries/get-legal-rule-match/get-legal-rule-match.query.js";
import { RetrieveLegalBasisQuery } from "../../../legal-rule-catalog/application/queries/retrieve-legal-basis/retrieve-legal-basis.query.js";
import { ValidateCitationSetQuery } from "../../../legal-rule-catalog/application/queries/validate-citation-set/validate-citation-set.query.js";
import { TARGET_CANDIDATE_KINDS } from "../../../reconciliation/application/contracts/missing-target-proposal.contract.js";
import { RECONCILIATION_CONTEXT_STATUSES } from "../../../reconciliation/application/contracts/reconciliation/reconciliation-context.contract.js";
import { GetArtifactChainQuery } from "../../../reconciliation/application/queries/get-artifact-chain/get-artifact-chain.query.js";
import { GetAssessmentContextQuery } from "../../../reconciliation/application/queries/get-assessment-context/get-assessment-context.query.js";
import { GetReconciliationContextQuery } from "../../../reconciliation/application/queries/get-reconciliation-context/get-reconciliation-context.query.js";
import { GetVerifiedProfileQuery } from "../../../reconciliation/application/queries/get-verified-profile/get-verified-profile.query.js";
import { ProposeMissingTargetsQuery } from "../../../reconciliation/application/queries/propose-missing-targets/propose-missing-targets.query.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
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

type DispatchRequest = {
  tool_name?: unknown;
  assessment_id?: unknown;
  organization_id?: unknown;
  user_id?: unknown;
  artifact_versions?: unknown;
  input?: unknown;
  correlation_id?: unknown;
};

@Controller("internal/evidence/agentic-tools")
@UseGuards(WorkerApiKeyGuard)
export class InternalAgenticToolDispatchController {
  constructor(private readonly queryBus: QueryBus) {}

  @Post("dispatch")
  @HttpCode(HttpStatus.OK)
  async dispatch(@Body() payload: DispatchRequest) {
    const toolName = requiredString(payload.tool_name);
    const assessmentId = requiredString(payload.assessment_id);
    const organizationId = requiredString(payload.organization_id);
    const userId = requiredString(payload.user_id);
    const correlationId = requiredString(payload.correlation_id);
    const artifactVersions = record(payload.artifact_versions) ?? {};
    const input = record(payload.input) ?? {};

    return resultEnvelope(
      await this.queryBus.execute(
        buildQuery({
          toolName,
          assessmentId,
          organizationId,
          userId,
          correlationId,
          artifactVersions,
          input,
        }),
      ),
    );
  }
}

function buildQuery(args: {
  toolName: string;
  assessmentId: string;
  organizationId: string;
  userId: string;
  correlationId: string;
  artifactVersions: Record<string, unknown>;
  input: Record<string, unknown>;
}) {
  const {
    toolName,
    assessmentId,
    organizationId,
    userId,
    correlationId,
    artifactVersions,
    input,
  } = args;

  switch (toolName) {
    case AGENTIC_TOOL_NAMES.getScanCoverage:
      return new GetScanCoverageQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        numberWithDefault(input.maxResults, 25),
        correlationId,
        stringArray(input.pathPrefixes),
        stringArray(input.languages),
        stringArray(input.dispositions) as Array<
          "ANALYZED" | "SKIPPED" | "LIMITED"
        >,
        stringArray(input.toolNames),
        optionalString(input.cursor),
      );
    case AGENTIC_TOOL_NAMES.searchEvidence:
      return new SearchEvidenceQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        numberWithDefault(input.maxResults, 25),
        correlationId,
        stringArray(input.findingKinds),
        stringArray(input.providers),
        stringArray(input.pathPrefixes),
        optionalEnum(
          input.minConfidence,
          Object.values(SEARCH_EVIDENCE_CONFIDENCE),
        ),
        optionalString(input.cursor),
      );
    case AGENTIC_TOOL_NAMES.getFindingDetail:
      return new GetFindingDetailQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.findingId), "finding:"),
        typedStringArray(input.include, Object.values(FINDING_DETAIL_INCLUDES)),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.findProviderInvocations:
      return new FindProviderInvocationsQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        numberWithDefault(input.maxResults, 25),
        correlationId,
        optionalEnum(
          input.provider,
          Object.values(PROVIDER_INVOCATION_PROVIDERS),
        ),
        stringArray(input.pathPrefixes),
        optionalEnum(
          input.framework,
          Object.values(PROVIDER_INVOCATION_FRAMEWORKS),
        ),
      );
    case AGENTIC_TOOL_NAMES.getEvidenceSubgraph:
      return new GetEvidenceSubgraphQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.seedRef), "node:"),
        requiredEnum(
          input.direction,
          Object.values(EVIDENCE_SUBGRAPH_DIRECTIONS),
        ),
        numberWithDefault(input.maxDepth, 2),
        numberWithDefault(input.maxNodes, 25),
        numberWithDefault(input.maxEdges, 50),
        correlationId,
        stringArray(input.nodeTypes),
        stringArray(input.edgeTypes),
      );
    case AGENTIC_TOOL_NAMES.getSymbolContext:
      return new GetSymbolContextQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.symbolRef), "symbol:"),
        typedStringArray(input.include, Object.values(SYMBOL_CONTEXT_INCLUDES)),
        numberWithDefault(input.maxNeighbors, 25),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.traceStaticFlow:
      return new TraceStaticFlowQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.startRef), "node:"),
        requiredEnum(input.direction, Object.values(STATIC_FLOW_DIRECTIONS)),
        numberWithDefault(input.maxHops, 5),
        correlationId,
        stringArray(input.desiredStages),
      );
    case AGENTIC_TOOL_NAMES.inspectHumanReviewPath:
      return new InspectHumanReviewPathQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.startRef), "node:"),
        typedStringArray(input.reviewKinds, Object.values(HUMAN_REVIEW_KINDS)),
        numberWithDefault(input.maxHops, 5),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.inspectDecisionPath:
      return new InspectDecisionPathQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.startRef), "node:"),
        typedStringArray(
          input.actionCategories,
          Object.values(DECISION_ACTION_CATEGORIES),
        ),
        numberWithDefault(input.maxHops, 5),
        numberWithDefault(input.maxResults, 25),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.inspectDataPath:
      return new InspectDataPathQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.startRef), "node:"),
        requiredEnum(input.direction, Object.values(DATA_PATH_DIRECTIONS)),
        typedStringArray(input.dataCategories, Object.values(DATA_CATEGORIES)),
        numberWithDefault(input.maxHops, 5),
        numberWithDefault(input.maxResults, 25),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.findSimilarSymbols:
      return new FindSimilarSymbolsQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        stripRef(requiredString(input.seedSymbolRef), "symbol:"),
        typedStringArray(
          input.dimensions,
          Object.values(SYMBOL_SIMILARITY_DIMENSIONS),
        ),
        numberWithDefault(input.maxResults, 25),
        correlationId,
        stringArray(input.pathPrefixes),
      );
    case AGENTIC_TOOL_NAMES.inspectDeploymentContext:
      return new InspectDeploymentContextQuery(
        assessmentId,
        organizationId,
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
        correlationId,
        stringArray(input.pathPrefixes),
        optionalString(input.cursor),
      );
    case AGENTIC_TOOL_NAMES.getAssessmentContext:
      return new GetAssessmentContextQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "wizardProfileId"),
        typedStringArray(
          input.include,
          Object.values(ASSESSMENT_CONTEXT_INCLUDES),
        ),
        typedStringArray(
          input.answerFields,
          Object.values(ASSESSMENT_CONTEXT_ANSWER_FIELDS),
        ),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.getArtifactChain:
      return new GetArtifactChainQuery(
        assessmentId,
        organizationId,
        correlationId,
        optionalRecord(input.anchor)
          ? optionalString(optionalRecord(input.anchor)?.artifactRef)
          : null,
        typedStringArray(
          input.requiredStages,
          Object.values(ARTIFACT_CHAIN_STAGES),
        ),
        input.exactVersions === true,
      );
    case AGENTIC_TOOL_NAMES.getReconciliationContext:
      return new GetReconciliationContextQuery(
        assessmentId,
        organizationId,
        correlationId,
        stripOptionalRef(optionalString(input.flowRef), "flow:"),
        stringArray(input.conflictIds).map((value) =>
          stripRef(value, "conflict:"),
        ),
        optionalString(input.cursor),
        numberWithDefault(input.maxResults, 25),
        typedStringArray(
          input.statuses,
          Object.values(RECONCILIATION_CONTEXT_STATUSES),
        ),
      );
    case AGENTIC_TOOL_NAMES.proposeMissingTargets:
      return new ProposeMissingTargetsQuery(
        assessmentId,
        organizationId,
        requiredArtifactVersion(artifactVersions, "wizardProfileId"),
        requiredArtifactVersion(artifactVersions, "technicalEvidenceReportId"),
        typedStringArray(
          input.candidateKinds,
          Object.values(TARGET_CANDIDATE_KINDS),
        ),
        stringArray(input.seedRefs),
        stringArray(input.excludeTargetIds),
        numberWithDefault(input.maxResults, 25),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.getVerifiedProfile:
      return new GetVerifiedProfileQuery(
        assessmentId,
        organizationId,
        stripRef(requiredString(input.verifiedProfileId), "verified:"),
        requiredString(input.expectedVersion),
        requiredEnum(
          input.requiredFor,
          Object.values(VERIFIED_PROFILE_REQUIRED_FOR),
        ),
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.getClassificationBaseline:
      return new GetClassificationBaselineQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        null,
        null,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.getGapEvidenceTrace:
      return new GetGapEvidenceTraceQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.proposeGapRemediation:
      return new ProposeGapRemediationQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.validateClassificationProposal:
      return new ValidateClassificationProposalQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        null,
        null,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.evaluateGapMatrix:
      return new EvaluateGapMatrixQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.getLegalCorpusReadiness:
      return new GetLegalCorpusReadinessQuery(
        assessmentId,
        organizationId,
        new Date(`${requiredString(input.effectiveDate)}T00:00:00.000Z`),
        stripOptionalRef(
          optionalString(input.pinnedCorpusVersionId),
          "corpus_",
        ),
        userId,
        null,
        null,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.retrieveLegalBasis:
      return new RetrieveLegalBasisQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        null,
        null,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.getLegalRuleMatch:
      return new GetLegalRuleMatchQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        null,
        null,
        correlationId,
      );
    case AGENTIC_TOOL_NAMES.validateCitationSet:
      return new ValidateCitationSetQuery(
        assessmentId,
        organizationId,
        input as never,
        userId,
        null,
        null,
        correlationId,
      );
    default:
      throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
  }
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
      {
        status: HttpStatus.NOT_FOUND,
      },
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
      {
        status: HttpStatus.NOT_FOUND,
      },
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
      {
        status: HttpStatus.NOT_FOUND,
      },
    );
  }
  return values as T[];
}
