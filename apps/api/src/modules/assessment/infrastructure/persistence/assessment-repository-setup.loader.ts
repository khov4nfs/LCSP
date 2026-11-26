import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AUTH_USER_ROLES, type AuthUserRole } from "@lcsp/contracts/auth";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { assessmentRepositorySetupSchema } from "@lcsp/contracts/assessment-domain";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { buildCanonicalRepositoryUrl } from "@lcsp/contracts/github-integration";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { projectCanonicalAssessment } from "../../../../platform/runtime-events/canonical-assessment-projection.js";
import { currentRepositoryLimit } from "../../application/services/repository-set-limit.js";

@Injectable()
export class AssessmentRepositorySetupLoader {
  constructor(private readonly prisma: PrismaService) {}
  /**
   * Business purpose: Show the customer every repository chosen for their assessment with its immutable source scope
   * and scan state, so a multi-repository setup can be reviewed, resumed and corrected before it is pinned.
   *
   * Business rules:
   * - Only the assessment's customer owner may read setup metadata.
   * - Once the repository set is pinned, the pinned repositories (in pin order, with their keys) are the setup;
   *   before that, each active connection of the assessment contributes its latest ready snapshot per source scope.
   * - Source scope is projected from the snapshot without trimming or widening its directory.
   * - The legacy single-repository fields describe the primary (first) repository.
   * - The repository limit shown to the customer is the one the API will enforce.
   *
   * Execution flow:
   * 1. Authorize the customer and read the pinned set or the candidate snapshots.
   * 2. Read each repository's owned connection and matching scan job.
   * 3. Validate and return setup metadata including every snapshot source prefix.
   *
   * Failure cases:
   * - A missing or foreign assessment returns not-found; malformed persisted setup data fails response validation.
   *
   * Side effects:
   * - Read-only repeatable-read transaction; no snapshots, source scopes or history are changed.
   */
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
        const pins = await tx.assessmentCaseRepository.findMany({
          where: { assessmentId: assessment.id },
          orderBy: { ordinal: "asc" },
        });
        const pinKeyBySnapshot = new Map(
          pins.map((pin) => [pin.repositorySnapshotId, pin.repositoryKey]),
        );
        const pinnedSnapshotId = assessment.domainCase?.repositorySnapshotId;
        const snapshots =
          pins.length > 0
            ? await this.pinnedSnapshots(tx, assessment.id, pins)
            : pinnedSnapshotId
              ? await tx.repositorySnapshot.findMany({
                  where: {
                    id: pinnedSnapshotId,
                    assessmentId: assessment.id,
                    status: REPOSITORY_SNAPSHOT_STATUSES.ready,
                  },
                })
              : await this.candidateSnapshots(
                  tx,
                  assessment.id,
                  input.sessionUserId,
                );
        const connections = await tx.repositoryConnection.findMany({
          where: {
            assessmentId: assessment.id,
            userId: input.sessionUserId,
            status: REPOSITORY_CONNECTION_STATUSES.active,
          },
          orderBy: [{ connectedAt: "asc" }, { id: "asc" }],
        });
        const connectionById = new Map(
          connections.map((connection) => [connection.id, connection]),
        );
        const scanJobs = snapshots.length
          ? await tx.repositoryScanJob.findMany({
              where: {
                assessmentId: assessment.id,
                snapshotId: { in: snapshots.map((snapshot) => snapshot.id) },
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            })
          : [];
        const pinnedScanJobIds = new Set(pins.map((pin) => pin.repositoryScanJobId));
        const scanJobFor = (snapshotId: string) => {
          const forSnapshot = scanJobs.filter((job) => job.snapshotId === snapshotId);
          return (
            forSnapshot.find((job) => pinnedScanJobIds.has(job.id)) ??
            (assessment.domainCase?.repositoryScanJobId
              ? forSnapshot.find(
                  (job) => job.id === assessment.domainCase?.repositoryScanJobId,
                )
              : undefined) ??
            forSnapshot[0] ??
            null
          );
        };
        const entries = snapshots.flatMap((snapshot) => {
          const connection = connectionById.get(snapshot.connectionId);
          if (!connection) return [];
          const scanJob = scanJobFor(snapshot.id);
          return [
            {
              repositoryKey: pinKeyBySnapshot.get(snapshot.id) ?? null,
              connection: {
                connectionId: connection.id,
                provider: connection.provider,
                repositoryId: connection.repositoryId,
                repositoryFullName: connection.repositoryFullName,
                canonicalRepositoryUrl: buildCanonicalRepositoryUrl(
                  connection.provider,
                  connection.repositoryFullName,
                ),
                defaultBranch: connection.defaultBranch,
                status: connection.status,
              },
              snapshot: {
                id: snapshot.id,
                assessmentId: assessment.id,
                connectionId: connection.id,
                provider: connection.provider,
                repositoryFullName: snapshot.repositoryFullName,
                branch: snapshot.branch,
                commitSha: snapshot.commitSha,
                sourcePathPrefix: snapshot.sourcePathPrefix,
                createdAt: snapshot.createdAt.toISOString(),
              },
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
            },
          ];
        });
        // A connection that has not produced a snapshot yet is still a chosen repository.
        const connectionsWithoutSnapshot =
          pins.length > 0
            ? []
            : connections.filter(
                (connection) =>
                  !snapshots.some(
                    (snapshot) => snapshot.connectionId === connection.id,
                  ),
              );
        const repositories = [
          ...entries,
          ...connectionsWithoutSnapshot.map((connection) => ({
            repositoryKey: null,
            connection: {
              connectionId: connection.id,
              provider: connection.provider,
              repositoryId: connection.repositoryId,
              repositoryFullName: connection.repositoryFullName,
              canonicalRepositoryUrl: buildCanonicalRepositoryUrl(
                connection.provider,
                connection.repositoryFullName,
              ),
              defaultBranch: connection.defaultBranch,
              status: connection.status,
            },
            snapshot: null,
            scanJob: null,
          })),
        ];
        const primary = repositories[0] ?? null;
        return assessmentRepositorySetupSchema.parse({
          assessmentId: assessment.id,
          lifecycle: projectCanonicalAssessment(
            assessment.id,
            assessment,
            input.correlationId,
          ).lifecycle,
          connection: primary?.connection ?? null,
          snapshot: primary?.snapshot ?? null,
          scanJob: primary?.scanJob ?? null,
          repositories,
          repositorySetDigest: assessment.domainCase?.repositorySetDigest ?? null,
          repositoryLimit: currentRepositoryLimit(),
          setupCompleted: pins.length > 0,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  /** The snapshots of a pinned set, in pin order. */
  private async pinnedSnapshots(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    pins: Array<{ repositorySnapshotId: string }>,
  ) {
    const rows = await tx.repositorySnapshot.findMany({
      where: {
        id: { in: pins.map((pin) => pin.repositorySnapshotId) },
        assessmentId,
        status: REPOSITORY_SNAPSHOT_STATUSES.ready,
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return pins.flatMap((pin) => {
      const row = byId.get(pin.repositorySnapshotId);
      return row ? [row] : [];
    });
  }

  /**
   * Business purpose: Pick the snapshots that are still candidates for the repository set of an unpinned assessment.
   * Business rules:
   * - Only ready snapshots on active connections owned by the customer qualify.
   * - Per connection and source scope only the newest snapshot is a candidate, so a retried pin replaces the earlier one.
   * Execution flow:
   * 1. Read ready snapshots newest first. 2. Keep the first of each connection and source scope. 3. Order by creation.
   * Failure cases:
   * - None; no candidates yields an empty list.
   * Side effects:
   * - Read-only.
   */
  private async candidateSnapshots(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    ownerId: string,
  ) {
    const rows = await tx.repositorySnapshot.findMany({
      where: {
        assessmentId,
        status: REPOSITORY_SNAPSHOT_STATUSES.ready,
        connection: {
          userId: ownerId,
          status: REPOSITORY_CONNECTION_STATUSES.active,
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const seen = new Set<string>();
    const latest = rows.filter((row) => {
      const key = `${row.connectionId}|${row.sourcePathPrefix ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return latest.reverse();
  }
}
