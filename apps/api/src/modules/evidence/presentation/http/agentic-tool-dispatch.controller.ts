import {
  AGENTIC_TOOL_STATUSES,
  AGENTIC_TOOL_NAMES,
  ARTIFACT_CHAIN_STAGES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  type AssessmentRuntimeStageCode,
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
  Logger,
  Post,
  UseGuards,
} from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";

import { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../../../config/config.types.js";
import {
  formatOrchestrationRuntimeLog,
  ORCHESTRATION_RUNTIME_LOG_EVENTS,
  sanitizeOrchestrationLogValue,
} from "../../../../platform/logging/orchestration-runtime-log.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import {
  AssessmentRuntimeEventService,
  summarizeFailure,
} from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
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
import { PythonWorkerRuntimeClient } from "../../application/services/evidence/python-worker-runtime.client.js";

type DispatchRequest = {
  tool_name?: unknown;
  assessment_id?: unknown;
  organization_id?: unknown;
  user_id?: unknown;
  artifact_versions?: unknown;
  input?: unknown;
  correlationId?: unknown;
  workflow_run_id?: unknown;
  workflowRunId?: unknown;
  run_id?: unknown;
  runId?: unknown;
};

@Controller("internal/evidence/agentic-tools")
@UseGuards(WorkerApiKeyGuard)
export class InternalAgenticToolDispatchController {
  private readonly logger = new Logger(
    InternalAgenticToolDispatchController.name,
  );

  constructor(
    private readonly queryBus: QueryBus,
    private readonly pythonWorkerRuntime: PythonWorkerRuntimeClient,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
  ) {}

