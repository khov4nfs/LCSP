import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
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

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import {
  CompleteRepositorySetupCommand,
  type CompleteRepositorySetupDto,
} from "./complete-repository-setup.command.js";

@CommandHandler(CompleteRepositorySetupCommand)
export class CompleteRepositorySetupHandler implements ICommandHandler<CompleteRepositorySetupCommand> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    command: CompleteRepositorySetupCommand,
  ): Promise<CompleteRepositorySetupDto> {
    const assessment = await this.assessments.findById(command.assessmentId);
    if (!assessment || assessment.ownerId !== command.actorId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    if (
      assessment.status !== ASSESSMENT_STATUS_CODES.wizardInProgress &&
      assessment.status !== ASSESSMENT_STATUS_CODES.wizardSubmitted
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const connection = await this.prisma.repositoryConnection.findFirst({
      where: {
        assessmentId: command.assessmentId,
        userId: command.actorId,
        status: REPOSITORY_CONNECTION_STATUSES.active,
      },
      orderBy: { connectedAt: "desc" },
      select: { id: true },
    });
    const snapshot = connection
      ? await this.prisma.repositorySnapshot.findFirst({
          where: {
            assessmentId: command.assessmentId,
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
      assessment.status === ASSESSMENT_STATUS_CODES.wizardSubmitted;
    assessment.completeRepositorySetup();

    if (!wasCompleted) {
      await this.prisma.$transaction(async (tx) => {
        await this.assessments.saveInTx(assessment, tx);
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
      });
    }

    return {
      assessment_id: assessment.id,
      status: assessment.status,
      repository_connection_id: connection.id,
      snapshot_id: snapshot.id,
      commit_sha: snapshot.commitSha,
    };
  }
}
