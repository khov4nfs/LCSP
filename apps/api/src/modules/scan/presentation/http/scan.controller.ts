import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_RUNTIME_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
  ASSESSMENT_RUNTIME_STAGE_CODES,
  type AssessmentRuntimeEventType,
  type AssessmentRuntimeRunStatus,
  type AssessmentRuntimeStageCode,
  type AssessmentRuntimeSummaryValue,
} from "@lcsp/contracts/evidence";
import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  REQUEST_TARGETED_REANALYSIS_TOOL,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TARGETED_REANALYSIS_CAPACITY_POLICY,
  TARGETED_REANALYSIS_CHECKPOINT_STATES,
  TARGETED_REANALYSIS_REQUEST_STATES,
  type TargetedReanalysisTerminalState,
} from "@lcsp/contracts/scan";

import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import type { ScanCallbackRequest } from "../../application/contracts/scan/scan-callback.contract.js";
import { ProcessScanCallbackCommand } from "../../application/commands/process-scan-callback/process-scan-callback.command.js";
import { GetScanJobQuery } from "../../application/queries/get-scan-job/get-scan-job.query.js";
import { RerunScanCommand } from "../../application/commands/rerun-scan/rerun-scan.command.js";
import { RequestTargetedReanalysisCommand } from "../../application/commands/request-targeted-reanalysis/request-targeted-reanalysis.command.js";
import type { RerunScanRequestDto } from "../../application/contracts/scan/rerun-scan.contract.js";
import { WorkerApiKeyGuard } from "./worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { AssessmentRuntimeEventService } from "../../../../platform/runtime-events/assessment-runtime-event.service.js";
import { ORCHESTRATION_RUNTIME_LOG_EVENTS } from "../../../../platform/logging/orchestration-runtime-log.js";
import { formatOrchestrationRuntimeLog } from "../../../../platform/logging/orchestration-runtime-log.js";

interface ScanStatusRequest {
  rbacContext: RbacRequestContext;
  correlationId: string;
}

interface TargetedReanalysisRequestBody {
  inputArtifactVersion: string;
  analyzerId: string;
  scope:
    | {
        pathPrefixes: string[];
      }
    | {
        subjectRefs: string[];
      };
  reasonRequirementId: string;
  idempotencyKey: string;
}

interface InternalTargetedReanalysisCreateBody extends TargetedReanalysisRequestBody {
  assessmentId: string;
  userId?: string;
}

interface WorkerRuntimeEventRequest {
  event_type?: unknown;
  run_status?: unknown;
  stage?: unknown;
  tool_name?: unknown;
  summary?: unknown;
  input_summary?: unknown;
  output_summary?: unknown;
  error_summary?: unknown;
  started_at?: unknown;
  completed_at?: unknown;
  duration_ms?: unknown;
  attempt?: unknown;
  waiting_reason?: unknown;
}

/**
 * Exposes RBAC-protected scan status, manual rerun, and targeted-reanalysis endpoints for assessments.
 */
