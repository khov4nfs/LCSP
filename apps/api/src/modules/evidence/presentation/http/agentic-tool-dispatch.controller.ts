import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { RBAC_DECISIONS } from "@lcsp/contracts/rbac";
import {
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  type AssessmentRuntimeStageCode,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Optional,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandBus, QueryBus } from "@nestjs/cqrs";

import type { AppConfig } from "../../../../config/config.types.js";
import {
  formatOrchestrationRuntimeLog,
  ORCHESTRATION_RUNTIME_LOG_EVENTS,
  sanitizeOrchestrationLogValue,
} from "../../../../platform/logging/orchestration-runtime-log.js";
import { RbacPreflightService } from "../../../../platform/rbac/rbac-preflight.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import {
  AssessmentRuntimeEventService,
  summarizeFailure,
} from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import {
  buildAgenticToolCommand,
  isAgenticToolCommand,
  isAgenticToolProtectedCommand,
} from "./agentic-tool-command-dispatcher.js";
import {
  dispatchAgenticToolInternalCommand,
  isAgenticToolInternalCommand,
} from "./agentic-tool-internal-dispatcher.js";
import { buildAgenticToolQuery } from "./agentic-tool-query-dispatcher.js";

type DispatchRequest = {
  tool_name?: unknown;
  assessment_id?: unknown;
  user_id?: unknown;
  artifact_versions?: unknown;
  input?: unknown;
  correlationId?: unknown;
  workflow_run_id?: unknown;
  workflowRunId?: unknown;
  run_id?: unknown;
  runId?: unknown;
};

type ToolExecutionArgs = {
  toolName: string;
  assessmentId: string;
  userId: string;
  correlationId: string;
  artifactVersions: Record<string, unknown>;
  input: Record<string, unknown>;
};

@Controller("internal/evidence/agentic-tools")
@UseGuards(WorkerApiKeyGuard)
export class InternalAgenticToolDispatchController {
  private readonly logger = new Logger(
    InternalAgenticToolDispatchController.name,
  );

  constructor(
    private readonly queryBus: QueryBus,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
    @Optional() private readonly commandBus?: CommandBus,
    @Optional() private readonly rbacPreflight?: RbacPreflightService,
  ) {}

  @Post("dispatch")
  @HttpCode(HttpStatus.OK)
  async dispatch(@Body() payload: DispatchRequest) {
    const toolName = requiredString(payload.tool_name);
    const assessmentId = requiredString(payload.assessment_id);
    const userId = requiredString(payload.user_id);
    const correlationId = requiredString(payload.correlationId);
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
            artifactVersions,
            input: sanitizeOrchestrationLogValue(input),
          },
        ),
      );
    }

    await this.runtimeEvents.recordRunStartedIfMissing({
      assessmentId,
      runId,
      correlationId,
      stage,
      summary: "Assessment orchestration run started",
      startedAt,
    });
    await this.runtimeEvents.recordRunStageChangedIfNeeded({
      assessmentId,
      runId,
      correlationId,
      stage,
      runStatus: ASSESSMENT_RUNTIME_RUN_STATUSES.running,
      summary: `Entered ${humanizeRuntimeStage(stage)} stage`,
      startedAt,
    });
    await this.runtimeEvents.recordToolStarted({
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
      const result = await this.executeTool({
        toolName,
        assessmentId,
        userId,
        correlationId,
        artifactVersions,
        input,
      });

      if (isNeedsInputResult(result)) {
        await this.runtimeEvents.recordToolWaitingInput({
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

  private async executeTool(args: ToolExecutionArgs): Promise<unknown> {
    if (isAgenticToolInternalCommand(args.toolName)) {
      return dispatchAgenticToolInternalCommand(
        args,
        this.requireCommandBus(args.correlationId),
      );
    }

    if (isAgenticToolCommand(args.toolName)) {
      if (isAgenticToolProtectedCommand(args.toolName)) {
        await this.authorizeProtectedCommand(args);
      }
      return this.requireCommandBus(args.correlationId).execute(
        buildAgenticToolCommand({
          toolName: args.toolName,
          assessmentId: args.assessmentId,
          userId: args.userId,
          correlationId: args.correlationId,
          input: args.input,
        }),
      );
    }

    return this.queryBus.execute(buildAgenticToolQuery(args));
  }

  private async authorizeProtectedCommand(
    args: ToolExecutionArgs,
  ): Promise<object> {
    if (!this.rbacPreflight) {
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        args.correlationId,
        {
          status: HttpStatus.SERVICE_UNAVAILABLE,
        },
      );
    }

    const authorization = await this.rbacPreflight.evaluate({
      userId: args.userId,
      requiredRoles: [AUTH_USER_ROLES.customer],
      correlationId: args.correlationId,
    });

    if (authorization.decision !== RBAC_DECISIONS.allow) {
      throw problemException(AUTH_ERROR_CODES.rbacDenied, args.correlationId, {
        status: HttpStatus.FORBIDDEN,
      });
    }

    return {};
  }

  private requireCommandBus(correlationId: string): CommandBus {
    if (!this.commandBus) {
      throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
    return this.commandBus;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
  AGENTIC_TOOL_NAMES.retrieveVerifiedEpisodes,
  AGENTIC_TOOL_NAMES.captureVerifiedEpisode,
  AGENTIC_TOOL_NAMES.consolidateVerifiedEpisodes,
]);

const RECONCILIATION_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.getArtifactChain,
  AGENTIC_TOOL_NAMES.proposeMissingTargets,
  AGENTIC_TOOL_NAMES.getReconciliationContext,
]);

const CLASSIFICATION_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.getGapRequirements,
  AGENTIC_TOOL_NAMES.evaluateGapMatrix,
  AGENTIC_TOOL_NAMES.getGapEvidenceTrace,
  AGENTIC_TOOL_NAMES.proposeGapRemediation,
]);

const LEGAL_RETRIEVAL_TOOL_NAMES = new Set<string>([
  AGENTIC_TOOL_NAMES.getAdminSourceCatalog,
  AGENTIC_TOOL_NAMES.getLegalCorpusReadiness,
  AGENTIC_TOOL_NAMES.retrieveLegalBasis,
  AGENTIC_TOOL_NAMES.validateCitationSet,
  AGENTIC_TOOL_NAMES.resumeWaitingRuns,
  AGENTIC_TOOL_NAMES.extractOfficialText,
  AGENTIC_TOOL_NAMES.runOcrFallback,
  AGENTIC_TOOL_NAMES.evaluateOcrQuality,
]);
