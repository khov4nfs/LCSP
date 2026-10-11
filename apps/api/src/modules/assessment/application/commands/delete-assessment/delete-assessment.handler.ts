import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES as Lifecycle,
  AGENT_EXECUTION_STATES as Execution,
  HUMAN_RESOLUTION_REQUEST_STATUSES as HumanRequest,
  ASSESSMENT_LIFECYCLE_TRANSITIONS,
  AGENTIC_RUNTIME_TRANSITION_GUARDS as Guards,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  AUDIT_ACTOR_TYPES,
} from "@lcsp/contracts/audit";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import { Prisma } from "@prisma/client";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import {
  ASSESSMENT_RUNTIME_ERASURE,
  type AssessmentRuntimeErasurePort,
} from "../../ports/assessment-runtime-erasure.port.js";
import {
  ArtifactStorageService,
  chunkedManifestSchema,
} from "../../../../../platform/storage/artifact-storage.service.js";
import { eraseAssessmentLogs } from "../../../../../platform/logging/logging-context.js";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  ASSESSMENT_BILLING_RETENTION,
  type AssessmentBillingRetentionPort,
} from "../../ports/billing/assessment-billing-retention.port.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import {
  DeleteAssessmentCommand,
  type DeleteAssessmentDto,
} from "./delete-assessment.command.js";

@CommandHandler(DeleteAssessmentCommand)
export class DeleteAssessmentHandler implements ICommandHandler<DeleteAssessmentCommand> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    @Inject(ASSESSMENT_BILLING_RETENTION)
    private readonly billingRetention: AssessmentBillingRetentionPort,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
    @Inject(ASSESSMENT_RUNTIME_ERASURE)
    private readonly runtimeErasure: AssessmentRuntimeErasurePort,
    private readonly storage: ArtifactStorageService,
  ) {}

  async execute(
    command: DeleteAssessmentCommand,
  ): Promise<DeleteAssessmentDto> {
    const assessment = await this.assessments.findById(command.assessmentId);
    if (!assessment) {
      const receipt = await this.prisma.auditEvent.findFirst({
        where: {
          eventType: ASSESSMENT_EVENT_TYPES.deleted,
          actorId: command.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: command.assessmentId,
        },
        select: { id: true },
      });
      if (receipt)
        return { assessment_id: command.assessmentId, deleted: true };
    }
    if (!assessment || assessment.ownerId !== command.actorId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    // Commit revocation before external erasure: a failed cleanup leaves a non-runnable
    // assessment and the same DELETE can safely finish it without a new runtime path.
    const threadId = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Assessment" WHERE id=${assessment.id} FOR UPDATE`,
      );
      if (!rows[0]) return null;
      const current = await tx.assessment.findUniqueOrThrow({
        where: { id: assessment.id },
        include: { runtime: true },
      });
      if (
        current.lifecycleState &&
        current.lifecycleRevision !== null &&
        ASSESSMENT_LIFECYCLE_TRANSITIONS[current.lifecycleState][
          Lifecycle.CANCELLED
        ]
      ) {
        await this.lifecycle.transitionVerifiedInTx(
          {
            assessmentId: assessment.id,
            expectedRevision: current.lifecycleRevision,
            toState: Lifecycle.CANCELLED,
            actorId: command.actorId,
            correlationId: command.correlationId,
          },
          tx,
          [Guards.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION],
          { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
        );
      }
      if (current.runtime) {
        await tx.assessmentRuntime.update({
          where: { assessmentId: assessment.id },
          data: {
            leaseToken: null,
            leaseExpiresAt: null,
            ...([
              Execution.QUEUED,
              Execution.RUNNING,
              Execution.INTERRUPTED,
              Execution.PAUSED,
            ].some((state) => state === current.runtime?.executionState)
              ? { executionState: Execution.CANCELLED }
              : {}),
          },
        });
      }
      await tx.assessmentHumanRequest.updateMany({
        where: { assessmentId: assessment.id, status: HumanRequest.OPEN },
        data: { status: HumanRequest.CANCELLED },
      });
      return current.runtime?.threadId ?? null;
    });
    if (threadId)
      await this.runtimeErasure.erase({
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        threadId,
      });

    const artifacts = await this.prisma.assessmentArtifact.findMany({
      where: { assessmentId: assessment.id },
      select: { storageRef: true },
    });
    const otherArtifacts = await this.prisma.assessmentArtifact.findMany({
      where: { assessmentId: { not: assessment.id } },
      select: { storageRef: true },
    });
    const protectedChunks = new Set(
      otherArtifacts.flatMap(({ storageRef }) =>
        storageRef
          ? chunkedManifestSchema.parse(JSON.parse(storageRef)).chunks
          : [],
      ),
    );
    for (const artifact of artifacts)
      if (artifact.storageRef)
        await this.storage.eraseImmutableArtifact(
          chunkedManifestSchema.parse(JSON.parse(artifact.storageRef)),
          protectedChunks,
        );
    await eraseAssessmentLogs(assessment.ownerId, assessment.id);

    // Credit reserved for this assessment is returned before the record goes
    // away; the reservation can no longer be released once its assessment link
    // is cleared, so the wallet would hold the credit forever.
    const releasedReservations =
      await this.billingRetention.releaseActiveReservations({
        assessmentId: assessment.id,
        userId: assessment.ownerId,
      });

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Assessment" WHERE id=${assessment.id} FOR UPDATE`,
      );
      if (!rows[0]) return;
      // Only metadata-only security/accounting receipts survive; erase all attributable payloads.
      await tx.auditEvent.updateMany({
        where: {
          OR: [
            { resourceId: assessment.id },
            { payload: { path: ["assessmentId"], equals: assessment.id } },
          ],
        },
        data: { payload: {} },
      });
      await this.auditWriter.writeInTx(
        {
          eventType: ASSESSMENT_EVENT_TYPES.deleted,
          actorId: command.actorId,
          assessmentId: assessment.id,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: assessment.id,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: ASSESSMENT_EVENT_TYPES.deleted,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            assessmentId: assessment.id,
            releasedReservations,
          },
        },
        tx,
      );
      // Billing records outlive the assessment as financial history, so the
      // database refuses to cascade them. Detaching keeps the record and lets
      // the assessment go.
      await this.billingRetention.detachAssessment(assessment.id, tx);
      const connections = await tx.repositoryConnection.findMany({
        where: { assessmentId: assessment.id },
        select: { id: true },
      });
      await tx.assessment.delete({ where: { id: assessment.id } });
      await tx.repositoryConnection.deleteMany({
        where: {
          id: { in: connections.map((connection) => connection.id) },
          userId: assessment.ownerId,
          assessmentId: null,
          snapshots: { none: {} },
        },
      });
      // AssessmentEvent cascades first, releasing its outbox FK. Generic outbox infrastructure stays.
      await tx.outboxMessage.deleteMany({
        where: {
          aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
          aggregateId: assessment.id,
        },
      });
    });

    return { assessment_id: assessment.id, deleted: true };
  }
}
