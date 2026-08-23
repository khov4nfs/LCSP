import * as crypto from "node:crypto";

import {
  AUDIT_ACTOR_IDS,
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  buildAuditEventInput,
} from "@lcsp/contracts/audit";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import {
  SCAN_CALLBACK_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
  TARGETED_REANALYSIS_CHECKPOINT_STATES,
  TARGETED_REANALYSIS_REQUEST_STATES,
  TECHNICAL_EVIDENCE_REPORT_STATUSES,
} from "@lcsp/contracts/scan";
import { ASSESSMENT_RUNTIME_STAGE_CODES } from "@lcsp/contracts/evidence";
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import {
  fromPrismaRepositoryScanJobStatus,
  fromPrismaEvidenceAcceptanceStatus,
  toPrismaAuditResourceType,
  toPrismaAuthDecision,
  toPrismaEvidenceAcceptanceStatus,
  toPrismaOutboxAggregateType,
  toPrismaRepositoryScanJobStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemResult } from "../../../../../platform/problems/problem-factory.js";
import { AssessmentRuntimeEventService } from "../../../../../platform/runtime-events/assessment-runtime-event.service.js";
import type { ScanCallbackDto } from "../../contracts/scan/scan-callback.contract.js";
import { EvidenceSchemaValidatorService } from "../../services/scan/evidence-schema-validator.service.js";
import { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";
import { ProcessScanCallbackCommand } from "./process-scan-callback.command.js";

const SCANNER_WORKER_ACTOR_ID = AUDIT_ACTOR_IDS.scannerWorker;
const SCAN_CALLBACK_TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * Validates scanner callbacks and atomically transitions the scan job, persists evidence, updates targeted reanalysis, and emits audit/outbox state.
 */
@CommandHandler(ProcessScanCallbackCommand)
export class ProcessScanCallbackHandler implements ICommandHandler<ProcessScanCallbackCommand> {
  private readonly logger = new Logger(ProcessScanCallbackHandler.name);

  /**
   * Creates the callback handler with persistence, schema-validation, and audit dependencies.
   *
   * @param prisma - Prisma service used to resolve and transactionally update scan/evidence state.
   * @param validator - Validator enforcing evidence schema and privacy constraints before persistence.
   * @param auditWriter - Audit writer used to record callbacks rejected before the transaction begins.
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly validator: EvidenceSchemaValidatorService,
    private readonly auditWriter: AuditWriterService,
    private readonly storageService: ArtifactStorageService,
    private readonly runtimeEvents: AssessmentRuntimeEventService,
  ) {}

  /**
   * Processes one active scan-job callback and produces an accepted or rejected technical evidence report.
   *
   * @param command - Scan-job identifier, worker callback payload, and correlation context.
   * @returns Callback acknowledgement with the persisted evidence report identifier.
   * @throws When the scan job is missing/inactive or evidence validation fails.
   */
  async execute(command: ProcessScanCallbackCommand): Promise<ScanCallbackDto> {
    if (
      command.payload.is_artifact_reference &&
      command.payload.artifact_manifest
    ) {
      try {
        const reconstructed = await this.storageService.readAndReconstruct(
          command.payload.artifact_manifest,
        );
        const fullPayload = JSON.parse(reconstructed) as Record<
          string,
          unknown
        >;
        Object.assign(command.payload, fullPayload);
        command.payload.is_artifact_reference = false;
      } catch {
        throw new UnprocessableEntityException(
          this.errorBody(
            command,
            SCAN_ERROR_CODES.artifactStorageError,
            HttpStatus.UNPROCESSABLE_ENTITY,
          ),
        );
      }
    }

    const job = await this.prisma.repositoryScanJob.findUnique({
      where: { id: command.scanJobId },
      select: {
        id: true,
        assessmentId: true,
        snapshotId: true,
        organizationId: true,
        status: true,
      },
    });
    if (!job) {
      throw new NotFoundException(
        this.errorBody(
          command,
          SCAN_ERROR_CODES.jobNotFound,
          HttpStatus.NOT_FOUND,
        ),
      );
    }
    const currentJobStatus = fromPrismaRepositoryScanJobStatus(job.status);
    if (
      currentJobStatus !== REPOSITORY_SCAN_JOB_STATUSES.queued &&
      currentJobStatus !== REPOSITORY_SCAN_JOB_STATUSES.running
    ) {
      const duplicateResponse =
        await this.acknowledgeDuplicateTerminalCallback(command);
      if (duplicateResponse) {
        return duplicateResponse;
      }
      this.logger.warn(
        `Scan callback rejected because job is not active: ${currentJobStatus}`,
      );
      throw new ConflictException(
        this.errorBody(
          command,
          SCAN_ERROR_CODES.jobWrongState,
          HttpStatus.CONFLICT,
        ),
      );
    }

    try {
      this.validator.validate(
        command.scanJobId,
        command.payload,
        command.correlationId,
      );
    } catch (error) {
      await this.auditValidationRejection(command, job, error);
      throw error;
    }

    const isRejected = command.payload.status === SCAN_CALLBACK_STATUSES.failed;
    const reportId = crypto.randomUUID();
    const reportStatus = isRejected
      ? TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected
      : TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted;
    const nextJobStatus = isRejected
      ? REPOSITORY_SCAN_JOB_STATUSES.failed
      : REPOSITORY_SCAN_JOB_STATUSES.completed;
    const auditEventType = isRejected
      ? SCAN_EVENT_TYPES.evidenceRejectedAudit
      : SCAN_EVENT_TYPES.evidenceAcceptedAudit;
    const rejectionReason = isRejected
      ? (command.payload.error_code ?? null)
      : null;

    await this.prisma.$transaction(
      async (tx) => {
        const transition = await tx.repositoryScanJob.updateMany({
          where: {
            id: job.id,
            status: {
              in: [
                toPrismaRepositoryScanJobStatus(
                  REPOSITORY_SCAN_JOB_STATUSES.queued,
                ),
                toPrismaRepositoryScanJobStatus(
                  REPOSITORY_SCAN_JOB_STATUSES.running,
                ),
              ],
            },
          },
          data: { status: toPrismaRepositoryScanJobStatus(nextJobStatus) },
        });
        if (transition.count !== 1) {
          throw new ConflictException(
            this.errorBody(
              command,
              SCAN_ERROR_CODES.jobWrongState,
              HttpStatus.CONFLICT,
            ),
          );
        }

        await tx.technicalEvidenceReport.create({
          data: {
            id: reportId,
            scanJobId: job.id,
            assessmentId: job.assessmentId,
            organizationId: job.organizationId,
            snapshotId: job.snapshotId,
            toolsVersion: command.payload
              .tools_version as Prisma.InputJsonValue,
            configHash: command.payload.config_hash as Prisma.InputJsonValue,
            evidencePayload: command.payload
              .evidence_payload as Prisma.InputJsonValue,
            privacyFlags: command.payload
              .privacy_flags as Prisma.InputJsonValue,
            schemaVersion: command.payload.schema_version,
            status: toPrismaEvidenceAcceptanceStatus(reportStatus),
            rejectionReason,
          },
        });

        await tx.targetedReanalysisRequest.updateMany({
          where: {
            scanJobId: job.id,
            state: TARGETED_REANALYSIS_REQUEST_STATES.running,
          },
          data: isRejected
            ? {
                state: TARGETED_REANALYSIS_REQUEST_STATES.failed,
                safeFailureCode: rejectionReason,
              }
            : {
                state: TARGETED_REANALYSIS_REQUEST_STATES.completed,
                outputEvidenceReportId: reportId,
              },
        });
        await tx.targetedReanalysisCheckpoint.updateMany({
          where: { request: { scanJobId: job.id } },
          data: isRejected
            ? {
                state: TARGETED_REANALYSIS_CHECKPOINT_STATES.failed,
                safeFailureCode: rejectionReason,
              }
            : {
                state: TARGETED_REANALYSIS_CHECKPOINT_STATES.completed,
                outputEvidenceReportId: reportId,
              },
        });

        if (!isRejected) {
          const event = buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.technicalEvidenceReport,
            aggregateId: reportId,
            eventType: SCAN_EVENT_TYPES.evidenceAccepted,
            organizationId: job.organizationId,
            assessmentId: job.assessmentId,
            correlationId: command.correlationId,
            causationId: job.id,
            actor: {
              id: SCANNER_WORKER_ACTOR_ID,
              type: AUDIT_ACTOR_TYPES.service,
            },
            result: SCAN_EVENT_TYPES.evidenceAcceptedAudit,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            idempotencyKey: `${reportId}:${SCAN_EVENT_TYPES.evidenceAccepted}`,
            payload: {
              evidenceReportId: reportId,
              assessmentId: job.assessmentId,
              scanJobId: job.id,
              correlationId: command.correlationId,
            },
          });
          await tx.outboxMessage.create({
            data: {
              id: crypto.randomUUID(),
              aggregateType: toPrismaOutboxAggregateType(event.aggregateType),
              aggregateId: event.aggregateId,
              eventType: event.eventType,
              payload: event.payload as Prisma.InputJsonValue,
            },
          });
        }

        const auditEvent = buildAuditEventInput({
          eventType: auditEventType,
          actorId: SCANNER_WORKER_ACTOR_ID,
          organizationId: job.organizationId,
          assessmentId: job.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.technicalEvidenceReport,
          resourceId: reportId,
          correlationId: command.correlationId,
          reasonCode: rejectionReason,
          causationId: job.id,
          decision: isRejected ? AUDIT_DECISIONS.deny : AUDIT_DECISIONS.allow,
          result: auditEventType,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          actor: {
            id: SCANNER_WORKER_ACTOR_ID,
            type: AUDIT_ACTOR_TYPES.service,
          },
          payload: {
            evidenceReportId: reportId,
            assessmentId: job.assessmentId,
            scanJobId: job.id,
            evidenceSchemaVersion: command.payload.schema_version,
            correlationId: command.correlationId,
          },
        });
        await tx.authAuditEvent.create({
          data: {
            id: crypto.randomUUID(),
            eventType: auditEvent.eventType,
            actorId: auditEvent.actorId,
            organizationId: auditEvent.organizationId,
            resourceType: auditEvent.resourceType
              ? toPrismaAuditResourceType(auditEvent.resourceType)
              : null,
            resourceId: auditEvent.resourceId ?? null,
            correlationId: auditEvent.correlationId,
            reasonCode: auditEvent.reasonCode ?? null,
            decision: auditEvent.decision
              ? toPrismaAuthDecision(auditEvent.decision)
              : null,
            payload: auditEvent.payload as Prisma.InputJsonValue,
          },
        });
      },
      { timeout: SCAN_CALLBACK_TRANSACTION_TIMEOUT_MS },
    );

    await this.recordAcceptedCallbackRuntimeClose(command, job, isRejected);

    return {
      accepted: !isRejected,
      evidence_report_id: reportId,
      correlationId: command.correlationId,
    };
  }

  private async acknowledgeDuplicateTerminalCallback(
    command: ProcessScanCallbackCommand,
  ): Promise<ScanCallbackDto | null> {
    const existingReport = await this.prisma.technicalEvidenceReport.findFirst({
      where: { scanJobId: command.scanJobId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (!existingReport) {
      return null;
    }
    const existingStatus = fromPrismaEvidenceAcceptanceStatus(
      existingReport.status,
    );
    const callbackStatus =
      command.payload.status === SCAN_CALLBACK_STATUSES.failed
        ? TECHNICAL_EVIDENCE_REPORT_STATUSES.rejected
        : TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted;
    if (existingStatus !== callbackStatus) {
      return null;
    }
    return {
      accepted: existingStatus === TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
      evidence_report_id: existingReport.id,
      correlationId: command.correlationId,
    };
  }

  /**
   * Closes scan runtime parent steps when the callback has been accepted by the API.
   *
   * @param command - Callback command providing scan-job and correlation identity.
   * @param job - Resolved scan job carrying tenant and assessment identity.
   * @param isRejected - Whether the callback represented a failed scan result.
   */
  private async recordAcceptedCallbackRuntimeClose(
    command: ProcessScanCallbackCommand,
    job: {
      id: string;
      assessmentId: string;
      organizationId: string;
    },
    isRejected: boolean,
  ): Promise<void> {
    const baseEvent = {
      organizationId: job.organizationId,
      assessmentId: job.assessmentId,
      runId: job.id,
      correlationId: command.correlationId,
      stage: ASSESSMENT_RUNTIME_STAGE_CODES.scan,
      completedAt: new Date(),
    };

    if (isRejected) {
      const errorSummary = `Callback rejected with status ${command.payload.status}${
        command.payload.error_code ? ` (${command.payload.error_code})` : ""
      }`;
      await this.runtimeEvents.recordToolFailed({
        ...baseEvent,
        toolName: "submit_scan_callback",
        summary: "Technical evidence callback was rejected",
        errorSummary,
      });
      await this.runtimeEvents.recordRunFailed({
        ...baseEvent,
        toolName: "repository_scan",
        summary: "Repository scan callback was rejected",
        errorSummary,
      });
      return;
    }

    await this.runtimeEvents.recordToolCompleted({
      ...baseEvent,
      toolName: "submit_scan_callback",
      summary: "Technical evidence callback was accepted",
      outputSummary: {
        status: command.payload.status,
        schemaVersion: command.payload.schema_version,
      },
    });
    await this.runtimeEvents.recordRunCompleted({
      ...baseEvent,
      toolName: "repository_scan",
      summary: "Repository scan completed",
      outputSummary: {
        status: command.payload.status,
        schemaVersion: command.payload.schema_version,
      },
    });
  }

  /**
   * Records an auditable rejection when the callback fails schema/privacy validation before evidence persistence.
   *
   * @param command - Callback command that failed validation.
   * @param job - Resolved scan-job identity and tenant context.
   * @param error - Validation exception used to derive a stable rejection reason code.
   * @returns A promise that resolves after the rejection audit event is written.
   */
  private async auditValidationRejection(
    command: ProcessScanCallbackCommand,
    job: {
      id: string;
      assessmentId: string;
      organizationId: string;
    },
    error: unknown,
  ): Promise<void> {
    const reasonCode = errorCode(error);
    await this.auditWriter.write(
      buildAuditEventInput({
        eventType: SCAN_EVENT_TYPES.evidenceRejectedAudit,
        actorId: SCANNER_WORKER_ACTOR_ID,
        organizationId: job.organizationId,
        assessmentId: job.assessmentId,
        resourceType: AUDIT_RESOURCE_TYPES.repositoryScanJob,
        resourceId: job.id,
        correlationId: command.correlationId,
        causationId: job.id,
        reasonCode,
        decision: AUDIT_DECISIONS.deny,
        result: SCAN_EVENT_TYPES.evidenceRejectedAudit,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        actor: { id: SCANNER_WORKER_ACTOR_ID, type: AUDIT_ACTOR_TYPES.service },
        payload: {
          assessmentId: job.assessmentId,
          scanJobId: job.id,
          reasonCode,
          correlationId: command.correlationId,
        },
      }),
    );
  }

  /**
   * Builds the standardized scan problem response used by callback state and lookup failures.
   *
   * @param command - Callback command providing the correlation identifier.
   * @param errorCode - Stable scan-domain error code.
   * @param status - HTTP status associated with the problem.
   * @returns Standard problem result payload.
   */
  private errorBody(
    command: ProcessScanCallbackCommand,
    errorCode: string,
    status = HttpStatus.BAD_REQUEST,
  ) {
    return problemResult(errorCode, command.correlationId, {
      status,
    });
  }
}

/**
 * Extracts a stable error code from a standardized HTTP exception, falling back to evidence-schema failure.
 *
 * @param error - Validation error to inspect.
 * @returns Error code suitable for the audit rejection reason.
 */
function errorCode(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === "object") {
      const value = (response as Record<string, unknown>).error_code;
      if (typeof value === "string") return value;
    }
  }
  return SCAN_ERROR_CODES.evidenceSchemaInvalid;
}
