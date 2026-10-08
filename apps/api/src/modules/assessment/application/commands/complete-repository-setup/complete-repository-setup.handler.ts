import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { Prisma } from "@prisma/client";
import { completeAssessmentRepositorySetupResultSchema } from "@lcsp/contracts/assessment-domain";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentRuntimePreparation } from "../../services/assessment-runtime-preparation.service.js";
import {
  CompleteRepositorySetupCommand,
  type CompleteRepositorySetupDto,
} from "./complete-repository-setup.command.js";

@CommandHandler(CompleteRepositorySetupCommand)
export class CompleteRepositorySetupHandler implements ICommandHandler<CompleteRepositorySetupCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly runtimePreparation: AssessmentRuntimePreparation,
  ) {}

  async execute(
    command: CompleteRepositorySetupCommand,
  ): Promise<CompleteRepositorySetupDto> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Assessment" WHERE "id" = ${command.assessmentId} FOR UPDATE`,
      );
      const assessment = await tx.assessment.findUnique({
        where: { id: command.assessmentId },
        include: { domainCase: true },
      });
      if (!assessment || assessment.ownerId !== command.actorId) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      if (
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.PREPARING &&
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
      ) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const connection = await tx.repositoryConnection.findFirst({
        where: {
          assessmentId: command.assessmentId,
          userId: command.actorId,
          status: REPOSITORY_CONNECTION_STATUSES.active,
        },
        orderBy: { connectedAt: "desc" },
        select: { id: true },
      });
      const snapshot = connection
        ? await tx.repositorySnapshot.findFirst({
            where: {
              assessmentId: command.assessmentId,
              ...(assessment.domainCase?.repositorySnapshotId
                ? { id: assessment.domainCase.repositorySnapshotId }
                : {}),
              connectionId: connection.id,
              status: REPOSITORY_SNAPSHOT_STATUSES.ready,
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, commitSha: true },
          })
        : null;

      if (
        !connection ||
        !snapshot ||
        !/^[0-9a-f]{40}$/iu.test(snapshot.commitSha)
      ) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupIncomplete,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const wasCompleted =
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE;
      if (!wasCompleted) {
        await this.auditWriter.writeInTx(
          {
            eventType: ASSESSMENT_EVENT_TYPES.repositorySetupCompleted,
            actorId: command.actorId,
            assessmentId: assessment.id,
            resourceType: AUDIT_RESOURCE_TYPES.assessment,
            resourceId: assessment.id,
            correlationId: command.correlationId,
            causationId: command.correlationId,
            decision: AUDIT_DECISIONS.allow,
            result: ASSESSMENT_EVENT_TYPES.repositorySetupCompleted,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            payload: {
              assessmentId: assessment.id,
              repositoryConnectionId: connection.id,
              snapshotId: snapshot.id,
              commitSha: snapshot.commitSha,
            },
          },
          tx,
        );
      }

      // V2 assessments (canonical lifecycle) pin the repository snapshot and enter ACTIVE here;
      // the call is idempotent so a retried completion also covers a late legal portfolio.
      if (!wasCompleted) {
        await this.runtimePreparation.prepareInTx(tx, {
          assessmentId: assessment.id,
          snapshotId: snapshot.id,
          correlationId: command.correlationId,
        });
      }

      return completeAssessmentRepositorySetupResultSchema.parse({
        assessment_id: assessment.id,
        repository_connection_id: connection.id,
        snapshot_id: snapshot.id,
        commit_sha: snapshot.commitSha,
      });
    });
  }
}
