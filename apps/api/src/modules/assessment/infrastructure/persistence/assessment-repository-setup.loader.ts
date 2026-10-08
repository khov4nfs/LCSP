import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { assessmentRepositorySetupSchema } from "@lcsp/contracts/assessment-domain";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { projectCanonicalAssessment } from "../../../../platform/runtime-events/canonical-assessment-projection.js";

@Injectable()
export class AssessmentRepositorySetupLoader {
  constructor(private readonly prisma: PrismaService) {}
  async load(input: {
    assessmentId: string;
    sessionUserId: string;
    subjectRole: AuthUserRole;
    correlationId: string;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const assessment = await tx.assessment.findUnique({
          where: { id: input.assessmentId },
          include: { runtime: true, domainCase: true },
        });
        if (
          !assessment ||
          input.subjectRole !== AUTH_USER_ROLES.customer ||
          assessment.ownerId !== input.sessionUserId
        ) {
          throw problemException(
            ASSESSMENT_ERROR_CODES.notFound,
            input.correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }
        const pinnedSnapshotId = assessment.domainCase?.repositorySnapshotId;
        const snapshot = pinnedSnapshotId
          ? await tx.repositorySnapshot.findFirst({
              where: {
                id: pinnedSnapshotId,
                assessmentId: assessment.id,
                status: REPOSITORY_SNAPSHOT_STATUSES.ready,
              },
            })
          : await tx.repositorySnapshot.findFirst({
              where: {
                assessmentId: assessment.id,
                status: REPOSITORY_SNAPSHOT_STATUSES.ready,
                connection: {
                  userId: input.sessionUserId,
                  status: REPOSITORY_CONNECTION_STATUSES.active,
                },
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            });
        const connection = await tx.repositoryConnection.findFirst({
          where: {
            ...(snapshot ? { id: snapshot.connectionId } : {}),
            assessmentId: assessment.id,
            userId: input.sessionUserId,
            status: REPOSITORY_CONNECTION_STATUSES.active,
          },
          orderBy: { connectedAt: "desc" },
        });
        const scanJob = snapshot
          ? await tx.repositoryScanJob.findFirst({
              where: {
                assessmentId: assessment.id,
                snapshotId: snapshot.id,
                ...(assessment.domainCase?.repositoryScanJobId
                  ? { id: assessment.domainCase.repositoryScanJobId }
                  : {}),
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            })
          : null;
        return assessmentRepositorySetupSchema.parse({
          assessmentId: assessment.id,
          lifecycle: projectCanonicalAssessment(
            assessment.id,
            assessment,
            input.correlationId,
          ).lifecycle,
          connection: connection
            ? {
                connectionId: connection.id,
                provider: connection.provider,
                repositoryId: connection.repositoryId,
                repositoryFullName: connection.repositoryFullName,
                defaultBranch: connection.defaultBranch,
                status: connection.status,
              }
            : null,
          snapshot:
            snapshot && connection
              ? {
                  id: snapshot.id,
                  assessmentId: assessment.id,
                  connectionId: connection.id,
                  provider: connection.provider,
                  repositoryFullName: snapshot.repositoryFullName,
                  branch: snapshot.branch,
                  commitSha: snapshot.commitSha,
                  createdAt: snapshot.createdAt.toISOString(),
                }
              : null,
          scanJob: scanJob
            ? {
                id: scanJob.id,
                assessmentId: assessment.id,
                snapshotId: scanJob.snapshotId,
                status: scanJob.status,
                attemptCount: scanJob.attemptCount,
                blockedReason: scanJob.blockedReason,
                updatedAt: scanJob.updatedAt.toISOString(),
              }
            : null,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
