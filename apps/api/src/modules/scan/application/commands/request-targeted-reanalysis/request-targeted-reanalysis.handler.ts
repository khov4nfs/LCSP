import { randomUUID } from "node:crypto";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { GITHUB_INTEGRATION_EVENT_TYPES } from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";
import {
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TARGETED_REANALYSIS_CAPACITY_POLICY,
  TARGETED_REANALYSIS_REQUEST_STATES,
} from "@lcsp/contracts/scan";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import {
  toPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanTriggerSource,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import type { RequestTargetedReanalysisResponse } from "../../contracts/scan/targeted-reanalysis.contract.js";
import { RequestTargetedReanalysisCommand } from "./request-targeted-reanalysis.command.js";

const ALLOWED_ANALYZERS = new Set([
  "RUN_SEMGREP_RULES",
  "RUN_PYTHON_SEMANTIC_ANALYSIS",
  "RUN_TS_JS_SEMANTIC_ANALYSIS",
  "RUN_STRUCTURAL_AUGMENTATION",
]);

@CommandHandler(RequestTargetedReanalysisCommand)
export class RequestTargetedReanalysisHandler implements ICommandHandler<RequestTargetedReanalysisCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(
    command: RequestTargetedReanalysisCommand,
  ): Promise<RequestTargetedReanalysisResponse> {
    const { input, pbacContext, correlationId } = command;
    this.assertInput(input, correlationId);
    const organizationId = pbacContext.organizationId;

    const existing = await this.prisma.targetedReanalysisRequest.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.assessmentId !== input.assessmentId ||
        existing.inputEvidenceReportId !== input.inputEvidenceReportId
      ) {
        throw problemException(
          SCAN_ERROR_CODES.targetedReanalysisIdempotencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return {
        requestId: existing.id,
        state: existing.state,
        checkpointRef: existing.checkpointRef,
        alreadyQueued: true,
      };
    }

    const requestId = randomUUID();
    const scanJobId = randomUUID();
    const checkpointRef = `checkpoint:${requestId}`;
    const normalizedScope = input.pathPrefixes
      ? { pathPrefixes: [...input.pathPrefixes].sort() }
      : { subjectRefs: [...(input.subjectRefs ?? [])].sort() };
    const [report, snapshot] = await Promise.all([
      this.prisma.technicalEvidenceReport.findFirst({
        where: {
          id: input.inputEvidenceReportId,
          assessmentId: input.assessmentId,
          organizationId,
          snapshotId: input.snapshotId,
          status: "ACCEPTED",
        },
        select: { id: true },
      }),
      this.prisma.repositorySnapshot.findFirst({
        where: {
          id: input.snapshotId,
          assessmentId: input.assessmentId,
          organizationId,
          commitSha: input.commitSha,
        },
        select: { id: true },
      }),
    ]);
    if (!report || !snapshot) {
      throw problemException(
        SCAN_ERROR_CODES.evidenceReportNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${organizationId}))
      `;
      const now = new Date();
      const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const [fifteenMinuteCount, dailyCount, activeCount] = await Promise.all([
        tx.targetedReanalysisRequest.count({
          where: { organizationId, createdAt: { gte: fifteenMinutesAgo } },
        }),
        tx.targetedReanalysisRequest.count({
          where: { organizationId, createdAt: { gte: twentyFourHoursAgo } },
        }),
        tx.targetedReanalysisRequest.count({
          where: {
            organizationId,
            state: {
              in: [
                TARGETED_REANALYSIS_REQUEST_STATES.queued,
                TARGETED_REANALYSIS_REQUEST_STATES.dispatched,
                TARGETED_REANALYSIS_REQUEST_STATES.running,
              ],
            },
          },
        }),
      ]);
      if (
        fifteenMinuteCount >=
          TARGETED_REANALYSIS_CAPACITY_POLICY.maxRequestsPerFifteenMinutes ||
        dailyCount >=
          TARGETED_REANALYSIS_CAPACITY_POLICY.maxRequestsPerTwentyFourHours
      ) {
        throw problemException(
          SCAN_ERROR_CODES.targetedReanalysisRateLimited,
          correlationId,
          { status: HttpStatus.TOO_MANY_REQUESTS },
        );
      }
      if (
        activeCount >=
        TARGETED_REANALYSIS_CAPACITY_POLICY.maxActivePerOrganization
      ) {
        throw problemException(
          SCAN_ERROR_CODES.targetedReanalysisCapacityExhausted,
          correlationId,
          { status: HttpStatus.TOO_MANY_REQUESTS },
        );
      }
      const row = await tx.targetedReanalysisRequest.create({
        data: {
          id: requestId,
          scanJobId,
          assessmentId: input.assessmentId,
          organizationId,
          inputEvidenceReportId: input.inputEvidenceReportId,
          snapshotId: input.snapshotId,
          commitSha: input.commitSha,
          analyzerId: input.analyzerId,
          normalizedScope,
          reasonRequirementId: input.reasonRequirementId,
          idempotencyKey: input.idempotencyKey,
          checkpointRef,
          correlationId,
        },
      });
      await tx.targetedReanalysisCheckpoint.create({
        data: {
          id: checkpointRef,
          requestId,
          correlationId,
        },
      });
      await tx.repositoryScanJob.create({
        data: {
          id: scanJobId,
          assessmentId: input.assessmentId,
          snapshotId: input.snapshotId,
          organizationId,
          idempotencyKey: `reanalysis:${input.idempotencyKey}`,
          triggerSource: toPrismaRepositoryScanTriggerSource(
            REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
          ),
          status: toPrismaRepositoryScanJobStatus(
            REPOSITORY_SCAN_JOB_STATUSES.queued,
          ),
          correlationId,
        },
      });
      await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.targetedReanalysisRequest,
          aggregateId: requestId,
          eventType: GITHUB_INTEGRATION_EVENT_TYPES.targetedReanalysisRequested,
          organizationId,
          assessmentId: input.assessmentId,
          correlationId,
          causationId: correlationId,
          actor: { id: pbacContext.userId, type: AUDIT_ACTOR_TYPES.user },
          result: SCAN_EVENT_TYPES.targetedReanalysisQueuedAudit,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          authorizationAction: PBAC_ACTIONS.technicalEvidenceReanalyze,
          idempotencyKey: input.idempotencyKey,
          payload: {
            requestId,
            scanJobId,
            assessmentId: input.assessmentId,
            inputEvidenceReportId: input.inputEvidenceReportId,
            snapshotId: input.snapshotId,
            commitSha: input.commitSha,
            analyzerId: input.analyzerId,
            normalizedScope,
            checkpointRef,
            correlationId,
          },
        }),
        tx,
      );
      return row;
    });
    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.targetedReanalysisQueuedAudit,
      actorId: pbacContext.userId,
      organizationId,
      assessmentId: input.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.workerTask,
      resourceId: requestId,
      correlationId,
      causationId: correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: SCAN_EVENT_TYPES.targetedReanalysisQueuedAudit,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      payload: { requestId, checkpointRef, analyzerId: input.analyzerId },
    });
    return {
      requestId: created.id,
      state: TARGETED_REANALYSIS_REQUEST_STATES.queued,
      checkpointRef,
      alreadyQueued: false,
    };
  }

  private assertInput(
    input: RequestTargetedReanalysisCommand["input"],
    correlationId: string,
  ): void {
    const exactlyOneScope =
      Number(Boolean(input.pathPrefixes?.length)) +
        Number(Boolean(input.subjectRefs?.length)) ===
      1;
    if (!ALLOWED_ANALYZERS.has(input.analyzerId))
      throw problemException(
        SCAN_ERROR_CODES.targetedReanalysisInvalidAnalyzer,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    if (
      !exactlyOneScope ||
      (input.pathPrefixes?.length ?? 0) > 20 ||
      (input.subjectRefs?.length ?? 0) > 50
    )
      throw problemException(
        SCAN_ERROR_CODES.targetedReanalysisInvalidScope,
        correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
  }
}
