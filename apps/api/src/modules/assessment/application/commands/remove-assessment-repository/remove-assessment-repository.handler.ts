import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  REPOSITORY_SET_ERROR_CODES,
  removeAssessmentRepositoryResultSchema,
} from "@lcsp/contracts/assessment-domain";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma, RepositoryConnectionStatus } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  RemoveAssessmentRepositoryCommand,
  type RemoveAssessmentRepositoryDto,
} from "./remove-assessment-repository.command.js";

const REMOVABLE_LIFECYCLE_STATES: ReadonlyArray<string> = [
  ASSESSMENT_LIFECYCLE_STATES.CREATED,
  ASSESSMENT_LIFECYCLE_STATES.PREPARING,
  ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_REQUIRED_INPUT,
];

@CommandHandler(RemoveAssessmentRepositoryCommand)
export class RemoveAssessmentRepositoryHandler implements ICommandHandler<RemoveAssessmentRepositoryCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  /**
   * Business purpose: Let the customer drop a repository from an assessment they are still setting up, so the
   * repository set they finally pin contains only what they intend to assess.
   * Business rules:
   * - Only the assessment's customer owner may remove, and only while the assessment is still being set up
   *   (CREATED, PREPARING or WAITING_FOR_REQUIRED_INPUT).
   * - Once the repository set is pinned it is immutable (REPOSITORY_SET_IMMUTABLE); changing it means a new assessment.
   * - Removing a candidate snapshot never touches other repositories; when it was the connection's last
   *   snapshot the connection is revoked so it no longer counts as part of the setup.
   * Execution flow:
   * 1. Lock the assessment and authorize the owner and lifecycle.
   * 2. Reject when the repository set is already pinned.
   * 3. Delete the owned, unpinned candidate snapshot and revoke its connection when nothing else uses it.
   * 4. Audit the removal.
   * Failure cases:
   * - Foreign or missing assessment or snapshot is not found; a wrong lifecycle or a pinned set rejects with 409.
   * Side effects:
   * - Deletes one snapshot (and its hydration ticket), may revoke one repository connection, writes one audit
   *   event, all in one transaction.
   */
  async execute(
    command: RemoveAssessmentRepositoryCommand,
  ): Promise<RemoveAssessmentRepositoryDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Assessment" WHERE "id" = ${command.assessmentId} FOR UPDATE`,
      );
      const assessment = await tx.assessment.findUnique({
        where: { id: command.assessmentId },
        select: { id: true, ownerId: true, lifecycleState: true },
      });
      if (!assessment || assessment.ownerId !== command.actorId) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      if (
        !assessment.lifecycleState ||
        !REMOVABLE_LIFECYCLE_STATES.includes(assessment.lifecycleState)
      ) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const pinned = await tx.assessmentCaseRepository.count({
        where: { assessmentId: assessment.id },
      });
      if (pinned > 0) {
        throw problemException(
          REPOSITORY_SET_ERROR_CODES.immutable,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const snapshot = await tx.repositorySnapshot.findFirst({
        where: {
          id: command.snapshotId,
          assessmentId: assessment.id,
          connection: { userId: command.actorId },
        },
        select: { id: true, connectionId: true, repositoryFullName: true },
      });
      if (!snapshot) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      await tx.repositorySnapshot.delete({ where: { id: snapshot.id } });
      const remaining = await tx.repositorySnapshot.count({
        where: { connectionId: snapshot.connectionId },
      });
      const connectionRevoked = remaining === 0;
      if (connectionRevoked) {
        await tx.repositoryConnection.update({
          where: { id: snapshot.connectionId },
          data: { status: RepositoryConnectionStatus.REVOKED },
        });
      }
      await this.auditWriter.writeInTx(
        {
          eventType: ASSESSMENT_EVENT_TYPES.repositoryRemoved,
          actorId: command.actorId,
          assessmentId: assessment.id,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: assessment.id,
          correlationId: command.correlationId,
          causationId: command.correlationId,
          decision: AUDIT_DECISIONS.allow,
          result: ASSESSMENT_EVENT_TYPES.repositoryRemoved,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          payload: {
            assessmentId: assessment.id,
            snapshotId: snapshot.id,
            connectionId: snapshot.connectionId,
            repositoryFullName: snapshot.repositoryFullName,
            connectionRevoked,
          },
        },
        tx,
      );
      return removeAssessmentRepositoryResultSchema.parse({
        assessment_id: assessment.id,
        snapshot_id: snapshot.id,
        connection_id: snapshot.connectionId,
        connection_revoked: connectionRevoked,
      });
    });
  }
}
