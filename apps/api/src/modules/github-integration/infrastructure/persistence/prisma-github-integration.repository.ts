import { Injectable } from "@nestjs/common";

import {
  fromPrismaRepositoryConnectionStatus,
  toPrismaRepositoryConnectionStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { RepositoryConnectionRepository } from "../../application/ports/persistence/repository-connection.repository.js";
import { RepositoryConnection } from "../../domain/entities/repository-connection.entity.js";

@Injectable()
export class PrismaRepositoryConnectionRepository implements RepositoryConnectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(connection: RepositoryConnection): Promise<void> {
    await this.prisma.repositoryConnection.upsert({
      where: {
        installationId_repositoryId: {
          installationId: connection.installationId,
          repositoryId: connection.repositoryId,
        },
      },
      create: {
        id: connection.id,
        assessmentId: connection.assessmentId,
        organizationId: connection.organizationId,
        userId: connection.userId,
        installationId: connection.installationId,
        repositoryId: connection.repositoryId,
        repositoryName: connection.repositoryName,
        repositoryFullName: connection.repositoryFullName,
        defaultBranch: connection.defaultBranch,
        permissions: connection.permissions,
        status: toPrismaRepositoryConnectionStatus(connection.status),
        connectedAt: connection.connectedAt,
        revokedAt: connection.revokedAt,
      },
      update: {
        assessmentId: connection.assessmentId,
        organizationId: connection.organizationId,
        userId: connection.userId,
        repositoryName: connection.repositoryName,
        repositoryFullName: connection.repositoryFullName,
        defaultBranch: connection.defaultBranch,
        permissions: connection.permissions,
        status: toPrismaRepositoryConnectionStatus(connection.status),
        revokedAt: connection.revokedAt,
      },
    });
  }

  async findById(id: string): Promise<RepositoryConnection | null> {
    const row = await this.prisma.repositoryConnection.findUnique({
      where: { id },
    });
    if (!row) return null;

    return RepositoryConnection.rehydrate({
      id: row.id,
      assessmentId: row.assessmentId,
      organizationId: row.organizationId,
      userId: row.userId,
      installationId: row.installationId,
      repositoryId: row.repositoryId,
      repositoryName: row.repositoryName,
      repositoryFullName: row.repositoryFullName,
      defaultBranch: row.defaultBranch,
      permissions: row.permissions as Record<string, string>,
      status: fromPrismaRepositoryConnectionStatus(row.status),
      connectedAt: row.connectedAt,
      revokedAt: row.revokedAt,
    });
  }

  async linkToAssessment(id: string, assessmentId: string): Promise<boolean> {
    const result = await this.prisma.repositoryConnection.updateMany({
      where: {
        id,
        OR: [{ assessmentId: null }, { assessmentId }],
      },
      data: { assessmentId },
    });

    return result.count === 1;
  }
}