  @Post("dispatch")
  @HttpCode(HttpStatus.OK)
  async dispatch(@Body() payload: DispatchRequest) {
    const toolName = requiredString(payload.tool_name);
    const assessmentId = requiredString(payload.assessment_id);
    const organizationId = requiredString(payload.organization_id);
    const userId = requiredString(payload.user_id);
    const correlationId = requiredString(
      payload.correlationId ?? payload.correlationId,
    );
    const runId =
      optionalString(
        payload.workflow_run_id ??
          payload.workflowRunId ??
          payload.run_id ??
          payload.runId,
      ) ?? correlationId;
    const artifactVersions = record(payload.artifact_versions) ?? {};
    const input = record(payload.input) ?? {};
    const stage = runtimeStageForTool(toolName);
    const startedAt = new Date();

    if (
      this.configService.get("orchestration.debug", {
        infer: true,
      })
    ) {
      this.logger.debug(
        formatOrchestrationRuntimeLog(
          ORCHESTRATION_RUNTIME_LOG_EVENTS.dispatchReceived,
          {
            correlationId,
            toolName,
            assessmentId,
            organizationId,
            artifactVersions,
            input: sanitizeOrchestrationLogValue(input),
          },
        ),
      );
    }

    await this.runtimeEvents.recordRunStartedIfMissing({
      organizationId,
      assessmentId,
      runId,
      correlationId,
      stage,
      summary: "Assessment orchestration run started",
      startedAt,
    });
    await this.runtimeEvents.recordRunStageChangedIfNeeded({
      organizationId,
      assessmentId,
      runId,
      correlationId,
      stage,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      summary: `Entered ${humanizeRuntimeStage(stage)} stage`,
      startedAt,
    });
    await this.runtimeEvents.recordToolStarted({
      organizationId,
      assessmentId,
      runId,
      correlationId,
      stage,
      toolName,
      summary: startedSummaryForTool(toolName),
      inputSummary: buildToolInputSummary(toolName, input, artifactVersions),
      startedAt,
      attempt: inputAttempt(input),
    });

    try {
      const result = (
        toolName === AGENTIC_TOOL_NAMES.requestTargetedReanalysis
          ? await this.pythonWorkerRuntime.requestTargetedReanalysis(
              {
                assessmentId,
                organizationId,
                userId,
                inputArtifactVersion: requiredArtifactVersion(
                  artifactVersions,
                  "technicalEvidenceReportId",
                ),
                analyzerId: requiredString(input.analyzerId),
                scope: requiredScope(input.scope),
                reasonRequirementId: requiredString(input.reasonRequirementId),
                idempotencyKey: requiredString(input.idempotencyKey),
              },
              correlationId,
            )
          : toolName === AGENTIC_TOOL_NAMES.resumeWaitingRuns
            ? await this.pythonWorkerRuntime.resumeWaitingRuns(
                {
                  corpusVersionId: requiredArtifactVersion(
                    artifactVersions,
                    "corpusVersionId",
                  ),
                  maxRuns: numberWithDefault(input.maxRuns, 25),
                  idempotencyKey: requiredString(input.idempotencyKey),
                },
                correlationId,
              )
            : await this.queryBus.execute(
                buildQuery({
                  toolName,
                  assessmentId,
                  organizationId,
                  userId,
                  correlationId,
                  artifactVersions,
                  input,
                }),
              )
      ) as unknown;

      if (isNeedsInputResult(result)) {
        await this.runtimeEvents.recordToolWaitingInput({
          organizationId,
          assessmentId,
          runId,
          correlationId,
          stage,
          toolName,
          summary: waitingSummaryForTool(toolName),
          outputSummary: buildToolOutputSummary(result),
          waitingReason: resolveWaitingReason(result),
          startedAt,
          attempt: inputAttempt(input),
        });
      } else {
        await this.runtimeEvents.recordToolCompleted({
          organizationId,
          assessmentId,
          runId,
          correlationId,
          stage,
          toolName,
          summary: completedSummaryForTool(toolName, result),
          outputSummary: buildToolOutputSummary(result),
          startedAt,
          completedAt: new Date(),
          attempt: inputAttempt(input),
        });
      }

      return resultEnvelope(result);
    } catch (error) {
      await this.runtimeEvents.recordToolFailed({
        organizationId,
        assessmentId,
        runId,
        correlationId,
        stage,
        toolName,
        summary: failedSummaryForTool(toolName),
        errorSummary: summarizeFailure(error),
        startedAt,
        completedAt: new Date(),
        attempt: inputAttempt(input),
      });
      throw error;
    }
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

function requiredScope(
  value: unknown,
): { pathPrefixes: string[] } | { subjectRefs: string[] } {
  const scope = record(value);
  if (!scope) {
    throw problemException(
      EVIDENCE_ERROR_CODES.notFound,
      "internal-agentic-dispatch",
      {
        status: HttpStatus.NOT_FOUND,
      },
    );
  }
  const pathPrefixes = stringArray(scope.pathPrefixes);
  const subjectRefs = stringArray(scope.subjectRefs);
  if (pathPrefixes.length > 0 && subjectRefs.length === 0) {
    return { pathPrefixes };
  }
  if (subjectRefs.length > 0 && pathPrefixes.length === 0) {
    return { subjectRefs };
  }
  throw problemException(
    EVIDENCE_ERROR_CODES.notFound,
    "internal-agentic-dispatch",
    {
      status: HttpStatus.NOT_FOUND,
    },
  );
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

function runtimeStageForTool(toolName: string): AssessmentRuntimeStageCode {
  if (TECHNICAL_EVIDENCE_TOOL_NAMES.has(toolName)) {
    return ASSESSMENT_RUNTIME_STAGE_CODES.technicalEvidence;
  }
  if (RECONCILIATION_TOOL_NAMES.has(toolName)) {
    return ASSESSMENT_RUNTIME_STAGE_CODES.reconciliation;
  }
  if (CLASSIFICATION_TOOL_NAMES.has(toolName)) {
    return ASSESSMENT_RUNTIME_STAGE_CODES.classification;
  }
  if (LEGAL_RETRIEVAL_TOOL_NAMES.has(toolName)) {
    return ASSESSMENT_RUNTIME_STAGE_CODES.legalRetrieval;
  }
  return ASSESSMENT_RUNTIME_STAGE_CODES.documents;
}

function humanizeRuntimeStage(stage: string): string {
  return stage.toLowerCase().replaceAll("_", " ");
}

function startedSummaryForTool(toolName: string): string {
  return `Starting ${toolName}`;
}

function waitingSummaryForTool(toolName: string): string {
  return `${toolName} is waiting for additional input`;
}

function completedSummaryForTool(toolName: string, result: unknown): string {
  const count = resultCount(result);
  return count === null
    ? `Completed ${toolName}`
    : `Completed ${toolName} with ${count} item${count === 1 ? "" : "s"}`;
}

function failedSummaryForTool(toolName: string): string {
  return `Failed ${toolName}`;
}

function buildToolInputSummary(
  toolName: string,
  input: Record<string, unknown>,
  artifactVersions: Record<string, unknown>,
) {
  const summary: Record<string, unknown> = { toolName };
  if (typeof input.maxResults === "number") {
    summary.maxResults = input.maxResults;
  }
  if (typeof input.maxRuns === "number") {
    summary.maxRuns = input.maxRuns;
  }
  const pathPrefixes = stringArray(input.pathPrefixes);
  if (pathPrefixes.length > 0) {
    summary.pathPrefixes = pathPrefixes.slice(0, 5);
  }
  const subjectRefs = stringArray(input.subjectRefs);
  if (subjectRefs.length > 0) {
    summary.subjectRefs = subjectRefs.slice(0, 5);
  }
  const artifactVersionKeys = Object.keys(artifactVersions).sort();
  if (artifactVersionKeys.length > 0) {
    summary.artifactVersionKeys = artifactVersionKeys;
  }
  if (toolName === AGENTIC_TOOL_NAMES.requestTargetedReanalysis) {
    summary.analyzerId = optionalString(input.analyzerId);
  }
  return summary;
}

function buildToolOutputSummary(result: unknown) {
  const output = record(result);
  if (!output) {
    return null;
  }
  const summary: Record<string, unknown> = {};
  const status = optionalString(output.status);
  if (status) {
    summary.status = status;
  }
  const coverageState = optionalString(output.coverageState);
  if (coverageState) {
    summary.coverageState = coverageState;
  }
  const resultLimit = record(output.resultLimit);
  if (resultLimit) {
    summary.resultLimit = resultLimit;
  }
  const itemCount = resultCount(result);
  if (itemCount !== null) {
    summary.itemCount = itemCount;
  }
  return Object.keys(summary).length > 0 ? summary : null;
}

function inputAttempt(input: Record<string, unknown>): number | null {
  return typeof input.attempt === "number" && Number.isInteger(input.attempt)
    ? input.attempt
    : null;
}

function isNeedsInputResult(result: unknown): boolean {
  return record(result)?.status === AGENTIC_TOOL_STATUSES.needsInput;
}

function resolveWaitingReason(result: unknown): string | null {
  const body = record(result);
  if (!body) {
    return null;
  }
  return optionalString(body.waitingReason) ?? optionalString(body.reason);
}

function resultCount(result: unknown): number | null {
  const body = record(result);
  const data = record(body?.data);
  if (!data) {
    return null;
  }
  for (const value of Object.values(data)) {
    if (Array.isArray(value)) {
      return value.length;
    }
  }
  return null;
}

const TECHNICAL_EVIDENCE_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.getScanCoverage,
  AGENTIC_TOOL_NAMES.searchEvidence,
  AGENTIC_TOOL_NAMES.getFindingDetail,
  AGENTIC_TOOL_NAMES.findProviderInvocations,
  AGENTIC_TOOL_NAMES.getEvidenceSubgraph,
  AGENTIC_TOOL_NAMES.getSymbolContext,
  AGENTIC_TOOL_NAMES.traceStaticFlow,
  AGENTIC_TOOL_NAMES.inspectHumanReviewPath,
  AGENTIC_TOOL_NAMES.inspectDecisionPath,
  AGENTIC_TOOL_NAMES.inspectDataPath,
  AGENTIC_TOOL_NAMES.findSimilarSymbols,
  AGENTIC_TOOL_NAMES.inspectDeploymentContext,
  AGENTIC_TOOL_NAMES.requestTargetedReanalysis,
]);

const RECONCILIATION_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.getAssessmentContext,
  AGENTIC_TOOL_NAMES.getArtifactChain,
  AGENTIC_TOOL_NAMES.proposeMissingTargets,
  AGENTIC_TOOL_NAMES.getReconciliationContext,
  AGENTIC_TOOL_NAMES.getVerifiedProfile,
]);

const CLASSIFICATION_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.getClassificationBaseline,
  AGENTIC_TOOL_NAMES.validateClassificationProposal,
  AGENTIC_TOOL_NAMES.evaluateGapMatrix,
  AGENTIC_TOOL_NAMES.getGapEvidenceTrace,
  AGENTIC_TOOL_NAMES.proposeGapRemediation,
]);

const LEGAL_RETRIEVAL_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.getLegalCorpusReadiness,
  AGENTIC_TOOL_NAMES.retrieveLegalBasis,
  AGENTIC_TOOL_NAMES.getLegalRuleMatch,
  AGENTIC_TOOL_NAMES.validateCitationSet,
  AGENTIC_TOOL_NAMES.resumeWaitingRuns,
  AGENTIC_TOOL_NAMES.extractOfficialText,
  AGENTIC_TOOL_NAMES.runOcrFallback,
  AGENTIC_TOOL_NAMES.evaluateOcrQuality,
]);
