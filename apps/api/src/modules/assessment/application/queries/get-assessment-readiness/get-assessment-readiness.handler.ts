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
  ASSESSMENT_REPOSITORY_PROVIDERS,
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
    const persistedSetup =
      typeof this.prisma.assessment?.findUnique === "function"
        ? await this.prisma.assessment.findUnique({
            where: { id: assessment.id },
            select: {
              repositorySetupVersion: true,
              repositorySetupManifest: true,
              repositorySetupConfirmedAt: true,
            },
          })
        : null;
    const confirmedManifestSnapshotIds = manifestSnapshotIds(
      persistedSetup?.repositorySetupManifest,
    );

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
    // This is a runtime capability projection, not a list inferred from the
    // repositories already connected to the assessment. The provider registry
    // currently wires GitHub and GitLab adapters; the other prototype choices
    // remain visible but unavailable until an adapter is registered.
    const providerCapabilities = Object.values(
      ASSESSMENT_REPOSITORY_PROVIDERS,
    ).map((provider) => ({
      provider,
      canConnect:
        provider === ASSESSMENT_REPOSITORY_PROVIDERS.github ||
        provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
      canPinSnapshot:
        provider === ASSESSMENT_REPOSITORY_PROVIDERS.github ||
        provider === ASSESSMENT_REPOSITORY_PROVIDERS.gitlab,
    }));
    const acceptedSnapshotIds = new Set(
      acceptedEvidence.map((report) => report.snapshotId),
    );
    // Older assessments may predate the manifest column. Preserve their
    // compatibility projection, but fail closed once a manifest exists and
    // no longer describes the current pinned snapshot set.
    const confirmedScopeMatchesCurrentSnapshots =
      confirmedManifestSnapshotIds.length === 0 ||
      sameSnapshotSet(confirmedManifestSnapshotIds, snapshotIds);
    const scopedSnapshotIds =
      confirmedScopeMatchesCurrentSnapshots
        ? confirmedManifestSnapshotIds
        : snapshotIds;
    const setupConfirmed =
      assessment.status !== ASSESSMENT_STATUS_CODES.wizardInProgress &&
      confirmedScopeMatchesCurrentSnapshots;
    const setupCompleted = Boolean(connection && snapshot && setupConfirmed);

    return {
      repository_setup: {
        assessmentId: assessment.id,
        setupVersion:
          persistedSetup?.repositorySetupVersion ??
          assessment.repositorySetupVersion,
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
        confirmed: setupConfirmed,
        providerCapabilities,
        confirmation: {
          status: setupConfirmed
            ? ASSESSMENT_SETUP_CONFIRMATION_STATUSES.confirmed
            : ASSESSMENT_SETUP_CONFIRMATION_STATUSES.draft,
          confirmedAt: setupConfirmed
            ? (
                persistedSetup?.repositorySetupConfirmedAt ??
                assessment.updatedAt
              ).toISOString()
            : null,
        },
        scanProgress,
        relationAggregate: {
          count: relations.length,
          independent: relations.length === 0,
        },
        programEvidenceGraph: {
          state:
            scopedSnapshotIds.length > 0 &&
            scopedSnapshotIds.every((snapshotId) =>
              acceptedSnapshotIds.has(snapshotId),
            ) &&
            scopedSnapshotIds.every(
              (snapshotId) =>
                latestJobBySnapshot.get(snapshotId)?.status ===
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

function manifestSnapshotIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const snapshots = (value as { snapshots?: unknown }).snapshots;
  if (!Array.isArray(snapshots)) return [];
  return snapshots.flatMap((snapshot) => {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot) ||
      typeof (snapshot as { snapshotId?: unknown }).snapshotId !== "string"
    )
      return [];
    return [(snapshot as { snapshotId: string }).snapshotId];
  });
}

function sameSnapshotSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((snapshotId) => rightIds.has(snapshotId));
}
