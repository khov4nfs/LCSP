import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_REPOSITORY_RELATION_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  ManageRepositoryRelationCommand,
  REPOSITORY_RELATION_MUTATIONS,
} from "./manage-repository-relation.command.js";

@CommandHandler(ManageRepositoryRelationCommand)
export class ManageRepositoryRelationHandler implements ICommandHandler<ManageRepositoryRelationCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    command: ManageRepositoryRelationCommand,
  ): Promise<{ id: string | null }> {
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
    if (assessment.status !== ASSESSMENT_STATUS_CODES.wizardInProgress) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    if (command.mutation === REPOSITORY_RELATION_MUTATIONS.remove) {
      const removed = await this.prisma.assessmentRepositoryRelation.deleteMany(
        {
          where: {
            id: command.relationId ?? "",
            assessmentId: command.assessmentId,
          },
        },
      );
      if (removed.count !== 1)
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      return { id: null };
    }
    if (
      !command.fromSnapshotId ||
      !command.toSnapshotId ||
      command.fromSnapshotId === command.toSnapshotId ||
      !command.type ||
      !Object.values(ASSESSMENT_REPOSITORY_RELATION_TYPES).includes(
        command.type,
      )
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupIncomplete,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    }
    const snapshots = await this.prisma.repositorySnapshot.count({
      where: {
        assessmentId: command.assessmentId,
        id: { in: [command.fromSnapshotId, command.toSnapshotId] },
      },
    });
    if (snapshots !== 2)
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupIncomplete,
        command.correlationId,
        { status: HttpStatus.BAD_REQUEST },
      );
    if (command.mutation === REPOSITORY_RELATION_MUTATIONS.create) {
      const created = await this.prisma.assessmentRepositoryRelation.upsert({
        where: {
          fromSnapshotId_toSnapshotId_type: {
            fromSnapshotId: command.fromSnapshotId,
            toSnapshotId: command.toSnapshotId,
            type: command.type,
          },
        },
        create: {
          assessmentId: command.assessmentId,
          fromSnapshotId: command.fromSnapshotId,
          toSnapshotId: command.toSnapshotId,
          type: command.type,
        },
        update: {},
        select: { id: true },
      });
      return created;
    }
    const updated = await this.prisma.assessmentRepositoryRelation.updateMany({
      where: {
        id: command.relationId ?? "",
        assessmentId: command.assessmentId,
      },
      data: {
        fromSnapshotId: command.fromSnapshotId,
        toSnapshotId: command.toSnapshotId,
        type: command.type,
      },
    });
    if (updated.count !== 1)
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    return { id: command.relationId };
  }
}
