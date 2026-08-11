import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
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

import { RequireAction } from "../../../../platform/pbac/decorators/require-action.decorator.js";
import type { PbacRequestContext } from "../../../../platform/pbac/interfaces/pbac-request.interface.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
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

interface ScanStatusRequest {
  pbacContext: PbacRequestContext;
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

@Controller("assessments/:assessmentId/scan-jobs")
export class ScanController {
  constructor(
    private readonly queryBus: QueryBus,
    private readonly commandBus: CommandBus,
  ) {}

  @Get(":scanJobId")
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.scanRead)
  async getScanJob(
    @Param("assessmentId") assessmentId: string,
    @Param("scanJobId") scanJobId: string,
    @Req() request: ScanStatusRequest,
  ) {
    const context = request.pbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetScanJobQuery(
          assessmentId,
          scanJobId,
          context.organizationId,
          context.subjectRole,
          context.scope,
          request.correlationId,
        ),
      ),
    );
  }

  @Post("rerun")
  @HttpCode(201)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.scanTrigger)
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
          request.pbacContext,
          request.correlationId,
          payload.reason,
        ),
      ),
    );
  }

  @Post(":assessmentId/evidence-reports/:evidenceReportId/targeted-reanalysis")
  @HttpCode(200)
  @UseGuards(PbacGuard)
  @RequireAction(PBAC_ACTIONS.technicalEvidenceReanalyze)
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
          request.pbacContext,
          correlationId,
        ),
      ),
    );
  }
}

@Controller("internal/scan-jobs")
export class InternalScanController {
  constructor(private readonly commandBus: CommandBus) {}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.every((item) => typeof item === "string") ? [...value] : null;
}

function invalidTargetedReanalysisRequest(correlationId: string): never {
  throw problemException(
    SCAN_ERROR_CODES.targetedReanalysisInvalidScope,
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

@Controller("internal/targeted-reanalysis")
export class InternalTargetedReanalysisController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

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

  @Post(":requestId/claim")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async claimRequest(@Param("requestId") requestId: string) {
    const claimed = await this.prisma.$transaction(async (tx) => {
      const request = await tx.targetedReanalysisRequest.findUnique({
        where: { id: requestId },
        select: {
          organizationId: true,
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
        SELECT pg_advisory_xact_lock(hashtext(${request.organizationId}))
      `;
      const runningCount = await tx.targetedReanalysisRequest.count({
        where: {
          organizationId: request.organizationId,
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
            organizationId: request.organizationId,
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

  private async findRequestAuditContext(requestId: string): Promise<{
    organizationId: string;
    assessmentId: string;
    correlationId: string;
  } | null> {
    return this.prisma.targetedReanalysisRequest.findUnique({
      where: { id: requestId },
      select: {
        organizationId: true,
        assessmentId: true,
        correlationId: true,
      },
    });
  }

  private async writeTransitionAudit(
    requestId: string,
    request: {
      organizationId: string;
      assessmentId: string;
      correlationId: string;
    },
    eventType: string,
  ): Promise<void> {
    await this.auditWriter.write({
      eventType,
      actorId: AUDIT_ACTOR_IDS.scannerWorker,
      organizationId: request.organizationId,
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