@Controller("assessments/:assessmentId/scan-jobs")
export class ScanController {
  /**
   * Creates the scan controller with CQRS read and mutation dispatchers.
   *
   * @param queryBus - CQRS query bus used to retrieve scan-job status.
   * @param commandBus - CQRS command bus used to request reruns and targeted reanalysis.
   */
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  /**
   * Retrieves one scan-job status view under the caller's organization and RBAC scope.
   *
   * @param assessmentId - Assessment identifier from the route.
   * @param scanJobId - Scan-job identifier from the route.
   * @param request - Authenticated request containing RBAC and correlation context.
   * @returns The standard result envelope containing normalized scan-job status and guidance.
   */
  @Get(":scanJobId")
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer, AUTH_USER_ROLES.admin)
  async getScanJob(
    @Param("assessmentId") assessmentId: string,
    @Param("scanJobId") scanJobId: string,
    @Req() request: ScanStatusRequest,
  ) {
    const context = request.rbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetScanJobQuery(
          assessmentId,
          scanJobId,
          context.role,
          context.scope,
          request.correlationId,
        ),
      ),
    );
  }

  /**
   * Requests a manual rerun for a pinned repository snapshot.
   *
   * @param assessmentId - Assessment identifier from the route.
   * @param payload - Snapshot, idempotency key, and optional business reason for the rerun.
   * @param request - Authenticated request containing RBAC and correlation context.
   * @returns The standard result envelope containing the queued or deduplicated rerun job.
   */
  @Post("rerun")
  @HttpCode(201)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async rerunScan(
    @Param("assessmentId") assessmentId: string,
    @Body() payload: RerunScanRequestDto,
    @Req() request: ScanStatusRequest,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new RerunScanCommand(
          assessmentId,
          payload.snapshot_id,
          payload.idempotency_key,
          request.rbacContext,
          request.correlationId,
          payload.reason,
        ),
      ),
    );
  }

  /**
   * Requests bounded targeted reanalysis against an accepted technical evidence report.
   *
   * @param assessmentId - Assessment identifier associated with the evidence artifact.
   * @param evidenceReportId - Input technical evidence report that must match the request body artifact version.
   * @param body - Unknown HTTP body validated into the bounded targeted-reanalysis contract.
   * @param request - Authenticated request containing RBAC and correlation context.
   * @returns The standard result envelope containing agentic-tool queue metadata.
   * @throws When the request body violates the strict targeted-reanalysis contract.
   */
  @Post(":assessmentId/evidence-reports/:evidenceReportId/targeted-reanalysis")
  @HttpCode(200)
  @UseGuards(RbacGuard)
  @RequireRoles(AUTH_USER_ROLES.customer)
  async requestTargetedReanalysis(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Body() body: unknown,
    @Req() request: ScanStatusRequest,
  ) {
    const correlationId = request.correlationId || randomUUID();
    const input = parseTargetedReanalysisInput(
      body,
      evidenceReportId,
      correlationId,
    );
    return resultEnvelope(
      await this.commandBus.execute(
        new RequestTargetedReanalysisCommand(
          {
            assessmentId,
            ...input,
          },
          request.rbacContext,
          correlationId,
        ),
      ),
    );
  }
}

/**
 * Exposes worker-authenticated scan callback and internal targeted-reanalysis creation endpoints.
 */
@Controller("internal/scan-jobs")
export class InternalScanController {
  private readonly logger = new Logger(InternalScanController.name);

  /**
   * Creates the internal scan controller with command dispatch support.
   *
   * @param commandBus - CQRS command bus used to process worker callbacks and create reanalysis requests.
   */
  constructor(
    private readonly commandBus: CommandBus,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
  ) {}

