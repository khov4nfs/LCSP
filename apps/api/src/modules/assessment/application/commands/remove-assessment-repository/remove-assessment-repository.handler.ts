import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { RemoveAssessmentRepositoryCommand } from "./remove-assessment-repository.command.js";

@CommandHandler(RemoveAssessmentRepositoryCommand)
export class RemoveAssessmentRepositoryHandler implements ICommandHandler<RemoveAssessmentRepositoryCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: RemoveAssessmentRepositoryCommand,
  ): Promise<{ removed: boolean }> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: command.assessmentId, ownerId: command.actorId },
      select: { status: true },
    });
    if (!assessment)
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    if (assessment.status !== ASSESSMENT_STATUS_CODES.wizardInProgress)
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    const connection = await this.prisma.repositoryConnection.findFirst({
      where: {
        id: command.connectionId,
        assessmentId: command.assessmentId,
        userId: command.actorId,
      },
      select: { id: true },
    });
    if (!connection)
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );

    // A remove action only detaches this Assessment's setup. The underlying
    // provider connection and account credential remain available to the user.
    await this.prisma.$transaction(async (tx) => {
      await tx.repositorySnapshot.deleteMany({
        where: {
          assessmentId: command.assessmentId,
          connectionId: connection.id,
        },
      });
      await tx.repositoryConnection.updateMany({
        where: {
          id: connection.id,
          assessmentId: command.assessmentId,
          userId: command.actorId,
        },
        data: { assessmentId: null },
      });
      await tx.assessment.updateMany({
        where: {
          id: command.assessmentId,
          ownerId: command.actorId,
          status: ASSESSMENT_STATUS_CODES.wizardInProgress,
        },
        data: { repositorySetupVersion: { increment: 1 } },
      });
    });
    return { removed: true };
  }
}
