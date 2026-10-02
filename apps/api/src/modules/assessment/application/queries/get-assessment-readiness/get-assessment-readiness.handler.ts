import { HttpStatus, Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  type AssessmentRepositoryRelationType,
  ASSESSMENT_STATUS_CODES,
  ASSESSMENT_MISSING_EVIDENCE_CODES,
  ASSESSMENT_NEXT_ACTION_KEYS,
  ASSESSMENT_GRAPH_STATES,
  ASSESSMENT_SETUP_CONFIRMATION_STATUSES,
  READINESS_MODES,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  toPrismaEvidenceAcceptanceStatus,
  fromPrismaRepositoryScanJobStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import type { AssessmentReadinessStatusDto } from "../../contracts/assessment/readiness-status.contract.js";
import { GetAssessmentReadinessQuery } from "./get-assessment-readiness.query.js";

@QueryHandler(GetAssessmentReadinessQuery)
export class GetAssessmentReadinessHandler implements IQueryHandler<GetAssessmentReadinessQuery> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(
    query: GetAssessmentReadinessQuery,
  ): Promise<AssessmentReadinessStatusDto> {
    const assessment = await this.assessments.findById(query.assessmentId);
    if (
      !assessment ||
      query.subjectRole !== AUTH_USER_ROLES.customer ||
      assessment.ownerId !== query.sessionUserId
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const [connections, acceptedEvidence, relations] = await Promise.all([
      typeof this.prisma.repositoryConnection.findMany === "function"
        ? this.prisma.repositoryConnection.findMany({
            where: {
              assessmentId: assessment.id,
              userId: query.sessionUserId,
              status: REPOSITORY_CONNECTION_STATUSES.active,
            },
            orderBy: [{ connectedAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              provider: true,
              repositoryId: true,
              repositoryFullName: true,
              defaultBranch: true,
              status: true,
            },
          })
        : this.prisma.repositoryConnection
            .findFirst({
              where: {
                assessmentId: assessment.id,
                userId: query.sessionUserId,
                status: REPOSITORY_CONNECTION_STATUSES.active,
              },
              orderBy: [{ connectedAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                provider: true,
                repositoryId: true,
                repositoryFullName: true,
                defaultBranch: true,
                status: true,
              },
            })
            .then((connection) => (connection ? [connection] : [])),
      typeof this.prisma.technicalEvidenceReport.findMany === "function"
        ? this.prisma.technicalEvidenceReport.findMany({
            where: {
              assessmentId: assessment.id,
              status: toPrismaEvidenceAcceptanceStatus(
                TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
              ),
            },
            select: { id: true, snapshotId: true },
          })
        : this.prisma.technicalEvidenceReport
            .findFirst({
              where: {
                assessmentId: assessment.id,
                status: toPrismaEvidenceAcceptanceStatus(
                  TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
                ),
              },
              select: { id: true, snapshotId: true },
            })
            .then((report) => (report ? [report] : [])),
      typeof this.prisma.assessmentRepositoryRelation?.findMany === "function"
        ? this.prisma.assessmentRepositoryRelation.findMany({
            where: { assessmentId: assessment.id },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              fromSnapshotId: true,
              toSnapshotId: true,
              type: true,
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: string;
              fromSnapshotId: string;
              toSnapshotId: string;
              type: string;
            }>,
          ),
    ]);

    // Read only: opening an Assessment must not pin a source or enqueue a scan.
    // A checkpoint is always scoped to the current active connection.
    const snapshots =
      connections.length === 0
        ? []
        : typeof this.prisma.repositorySnapshot.findMany === "function"
          ? await this.prisma.repositorySnapshot.findMany({
              where: {
                assessmentId: assessment.id,
                connectionId: { in: connections.map((item) => item.id) },
                status: REPOSITORY_SNAPSHOT_STATUSES.ready,
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            })
          : (
              await Promise.all(
                connections.map((connection) =>
                  this.prisma.repositorySnapshot.findFirst({
                    where: {
                      assessmentId: assessment.id,
                      connectionId: connection.id,
                      status: REPOSITORY_SNAPSHOT_STATUSES.ready,
                    },
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                  }),
                ),
              )
            ).filter((snapshot): snapshot is NonNullable<typeof snapshot> =>
              Boolean(snapshot),
            );
    const latestSnapshotByConnection = new Map<
      string,
      (typeof snapshots)[number]
    >();
    for (const snapshot of snapshots) {
      if (!latestSnapshotByConnection.has(snapshot.connectionId))
        latestSnapshotByConnection.set(snapshot.connectionId, snapshot);
    }
    const snapshotIds = [...latestSnapshotByConnection.values()].map(
      (item) => item.id,
    );
    const jobs =
      snapshotIds.length === 0
        ? []
        : typeof this.prisma.repositoryScanJob.findMany === "function"
          ? await this.prisma.repositoryScanJob.findMany({
              where: {
                assessmentId: assessment.id,
                snapshotId: { in: snapshotIds },
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            })
          : (
              await Promise.all(
                snapshotIds.map((snapshotId) =>
                  this.prisma.repositoryScanJob.findFirst({
                    where: { assessmentId: assessment.id, snapshotId },
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                  }),
                ),
              )
            ).filter((job): job is NonNullable<typeof job> => Boolean(job));
    const latestJobBySnapshot = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs) {
      if (!latestJobBySnapshot.has(job.snapshotId))
        latestJobBySnapshot.set(job.snapshotId, job);
    }
    const repositories = connections.map((connection) => {
      const snapshot = latestSnapshotByConnection.get(connection.id) ?? null;
      const scanJob = snapshot
        ? (latestJobBySnapshot.get(snapshot.id) ?? null)
        : null;
      return {
        connectionId: connection.id,
        provider: String(connection.provider),
        repositoryId: connection.repositoryId,
        repositoryFullName: connection.repositoryFullName,
        defaultBranch: connection.defaultBranch,
        status: String(connection.status),
        snapshot: snapshot
          ? {
              id: snapshot.id,
              branch: snapshot.branch,
              commitSha: snapshot.commitSha,
              createdAt: snapshot.createdAt.toISOString(),
            }
          : null,
        scanJob: scanJob
          ? {
              id: scanJob.id,
              status: fromPrismaRepositoryScanJobStatus(scanJob.status),
              attemptCount: scanJob.attemptCount,
              blockedReason: scanJob.blockedReason,
              updatedAt: scanJob.updatedAt.toISOString(),
            }
          : null,
      };
    });
    const connection = connections.at(-1) ?? null;
    const snapshot = connection
      ? (latestSnapshotByConnection.get(connection.id) ?? null)
      : null;
    const scanJob = snapshot
      ? (latestJobBySnapshot.get(snapshot.id) ?? null)
      : null;
    const setupCompleted = Boolean(
      connection &&
      snapshot &&
      assessment.status !== ASSESSMENT_STATUS_CODES.wizardInProgress,
    );
    const scanProgress = repositories.reduce(
      (progress, repository) => {
        progress.total += 1;
        const status = repository.scanJob?.status;
        if (status === REPOSITORY_SCAN_JOB_STATUSES.completed) {
          progress.completed += 1;
        } else if (
          status === REPOSITORY_SCAN_JOB_STATUSES.failed ||
          status === REPOSITORY_SCAN_JOB_STATUSES.blocked ||
          status === REPOSITORY_SCAN_JOB_STATUSES.blockedMapping
        ) {
          progress.failed += 1;
        } else {
          progress.pending += 1;
        }
        return progress;
      },
      { total: 0, completed: 0, failed: 0, pending: 0 },
    );
    const providerCapabilities = [
      ...new Set(connections.map((item) => String(item.provider))),
    ].map((provider) => ({
      provider,
      canConnect: true,
      canPinSnapshot: true,
    }));
    const acceptedSnapshotIds = new Set(
      acceptedEvidence.map((report) => report.snapshotId),
    );

    return {
      repository_setup: {
        assessmentId: assessment.id,
        assessmentStatus: assessment.status,
        connection: connection
          ? {
              connectionId: connection.id,
              provider: String(connection.provider),
              repositoryId: connection.repositoryId,
              repositoryFullName: connection.repositoryFullName,
              defaultBranch: connection.defaultBranch,
              status: String(connection.status),
            }
          : null,
        snapshot:
          snapshot && connection
            ? {
                id: snapshot.id,
                assessmentId: snapshot.assessmentId,
                connectionId: snapshot.connectionId,
                provider: String(connection.provider),
                repositoryFullName: snapshot.repositoryFullName,
                branch: snapshot.branch,
                commitSha: snapshot.commitSha,
                createdAt: snapshot.createdAt.toISOString(),
              }
            : null,
        scanJob: scanJob
          ? {
              id: scanJob.id,
              assessmentId: scanJob.assessmentId,
              snapshotId: scanJob.snapshotId,
              status: fromPrismaRepositoryScanJobStatus(scanJob.status),
              attemptCount: scanJob.attemptCount,
              blockedReason: scanJob.blockedReason,
              updatedAt: scanJob.updatedAt.toISOString(),
            }
          : null,
        repositories,
        relations: relations.map((relation) => ({
          id: relation.id,
          fromSnapshotId: relation.fromSnapshotId,
          toSnapshotId: relation.toSnapshotId,
          type: String(relation.type) as AssessmentRepositoryRelationType,
        })),
        confirmed:
          assessment.status !== ASSESSMENT_STATUS_CODES.wizardInProgress,
        providerCapabilities,
        confirmation: {
          status:
            assessment.status === ASSESSMENT_STATUS_CODES.wizardInProgress
              ? ASSESSMENT_SETUP_CONFIRMATION_STATUSES.draft
              : ASSESSMENT_SETUP_CONFIRMATION_STATUSES.confirmed,
          confirmedAt:
            assessment.status === ASSESSMENT_STATUS_CODES.wizardInProgress
              ? null
              : assessment.updatedAt.toISOString(),
        },
        scanProgress,
        relationAggregate: {
          count: relations.length,
          independent: relations.length === 0,
        },
        programEvidenceGraph: {
          state:
            snapshotIds.length > 0 &&
            snapshotIds.every((snapshotId) =>
              acceptedSnapshotIds.has(snapshotId),
            ) &&
            repositories.length > 0 &&
            repositories.every(
              (repository) =>
                repository.scanJob?.status ===
                REPOSITORY_SCAN_JOB_STATUSES.completed,
            )
              ? ASSESSMENT_GRAPH_STATES.ready
              : ASSESSMENT_GRAPH_STATES.notReady,
          reportCount: acceptedSnapshotIds.size,
        },
      },
      classification_locked: acceptedEvidence.length === 0,
      missing_evidence:
        acceptedEvidence.length === 0
          ? [
              {
                type: ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
                label:
                  ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
                description:
                  ASSESSMENT_MISSING_EVIDENCE_CODES.technicalEvidenceReport,
              },
            ]
          : [],
      unresolved_unknown_items: [],
      readiness_mode: READINESS_MODES.selfDeclared,
      completed_steps: setupCompleted ? ["repository_setup"] : [],
      next_action: ASSESSMENT_NEXT_ACTION_KEYS.workflowRun,
      updated_at: assessment.updatedAt.toISOString(),
      repository_connection: connection
        ? {
            connection_id: connection.id,
            provider: String(connection.provider),
            repository_id: connection.repositoryId,
            repository_full_name: connection.repositoryFullName,
            default_branch: connection.defaultBranch,
            status: String(connection.status),
          }
        : null,
    };
  }
}