  /**
   * Accepts a scanner-worker callback for one repository scan job.
   *
   * @param scanJobId - Scan-job identifier from the callback route.
   * @param payload - Scanner callback payload containing terminal status and sanitized evidence.
   * @param correlationId - Optional upstream correlation identifier; a UUID is generated when absent.
   * @returns The standard result envelope containing callback acceptance metadata.
   */
  @Post(":scanJobId/callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async processCallback(
    @Param("scanJobId") scanJobId: string,
    @Body() payload: ScanCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new ProcessScanCallbackCommand(
          scanJobId,
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }

  /**
   * Accepts privacy-safe scanner-worker runtime progress metadata for one active scan job.
   *
   * @param scanJobId - Scan-job identifier whose tenant and assessment context is resolved server-side.
   * @param payload - Sanitized runtime progress payload using shared runtime value sets.
   * @returns The standard result envelope indicating whether the progress event was persisted.
   */
  @Post(":scanJobId/runtime-events")
  @HttpCode(202)
  @UseGuards(WorkerApiKeyGuard)
  async recordRuntimeEvent(
    @Param("scanJobId") scanJobId: string,
    @Body() payload: WorkerRuntimeEventRequest,
  ) {
    const result = await this.runtimeEvents.recordScanWorkerEvent({
      scanJobId,
      ...parseWorkerRuntimeEventPayload(payload, "scan-runtime-event"),
    });
    if (!result.recorded && result.reason === "terminal") {
      return resultEnvelope({ recorded: false, reason: result.reason });
    }
    if (!result.recorded) {
      throw problemException(
        result.reason === "inactive"
          ? SCAN_ERROR_CODES.jobWrongState
          : SCAN_ERROR_CODES.jobNotFound,
        "scan-runtime-event",
        {
          status:
            result.reason === "inactive"
              ? HttpStatus.CONFLICT
              : HttpStatus.NOT_FOUND,
        },
      );
    }
    return resultEnvelope({ recorded: true });
  }

  /**
   * Creates targeted reanalysis from the trusted worker/runtime path using a synthetic manager RBAC context.
   *
   * @param body - Internal assessment/organization identity and bounded targeted-reanalysis input.
   * @param correlationId - Optional upstream correlation identifier; a UUID is generated when absent.
   * @returns The standard result envelope containing queued reanalysis metadata.
   * @throws When the bounded reanalysis input is invalid.
   */
  @Post("targeted-reanalysis")
  @HttpCode(202)
  @UseGuards(WorkerApiKeyGuard)
  async createTargetedReanalysis(
    @Body() body: InternalTargetedReanalysisCreateBody,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const resolvedCorrelationId = correlationId?.trim() || randomUUID();
    if ((process.env.ORCHESTRATION_DEBUG ?? "false").toLowerCase() === "true") {
      this.logger.debug(
        formatOrchestrationRuntimeLog(
          ORCHESTRATION_RUNTIME_LOG_EVENTS.targetedReanalysisCreate,
          {
            correlationId: resolvedCorrelationId,
            toolName: "request_targeted_reanalysis",
            assessmentId: body.assessmentId,
            analyzerId: body.analyzerId,
            scope: body.scope,
          },
        ),
      );
    }
    const input = parseTargetedReanalysisInput(
      {
        inputArtifactVersion: body.inputArtifactVersion,
        analyzerId: body.analyzerId,
        scope: body.scope,
        reasonRequirementId: body.reasonRequirementId,
        idempotencyKey: body.idempotencyKey,
      },
      body.inputArtifactVersion,
      resolvedCorrelationId,
    );
    return resultEnvelope(
      await this.commandBus.execute(
        new RequestTargetedReanalysisCommand(
          {
            assessmentId: body.assessmentId,
            ...input,
          },
          {
            userId:
              typeof body.userId === "string" && body.userId.trim().length > 0
                ? body.userId.trim()
                : "worker-runtime",
            sessionId: "worker-runtime",
            role: AUTH_USER_ROLES.customer,
            scope: body.assessmentId,
          },
          resolvedCorrelationId,
        ),
      ),
    );
  }
}

const TARGETED_REANALYSIS_ANALYZERS = new Set([
  "RUN_SEMGREP_RULES",
  "RUN_PYTHON_SEMANTIC_ANALYSIS",
  "RUN_TS_JS_SEMANTIC_ANALYSIS",
  "RUN_STRUCTURAL_AUGMENTATION",
]);
const EVIDENCE_REPORT_ID = /^ter_[A-Za-z0-9_-]{8,120}$/;
const REASON_REQUIREMENT_ID = /^requirement:[A-Za-z0-9_-]{1,120}$/;
const PATH_PREFIX = /^(?!\/|.*\.\.)[A-Za-z0-9._/-]+\/$/;
const SUBJECT_REF = /^(finding|symbol|node):[A-Za-z0-9_-]{8,120}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const TARGETED_REANALYSIS_KEYS = new Set([
  "inputArtifactVersion",
  "analyzerId",
  "scope",
  "reasonRequirementId",
  "idempotencyKey",
]);

/**
 * Strictly validates and normalizes the public/internal targeted-reanalysis request body before it reaches the command handler.
 *
 * @param value - Unknown request body to validate.
 * @param evidenceReportId - Evidence report identifier that the input artifact version must exactly match.
 * @param correlationId - Correlation identifier attached to validation problems.
 * @returns Normalized analyzer, exclusive scope, reason requirement, and idempotency input.
 * @throws An invalid-scope problem when keys, formats, scope shape, duplicates, or configured limits are invalid.
 */
function parseTargetedReanalysisInput(
  value: unknown,
  evidenceReportId: string,
  correlationId: string,
): TargetedReanalysisRequestBody {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !TARGETED_REANALYSIS_KEYS.has(key))
  ) {
    invalidTargetedReanalysisRequest(correlationId);
  }

  const {
    inputArtifactVersion,
    analyzerId,
    scope,
    reasonRequirementId,
    idempotencyKey,
  } = value;
  if (
    typeof inputArtifactVersion !== "string" ||
    inputArtifactVersion !== evidenceReportId ||
    !EVIDENCE_REPORT_ID.test(inputArtifactVersion) ||
    typeof analyzerId !== "string" ||
    !TARGETED_REANALYSIS_ANALYZERS.has(analyzerId) ||
    !isRecord(scope) ||
    typeof reasonRequirementId !== "string" ||
    !REASON_REQUIREMENT_ID.test(reasonRequirementId) ||
    typeof idempotencyKey !== "string" ||
    !IDEMPOTENCY_KEY.test(idempotencyKey)
  ) {
    invalidTargetedReanalysisRequest(correlationId);
  }

  const safePathPrefixes = readStringArray(scope.pathPrefixes);
  const safeSubjectRefs = readStringArray(scope.subjectRefs);
  const hasPathPrefixes = safePathPrefixes !== null;
  const hasSubjectRefs = safeSubjectRefs !== null;
  if (Number(hasPathPrefixes) + Number(hasSubjectRefs) !== 1) {
    invalidTargetedReanalysisRequest(correlationId);
  }

  if (hasPathPrefixes) {
    if (
      safePathPrefixes.length === 0 ||
      safePathPrefixes.length >
        REQUEST_TARGETED_REANALYSIS_TOOL.maxPathPrefixes ||
      new Set(safePathPrefixes).size !== safePathPrefixes.length ||
      safePathPrefixes.some(
        (item) => typeof item !== "string" || !PATH_PREFIX.test(item),
      )
    ) {
      invalidTargetedReanalysisRequest(correlationId);
    }
    return {
      inputArtifactVersion,
      analyzerId,
      scope: { pathPrefixes: [...safePathPrefixes].sort() },
      reasonRequirementId,
      idempotencyKey,
    };
  }

  if (!safeSubjectRefs) {
    invalidTargetedReanalysisRequest(correlationId);
  }

  const validatedSubjectRefs = safeSubjectRefs;
  if (
    validatedSubjectRefs.length === 0 ||
    validatedSubjectRefs.length >
      REQUEST_TARGETED_REANALYSIS_TOOL.maxSubjectRefs ||
    new Set(validatedSubjectRefs).size !== validatedSubjectRefs.length ||
    validatedSubjectRefs.some(
      (item) => typeof item !== "string" || !SUBJECT_REF.test(item),
    )
  ) {
    invalidTargetedReanalysisRequest(correlationId);
  }
  return {
    inputArtifactVersion,
    analyzerId,
    scope: { subjectRefs: [...validatedSubjectRefs].sort() },
    reasonRequirementId,
    idempotencyKey,
  };
}

