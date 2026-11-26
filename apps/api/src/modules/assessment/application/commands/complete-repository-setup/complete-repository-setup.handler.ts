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

  /**
   * Closes repository setup by pinning the customer's repository set and activating the assessment.
   *
   * Business purpose:
   * Close repository setup by pinning every repository the customer chose as the assessment's immutable
   * repository set, then hand the assessment to the existing activation authority.
   *
   * Business rules:
   * - Only the assessment's customer owner may complete setup, while it is PREPARING or already ACTIVE.
   * - Cross-tenant row locking is prevented by scoping the lock query to both assessmentId and ownerId (actorId).
   * - The customer names the exact snapshots to pin; without a list the latest ready snapshot of the sole active
   *   connection is used (single-repository clients). Every named snapshot must be a ready snapshot of this
   *   assessment on an active connection owned by the customer, and the set is capped by the repository limit.
   * - Completion is idempotent: an ACTIVE assessment answers from its already pinned set and never re-pins.
   * - The audit event is written once, when setup completes, and lists every pinned repository.
   *
   * Execution flow:
   * 1. Lock the assessment scoped to its owner and authorize the owner and lifecycle.
   * 2. An ACTIVE assessment answers from its pinned set; otherwise resolve the chosen snapshots.
   * 3. Audit the completion, pin the set through the activation authority and return the pinned repositories.
   *
   * Failure cases:
   * - Foreign or missing assessment is not found (ASSESSMENT_NOT_FOUND); wrong lifecycle rejects with
   *   REPOSITORY_SETUP_STATE_INVALID; an empty, missing or unusable selection rejects as
   *   REPOSITORY_SETUP_INCOMPLETE (naming the missing snapshots); a bad set is rejected by the pinning authority
   *   (limit, duplicate, immutable) and rolls the whole transaction back.
   *
   * Side effects:
   * - Acquires an exclusive row lock, writes one audit event, pins the repository set and activates the
   *   assessment in one transaction.
   */
  async execute(
    command: CompleteRepositorySetupCommand,
  ): Promise<CompleteRepositorySetupDto> {
    return this.prisma.$transaction(async (tx) => {
      // Scoped row lock with ownerId check ensures tenant isolation at DB row lock level,
      // preventing Cross-Tenant Row-Lock DoS (BOLA) where an unauthorized actor holds exclusive locks.
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 FROM "Assessment" WHERE "id" = ${command.assessmentId} AND "ownerId" = ${command.actorId} FOR UPDATE`,
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

      const wasCompleted =
        assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.ACTIVE;
      if (wasCompleted) {
        const pinned = await this.readPinnedSet(tx, assessment.id);
        if (pinned.length > 0) {
          return this.result(assessment.id, pinned, assessment.domainCase);
        }
      }

      const chosen = await this.resolveChosenSnapshots(tx, command, {
        pinnedSnapshotId: assessment.domainCase?.repositorySnapshotId ?? null,
      });

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
              repositoryConnectionId: chosen[0]!.connectionId,
              snapshotId: chosen[0]!.id,
              commitSha: chosen[0]!.commitSha,
              repositories: chosen.map((snapshot) => ({
                connectionId: snapshot.connectionId,
                snapshotId: snapshot.id,
                commitSha: snapshot.commitSha,
              })),
            },
          },
          tx,
        );
      }

      // V2 assessments (canonical lifecycle) pin the repository snapshots and enter ACTIVE here;
      // the call is idempotent so a retried completion also covers a late compliance rule set.
      if (!wasCompleted) {
        await this.runtimePreparation.prepareInTx(tx, {
          assessmentId: assessment.id,
          snapshotIds: chosen.map((snapshot) => snapshot.id),
          correlationId: command.correlationId,
          responseLanguage: command.responseLanguage,
        });
      }

      const pinned = await this.readPinnedSet(tx, assessment.id);
      return pinned.length > 0
        ? this.result(
            assessment.id,
            pinned,
            await tx.assessmentCase.findUnique({
              where: { assessmentId: assessment.id },
              select: { repositorySetDigest: true },
            }),
          )
        : this.provisionalResult(assessment.id, chosen);
    });
  }

  /**
   * Business purpose: Decide exactly which repository snapshots become the assessment's repository set.
   * Business rules:
   * - A named list is authoritative and keeps the customer's order; each snapshot must be ready, belong to this
   *   assessment and sit on an active connection of this customer.
   * - Without a list, the latest ready snapshot of the latest active connection is used (or the already pinned one).
   * - An empty selection never silently falls back to "everything".
   * Execution flow:
   * 1. Load the named snapshots (or the single legacy candidate).
   * 2. Report every missing or unusable snapshot together.
   * Failure cases:
   * - Rejects with repository-setup-incomplete (409) naming the unusable snapshots.
   * Side effects:
   * - Read-only: it reads snapshots and connections and writes nothing.
   */
  private async resolveChosenSnapshots(
    tx: Prisma.TransactionClient,
    command: CompleteRepositorySetupCommand,
    context: { pinnedSnapshotId: string | null },
  ): Promise<ChosenSnapshot[]> {
    if (command.snapshotIds) {
      const ids = [...command.snapshotIds];
      const rows = await tx.repositorySnapshot.findMany({
        where: {
          id: { in: ids },
          assessmentId: command.assessmentId,
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
          connection: {
            assessmentId: command.assessmentId,
            userId: command.actorId,
            status: REPOSITORY_CONNECTION_STATUSES.active,
          },
        },
        select: { id: true, commitSha: true, connectionId: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const missing = ids.filter(
        (id) =>
          !byId.has(id) || !/^[0-9a-f]{40}$/iu.test(byId.get(id)!.commitSha),
      );
      if (missing.length > 0) throw this.setupIncomplete(command.correlationId, missing);
      return ids.map((id) => byId.get(id)!);
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
            ...(context.pinnedSnapshotId ? { id: context.pinnedSnapshotId } : {}),
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
      throw this.setupIncomplete(command.correlationId, []);
    }
    return [
      {
        id: snapshot.id,
        commitSha: snapshot.commitSha,
        connectionId: connection.id,
      },
    ];
  }

  /**
   * Business purpose: Read the repositories already pinned to the assessment in their pin order.
   * Business rules:
   * - Only recorded pin rows count; the order is the immutable pin ordinal.
   * Execution flow:
   * 1. Query the pin rows ordered by ordinal.
   * Failure cases:
   * - None; an unpinned assessment yields an empty list.
   * Side effects:
   * - Read-only: it reads pin rows and writes nothing.
   */
  private readPinnedSet(tx: Prisma.TransactionClient, assessmentId: string) {
    return tx.assessmentCaseRepository.findMany({
      where: { assessmentId },
      orderBy: { ordinal: "asc" },
      select: {
        repositoryKey: true,
        connectionId: true,
        repositorySnapshotId: true,
        repositoryCommit: true,
      },
    });
  }

  /**
   * Business purpose: Report the repository set that is now pinned to the assessment, primary repository first.
   * Business rules:
   * - The primary pin (ordinal 0) is mirrored in the legacy single-repository fields for older clients.
   * - Every pinned repository is reported with its key, connection, snapshot and commit, in pin order.
   * - The set digest is included when the case carries one.
   * Execution flow:
   * 1. Take the first pin as the primary repository.
   * 2. Map every pin to its answer entry and validate the answer shape.
   * Failure cases:
   * - A malformed persisted pin fails the response schema and rejects the request.
   * Side effects:
   * - None; it only builds and validates the answer.
   */
  private result(
    assessmentId: string,
    pinned: Array<{
      repositoryKey: string;
      connectionId: string;
      repositorySnapshotId: string;
      repositoryCommit: string;
    }>,
    domainCase: { repositorySetDigest?: string | null } | null,
  ): CompleteRepositorySetupDto {
    const primary = pinned[0]!;
    return completeAssessmentRepositorySetupResultSchema.parse({
      assessment_id: assessmentId,
      repository_connection_id: primary.connectionId,
      snapshot_id: primary.repositorySnapshotId,
      commit_sha: primary.repositoryCommit,
      ...(domainCase?.repositorySetDigest
        ? { repository_set_digest: domainCase.repositorySetDigest }
        : {}),
      repositories: pinned.map((pin) => ({
        repository_key: pin.repositoryKey,
        connection_id: pin.connectionId,
        snapshot_id: pin.repositorySnapshotId,
        commit_sha: pin.repositoryCommit,
      })),
    });
  }

  /**
   * Business purpose: Answer a completion that could not pin the set yet because no compliance rule set is available,
   * so the customer sees the repositories they chose while setup waits for legal inputs.
   * Business rules:
   * - Nothing is claimed as pinned: no repository keys and no set digest are reported.
   * - The first chosen snapshot is reported through the legacy single-repository fields.
   * Execution flow:
   * 1. Take the first chosen snapshot as the primary repository.
   * 2. Build and validate the answer without pin details.
   * Failure cases:
   * - A malformed snapshot identity fails the response schema and rejects the request.
   * Side effects:
   * - None; it only builds and validates the answer.
   */
  private provisionalResult(
    assessmentId: string,
    chosen: ChosenSnapshot[],
  ): CompleteRepositorySetupDto {
    const primary = chosen[0]!;
    return completeAssessmentRepositorySetupResultSchema.parse({
      assessment_id: assessmentId,
      repository_connection_id: primary.connectionId,
      snapshot_id: primary.id,
      commit_sha: primary.commitSha,
    });
  }

  /**
   * Business purpose: Build the rejection returned when the customer's repository selection cannot be pinned.
   * Business rules:
   * - The rejection is a 409 repository-setup-incomplete problem and lists every unusable snapshot together,
   *   so the customer can fix the whole selection in one pass.
   * Execution flow:
   * 1. Join the unusable snapshot ids into one problem metadata value.
   * 2. Create the problem exception for the caller to throw.
   * Failure cases:
   * - None; it only builds the exception.
   * Side effects:
   * - None; nothing is thrown or persisted here.
   */
  private setupIncomplete(correlationId: string, missing: string[]) {
    return problemException(
      ASSESSMENT_ERROR_CODES.repositorySetupIncomplete,
      correlationId,
      {
        status: HttpStatus.CONFLICT,
        ...(missing.length > 0
          ? { meta: { missingSnapshotIds: missing.join(",") } }
          : {}),
      },
    );
  }
}

interface ChosenSnapshot {
  id: string;
  commitSha: string;
  connectionId: string;
}
