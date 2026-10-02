import { HttpStatus, Inject, Optional } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  toPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanTriggerSource,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
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
    @Optional() private readonly outbox?: OutboxRepository,
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
    if (
      assessment.status === ASSESSMENT_STATUS_CODES.wizardInProgress &&
      command.expectedSetupVersion !== assessment.repositorySetupVersion
    ) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
        command.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }

    const connections = await this.prisma.repositoryConnection.findMany({
      where: {
        assessmentId: command.assessmentId,
        userId: command.actorId,
        status: REPOSITORY_CONNECTION_STATUSES.active,
      },
      orderBy: [{ connectedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const snapshots =
      connections.length === 0
        ? []
        : await this.prisma.repositorySnapshot.findMany({
            where: {
              assessmentId: command.assessmentId,
              connectionId: {
                in: connections.map((connection) => connection.id),
              },
              status: REPOSITORY_SNAPSHOT_STATUSES.ready,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, connectionId: true, commitSha: true },
          });
    const latestSnapshots = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots)
      if (!latestSnapshots.has(snapshot.connectionId))
        latestSnapshots.set(snapshot.connectionId, snapshot);
    const selectedSnapshots = [...latestSnapshots.values()];
    const snapshot = selectedSnapshots.at(-1) ?? null;

    if (
      connections.length === 0 ||
      selectedSnapshots.length !== connections.length ||
      selectedSnapshots.some((item) => !/^[0-9a-f]{40}$/iu.test(item.commitSha))
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
        const relations = tx.assessmentRepositoryRelation
          ? await tx.assessmentRepositoryRelation.findMany({
              where: { assessmentId: command.assessmentId },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                fromSnapshotId: true,
                toSnapshotId: true,
                type: true,
              },
            })
          : [];
        const confirmed = await tx.assessment.updateMany({
          where: {
            id: assessment.id,
            ownerId: command.actorId,
            repositorySetupVersion: command.expectedSetupVersion,
          },
          data: {
            repositorySetupVersion: { increment: 1 },
            repositorySetupConfirmedAt: new Date(),
            repositorySetupManifest: {
              setupVersion: command.expectedSetupVersion + 1,
              snapshots: selectedSnapshots.map((item) => ({
                connectionId: item.connectionId,
                snapshotId: item.id,
                commitSha: item.commitSha,
              })),
              relations: relations.map((relation) => ({
                fromSnapshotId: relation.fromSnapshotId,
                toSnapshotId: relation.toSnapshotId,
                type: String(relation.type),
              })),
            },
          },
        });
        if (confirmed.count !== 1)
          throw problemException(
            ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
            command.correlationId,
            { status: HttpStatus.CONFLICT },
          );
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
              repositories: selectedSnapshots.map((item) => ({
                connectionId: item.connectionId,
                snapshotId: item.id,
                commitSha: item.commitSha,
              })),
            },
          },
          tx,
        );
        await this.enqueueScanJobsInTx(
          tx,
          command,
          selectedSnapshots,
          relations,
        );
      });
    }

    const scanJobs =
      this.prisma.repositoryScanJob &&
      typeof this.prisma.repositoryScanJob.findMany === "function"
        ? await this.prisma.repositoryScanJob.findMany({
            where: {
              assessmentId: command.assessmentId,
              snapshotId: { in: selectedSnapshots.map((item) => item.id) },
            },
            select: { id: true, snapshotId: true, status: true },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          })
        : [];

    return {
      assessment_id: assessment.id,
      setup_version: wasCompleted
        ? assessment.repositorySetupVersion
        : command.expectedSetupVersion + 1,
      status: assessment.status,
      repository_connection_id: snapshot!.connectionId,
      snapshot_id: snapshot!.id,
      commit_sha: snapshot!.commitSha,
      scan_jobs: scanJobs.map((scanJob) => ({
        snapshot_id: scanJob.snapshotId,
        commit_sha:
          selectedSnapshots.find(
            (snapshot) => snapshot.id === scanJob.snapshotId,
          )?.commitSha ?? "",
        scan_job_id: scanJob.id,
        status: String(scanJob.status),
      })),
    };
  }

  /**
   * Locks the confirmed snapshot set and emits one idempotent scan command per snapshot
   * in the same transaction as the assessment submission.
   */
  private async enqueueScanJobsInTx(
    tx: Prisma.TransactionClient,
    command: CompleteRepositorySetupCommand,
    snapshots: Array<{ id: string; commitSha: string }>,
    relations: Array<{
      fromSnapshotId: string;
      toSnapshotId: string;
      type: string;
    }>,
  ): Promise<void> {
    if (!this.outbox || !tx.repositoryScanJob) return;

    const triggerSource = REPOSITORY_SCAN_TRIGGER_SOURCES.manual;

    for (const snapshot of snapshots) {
      const idempotencyKey = `snapshot-auto:${command.assessmentId}:${snapshot.id}`;
      const existing = await tx.repositoryScanJob.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      if (existing) continue;

      const scanJobId = randomUUID();
      const event = buildOutboxMessageInput({
        aggregateType: OUTBOX_AGGREGATE_TYPES.repositoryScanJob,
        aggregateId: scanJobId,
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered,
        assessmentId: command.assessmentId,
        correlationId: command.correlationId,
        causationId: command.correlationId,
        actor: { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
        result: GITHUB_INTEGRATION_EVENT_TYPES.scanJobTriggeredAudit,
        redactionStatus: AUDIT_REDACTION_STATUSES.none,
        idempotencyKey,
        payload: {
          scanJobId,
          assessmentId: command.assessmentId,
          snapshotId: snapshot.id,
          commitSha: snapshot.commitSha,
          triggerSource,
          idempotencyKey,
          correlationId: command.correlationId,
          repositoryRelations: relations.map((relation) => ({
            fromSnapshotId: relation.fromSnapshotId,
            toSnapshotId: relation.toSnapshotId,
            relationType: relation.type,
          })),
        },
      });

      await tx.repositoryScanJob.create({
        data: {
          id: scanJobId,
          assessmentId: command.assessmentId,
          snapshotId: snapshot.id,
          idempotencyKey,
          triggerSource: toPrismaRepositoryScanTriggerSource(triggerSource),
          status: toPrismaRepositoryScanJobStatus(
            REPOSITORY_SCAN_JOB_STATUSES.queued,
          ),
          correlationId: command.correlationId,
        },
      });
      await this.outbox.enqueue(event, tx);
    }
  }
}