/**
 * Checks whether an unknown request value is a non-array object record.
 *
 * @param value - Unknown value to inspect.
 * @returns True when the value is record-like.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads an array only when every element is already a string, without coercion.
 *
 * @param value - Unknown scope field to inspect.
 * @returns A copied string array, or null when the field is absent/non-array/contains non-strings.
 */
function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.every((item) => typeof item === "string") ? [...value] : null;
}

/**
 * Throws the standardized targeted-reanalysis request validation problem.
 *
 * @param correlationId - Correlation identifier attached to the problem response.
 * @throws Always throws the invalid-scope unprocessable-entity problem.
 */
function invalidTargetedReanalysisRequest(correlationId: string): never {
  throw problemException(
    SCAN_ERROR_CODES.targetedReanalysisInvalidScope,
    correlationId,
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    },
  );
}

function parseWorkerRuntimeEventPayload(
  value: WorkerRuntimeEventRequest,
  correlationId: string,
) {
  const eventType = readRuntimeValue(
    value.event_type,
    ASSESSMENT_RUNTIME_EVENT_TYPES,
  ) as AssessmentRuntimeEventType | null;
  const runStatus = readRuntimeValue(
    value.run_status,
    ASSESSMENT_RUNTIME_RUN_STATUSES,
  ) as AssessmentRuntimeRunStatus | null;
  const stage = readRuntimeValue(
    value.stage,
    ASSESSMENT_RUNTIME_STAGE_CODES,
  ) as AssessmentRuntimeStageCode | null;
  const summary = optionalRuntimeString(value.summary);
  if (!eventType || !runStatus || !stage || !summary) {
    invalidWorkerRuntimeEvent(correlationId);
  }

  return {
    eventType,
    runStatus,
    stage,
    toolName: optionalRuntimeString(value.tool_name),
    summary,
    inputSummary: parseRuntimeSummaryValue(value.input_summary),
    outputSummary: parseRuntimeSummaryValue(value.output_summary),
    errorSummary: optionalRuntimeString(value.error_summary),
    startedAt: optionalDate(value.started_at, correlationId),
    completedAt: optionalDate(value.completed_at, correlationId),
    durationMs: optionalNonNegativeInteger(value.duration_ms, correlationId),
    attempt: optionalNonNegativeInteger(value.attempt, correlationId),
    waitingReason: optionalRuntimeString(value.waiting_reason),
  };
}

function readRuntimeValue(
  value: unknown,
  values: Record<string, string>,
): string | null {
  return typeof value === "string" && Object.values(values).includes(value)
    ? value
    : null;
}

function optionalRuntimeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseRuntimeSummaryValue(
  value: unknown,
): AssessmentRuntimeSummaryValue | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return value ?? null;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => parseRuntimeSummaryValue(item))
      .filter((item): item is AssessmentRuntimeSummaryValue => item !== null);
  }
  if (!isRecord(value)) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, parseRuntimeSummaryValue(item)])
      .filter((entry): entry is [string, AssessmentRuntimeSummaryValue] => {
        return entry[1] !== null;
      }),
  );
}

function optionalDate(value: unknown, correlationId: string): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    invalidWorkerRuntimeEvent(correlationId);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    invalidWorkerRuntimeEvent(correlationId);
  }
  return date;
}

function optionalNonNegativeInteger(
  value: unknown,
  correlationId: string,
): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    invalidWorkerRuntimeEvent(correlationId);
  }
  return value;
}

function invalidWorkerRuntimeEvent(correlationId: string): never {
  throw problemException(
    SCAN_ERROR_CODES.evidenceSchemaInvalid,
    correlationId,
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    },
  );
}

interface TargetedReanalysisTerminalPayload {
  state: TargetedReanalysisTerminalState;
  safe_failure_code?: string;
  output_evidence_report_id?: string;
}

/**
 * Exposes worker-authenticated targeted-reanalysis lifecycle operations used to fetch, claim, retry, and terminally transition queued work.
 */
@Controller("internal/targeted-reanalysis")
export class InternalTargetedReanalysisController {
  /**
   * Creates the internal lifecycle controller with reanalysis persistence and transition-audit support.
   *
   * @param prisma - Prisma service used to coordinate request/checkpoint state transitions and capacity checks.
   * @param auditWriter - Audit writer used to record worker lifecycle transitions.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Retrieves the worker-facing state and immutable execution inputs for one targeted-reanalysis request.
   *
   * @param requestId - Targeted-reanalysis request identifier.
   * @returns The standard result envelope containing the request record or null when absent.
   */
  @Get(":requestId")
  @UseGuards(WorkerApiKeyGuard)
  async getRequest(@Param("requestId") requestId: string) {
    const request = await this.prisma.targetedReanalysisRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        scanJobId: true,
        assessmentId: true,
        inputEvidenceReportId: true,
        snapshotId: true,
        commitSha: true,
        analyzerId: true,
        normalizedScope: true,
        reasonRequirementId: true,
        checkpointRef: true,
        state: true,
        correlationId: true,
      },
    });
    return resultEnvelope(request);
  }

  /**
   * Atomically claims a dispatched request for worker execution while enforcing the per-organization running limit.
   *
   * @param requestId - Dispatched targeted-reanalysis request to claim.
   * @returns The standard result envelope indicating whether the request transitioned to running.
   */
  @Post(":requestId/claim")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async claimRequest(@Param("requestId") requestId: string) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const request = await tx.targetedReanalysisRequest.findUnique({
        where: { id: requestId },
        select: {
          assessmentId: true,
          correlationId: true,
          state: true,
        },
      });
      if (
        !request ||
        request.state !== TARGETED_REANALYSIS_REQUEST_STATES.dispatched
      ) {
        return { claimed: false as const };
      }

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${request.assessmentId}))
      `;
      const runningCount = await tx.targetedReanalysisRequest.count({
        where: {
          state: TARGETED_REANALYSIS_REQUEST_STATES.running,
        },
      });
      if (
        runningCount >=
        TARGETED_REANALYSIS_CAPACITY_POLICY.maxRunningPerOrganization
      ) {
        return { claimed: false as const };
      }

      const updated = await tx.targetedReanalysisRequest.updateMany({
        where: {
          id: requestId,
          state: TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
        },
        data: {
          state: TARGETED_REANALYSIS_REQUEST_STATES.running,
          workerDeliveryAttempts: { increment: 1 },
        },
      });
      if (updated.count === 1) {
        await tx.targetedReanalysisCheckpoint.updateMany({
          where: { requestId },
          data: {
            state: TARGETED_REANALYSIS_CHECKPOINT_STATES.running,
            workerDeliveryAttempts: { increment: 1 },
          },
        });
      }
      return updated.count === 1
        ? {
            claimed: true as const,
            assessmentId: request.assessmentId,
            correlationId: request.correlationId,
          }
        : { claimed: false as const };
    });
    if (claimed.claimed)
      await this.writeTransitionAudit(
        requestId,
        claimed,
        SCAN_EVENT_TYPES.targetedReanalysisRunningAudit,
      );
    return resultEnvelope({ claimed: claimed.claimed });
  }

  /**
   * Moves a dispatched/running request into a worker-reported terminal failure or DLQ state and synchronizes its checkpoint.
   *
   * @param requestId - Targeted-reanalysis request to transition.
   * @param payload - Terminal state plus optional safe failure code and output evidence report identifier.
   * @returns The standard result envelope indicating whether the transition was applied.
   */
  @Post(":requestId/terminal")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async setTerminalState(
    @Param("requestId") requestId: string,
    @Body() payload: TargetedReanalysisTerminalPayload,
  ) {
    const auditRequest = await this.findRequestAuditContext(requestId);
    const request = await this.prisma.targetedReanalysisRequest.updateMany({
      where: {
        id: requestId,
        state: {
          in: [
            TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
            TARGETED_REANALYSIS_REQUEST_STATES.running,
          ],
        },
      },
      data: {
        state: payload.state,
        safeFailureCode: payload.safe_failure_code,
        outputEvidenceReportId: payload.output_evidence_report_id,
      },
    });
    if (request.count === 1) {
      await this.prisma.targetedReanalysisCheckpoint.updateMany({
        where: { requestId },
        data: {
          state:
            payload.state === TARGETED_REANALYSIS_REQUEST_STATES.dlq
              ? TARGETED_REANALYSIS_CHECKPOINT_STATES.dlq
              : TARGETED_REANALYSIS_CHECKPOINT_STATES.failed,
          safeFailureCode: payload.safe_failure_code,
          outputEvidenceReportId: payload.output_evidence_report_id,
        },
      });
      if (auditRequest) {
        await this.writeTransitionAudit(
          requestId,
          auditRequest,
          SCAN_EVENT_TYPES.targetedReanalysisTerminalAudit,
        );
      }
    }
    return resultEnvelope({ transitioned: request.count === 1 });
  }

  /**
   * Returns a running request to dispatched state for retry scheduling and updates its checkpoint accordingly.
   *
   * @param requestId - Running targeted-reanalysis request to requeue.
   * @returns The standard result envelope indicating whether the request was requeued.
   */
  @Post(":requestId/requeue")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async requeueRequest(@Param("requestId") requestId: string) {
    const auditRequest = await this.findRequestAuditContext(requestId);
    const request = await this.prisma.targetedReanalysisRequest.updateMany({
      where: {
        id: requestId,
        state: TARGETED_REANALYSIS_REQUEST_STATES.running,
      },
      data: { state: TARGETED_REANALYSIS_REQUEST_STATES.dispatched },
    });
    if (request.count === 1) {
      await this.prisma.targetedReanalysisCheckpoint.updateMany({
        where: { requestId },
        data: { state: TARGETED_REANALYSIS_CHECKPOINT_STATES.retryScheduled },
      });
      if (auditRequest) {
        await this.writeTransitionAudit(
          requestId,
          auditRequest,
          SCAN_EVENT_TYPES.targetedReanalysisRetryAudit,
        );
      }
    }
    return resultEnvelope({ requeued: request.count === 1 });
  }

  /**
   * Retrieves the tenant/assessment/correlation fields required to audit an internal lifecycle transition.
   *
   * @param requestId - Targeted-reanalysis request whose audit context should be resolved.
   * @returns Minimal audit context, or null when the request does not exist.
   */
  private async findRequestAuditContext(requestId: string): Promise<{
    assessmentId: string;
    correlationId: string;
  } | null> {
    return this.prisma.targetedReanalysisRequest.findUnique({
      where: { id: requestId },
      select: {
        assessmentId: true,
        correlationId: true,
      },
    });
  }

  /**
   * Records a worker-driven targeted-reanalysis lifecycle transition without exposing sensitive payload details.
   *
   * @param requestId - Targeted-reanalysis request whose transition is being audited.
   * @param request - Organization, assessment, and correlation context for the request.
   * @param eventType - Stable scan event type describing the lifecycle transition.
   * @returns A promise that resolves after the audit event is written.
   */
  private async writeTransitionAudit(
    requestId: string,
    request: {
      assessmentId: string;
      correlationId: string;
    },
    eventType: string,
  ): Promise<void> {
    await this.auditWriter.write({
      eventType,
      actorId: AUDIT_ACTOR_IDS.scannerWorker,
      assessmentId: request.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.workerTask,
      resourceId: requestId,
      correlationId: request.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: eventType,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      actor: {
        id: AUDIT_ACTOR_IDS.scannerWorker,
        type: AUDIT_ACTOR_TYPES.service,
      },
      payload: { requestId },
    });
  }
}
