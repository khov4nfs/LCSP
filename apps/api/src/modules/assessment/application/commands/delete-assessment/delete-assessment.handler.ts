import { randomUUID } from "node:crypto";
import { HttpStatus, Inject } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_LIFECYCLE_STATES as Lifecycle,
  AGENT_EXECUTION_STATES as Execution,
  HUMAN_RESOLUTION_REQUEST_STATUSES as HumanRequest,
  ASSESSMENT_LIFECYCLE_TRANSITIONS,
  AGENTIC_RUNTIME_TRANSITION_GUARDS as Guards,
} from "@lcsp/contracts/assessment";
import {
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
  AUDIT_ACTOR_TYPES,
} from "@lcsp/contracts/audit";
import { OUTBOX_AGGREGATE_TYPES } from "@lcsp/contracts/outbox";
import { Prisma } from "@prisma/client";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import {
  ASSESSMENT_RUNTIME_ERASURE,
  type AssessmentRuntimeErasurePort,
} from "../../ports/assessment-runtime-erasure.port.js";
import {
  ArtifactStorageService,
  chunkedManifestSchema,
} from "../../../../../platform/storage/artifact-storage.service.js";
import { eraseAssessmentLogs } from "../../../../../platform/logging/logging-context.js";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  ASSESSMENT_BILLING_RETENTION,
  type AssessmentBillingRetentionPort,
} from "../../ports/billing/assessment-billing-retention.port.js";
import {
  ASSESSMENT_REPOSITORY,
  type AssessmentRepository,
} from "../../ports/persistence/assessment.repository.js";
import {
  DeleteAssessmentCommand,
  type DeleteAssessmentDto,
} from "./delete-assessment.command.js";

// Cleanup claims are renewable and recoverable: active requests exclude
// duplicate side effects, while a crashed request can be reclaimed later.
const DELETION_FENCE_LEASE_MS = 10 * 60 * 1000;

@CommandHandler(DeleteAssessmentCommand)
export class DeleteAssessmentHandler implements ICommandHandler<DeleteAssessmentCommand> {
  constructor(
    @Inject(ASSESSMENT_REPOSITORY)
    private readonly assessments: AssessmentRepository,
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    @Inject(ASSESSMENT_BILLING_RETENTION)
    private readonly billingRetention: AssessmentBillingRetentionPort,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
    @Inject(ASSESSMENT_RUNTIME_ERASURE)
    private readonly runtimeErasure: AssessmentRuntimeErasurePort,
    private readonly storage: ArtifactStorageService,
  ) {}

  /**
   * Deletes an assessment and cascades cleanup across runtime, storage, billing, and audit artifacts.
   *
   * Business purpose:
   * Permanently erases an assessment while safely preserving anonymized financial and audit receipts.
   *
   * Business rules:
   * - Only the authenticated owner of the assessment can delete it.
   * - If an audit deletion receipt already exists for this actor, returns idempotent success.
   * - Row lock under FOR UPDATE must be strictly scoped to assessment ID and actor owner ID.
   * - An owner-bound database fence must prevent ownership changes throughout external cleanup.
   * - Only one unexpired fence token may execute external cleanup at a time.
   * - If row is missing or ownership changed under the row lock, must halt immediately before any external side effects with masked 404.
   * - Active runtime threads and storage artifacts must be erased before record removal.
   * - Execution isolation records must be detached before assessment deletion to avoid FK restrict errors.
   *
   * Execution flow:
   * 1. Check if assessment exists; if not, check for prior deletion audit receipt for idempotency.
   * 2. Verify actor owns the assessment.
   * 3. In the revocation transaction, acquire the authoritative owner-scoped row lock, cancel lifecycle/runtime work, and persist the non-runnable state.
   * 4. Persist an owner-bound deletion fence before releasing the revocation transaction.
   * 5. Erase runtime thread state, unshared storage chunks and assessment logs outside a database transaction while the fence blocks owner changes.
   * 6. Release active billing reservations.
   * 7. Redact audit payloads, write the deletion receipt, detach retained records, delete the assessment, and clear outbox messages.
   * 8. Return deletion confirmation.
   *
   * Failure cases:
   * - Assessment not found or ownership mismatch: throws NOT_FOUND with ASSESSMENT_NOT_FOUND.
   * - Concurrent ownership race under row lock: throws NOT_FOUND with ASSESSMENT_NOT_FOUND before external side effects.
   * - A second cleanup request while another lease is active: throws CONFLICT without repeating external side effects.
   *
   * Side effects:
   * - Calls runtime erasure port to wipe agent thread.
   * - Wipes storage blobs and log files.
   * - Releases reserved billing credits and detaches billing records.
   * - Permanently deletes assessment and execution isolation rows.
   */
  async execute(
    command: DeleteAssessmentCommand,
  ): Promise<DeleteAssessmentDto> {
    // Owner-scope the preliminary read so foreign assessment metadata never
    // enters the application layer; row locks still revalidate this authority.
    const assessment = await this.assessments.findByIdForOwner(
      command.assessmentId,
      command.actorId,
    );
    if (!assessment) {
      const receipt = await this.prisma.auditEvent.findFirst({
        where: {
          eventType: ASSESSMENT_EVENT_TYPES.deleted,
          actorId: command.actorId,
          resourceType: AUDIT_RESOURCE_TYPES.assessment,
          resourceId: command.assessmentId,
        },
        select: { id: true },
      });
      if (receipt)
        return { assessment_id: command.assessmentId, deleted: true };
    }
    if (!assessment || assessment.ownerId !== command.actorId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        command.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    // Commit revocation before external erasure: a failed cleanup leaves a non-runnable
    // assessment and the same DELETE can safely finish it without a new runtime path.
    const revocation = await this.prisma.$transaction(async (tx) => {
      // Explanatory comment (ASM-05 / ASM-OWNER-01):
      // Rationale (Why): Prevent ownership race condition where assessment ownership changes
      // or record is deleted between initial repository lookup and transaction lock acquisition.
      // Mechanism (How): Authoritatively acquire row lock scoped to BOTH assessment id and actorId
      // under FOR UPDATE. If row does not match or owner does not match actorId, throw masked 404 immediately.
      // Invariants: Ensures NO side effects (runtime erasure, storage wipe, log wipe, billing release)
      // execute on unauthorized or transferred assessments.
      const rows = await tx.$queryRaw<Array<{ id: string; ownerId?: string }>>(
        Prisma.sql`SELECT id, "ownerId" FROM "Assessment" WHERE id=${assessment.id} AND "ownerId"=${command.actorId} FOR UPDATE`,
      );
      if (!rows[0]) {
        // A concurrent request may have completed deletion after this command's
        // preliminary read. Replaying the same actor's durable receipt preserves
        // DELETE idempotency without treating a foreign/missing row as success.
        const concurrentReceipt = await tx.auditEvent.findFirst({
          where: {
            eventType: ASSESSMENT_EVENT_TYPES.deleted,
            actorId: command.actorId,
            resourceType: AUDIT_RESOURCE_TYPES.assessment,
            resourceId: command.assessmentId,
          },
          select: { id: true },
        });
        if (concurrentReceipt) {
          return { alreadyDeleted: true as const, threadId: null };
        }
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const current = await tx.assessment.findUniqueOrThrow({
        where: { id: assessment.id },
        include: { runtime: true },
      });
      if (current.ownerId !== command.actorId) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      // The composite Assessment(id, ownerId) foreign key makes this fence an
      // enforceable database invariant: ownerId cannot change until deletion
      // completes and the fence cascades with the assessment row.
      const existingFence = await tx.assessmentDeletionFence.findUnique({
        where: { assessmentId: assessment.id },
        select: { ownerId: true, token: true, leaseExpiresAt: true },
      });
      if (existingFence && existingFence.ownerId !== command.actorId) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const leaseExpiresAt = new Date(Date.now() + DELETION_FENCE_LEASE_MS);
      if (existingFence && existingFence.leaseExpiresAt > new Date()) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.conflict,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      // Reclamation is a CAS on the exact expired token. A prior claimant that
      // renews first makes count zero; a reclaimer that swaps the token first
      // makes every later renewal by the prior claimant fail.
      const claimToken = randomUUID();
      let deletionFence: {
        ownerId: string;
        token: string;
        leaseExpiresAt: Date;
      };
      if (existingFence) {
        const reclaimed = await tx.assessmentDeletionFence.updateMany({
          where: {
            assessmentId: assessment.id,
            ownerId: command.actorId,
            token: existingFence.token,
            leaseExpiresAt: { lte: new Date() },
          },
          data: { token: claimToken, leaseExpiresAt },
        });
        if (reclaimed.count !== 1) {
          throw problemException(
            ASSESSMENT_ERROR_CODES.conflict,
            command.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        deletionFence = {
          ownerId: command.actorId,
          token: claimToken,
          leaseExpiresAt,
        };
      } else {
        deletionFence = await tx.assessmentDeletionFence.create({
          data: {
            assessmentId: assessment.id,
            ownerId: command.actorId,
            token: claimToken,
            leaseExpiresAt,
          },
          select: { ownerId: true, token: true, leaseExpiresAt: true },
        });
      }
      if (
        current.lifecycleState &&
        current.lifecycleRevision !== null &&
        ASSESSMENT_LIFECYCLE_TRANSITIONS[current.lifecycleState][
          Lifecycle.CANCELLED
        ]
      ) {
        await this.lifecycle.transitionVerifiedInTx(
          {
            assessmentId: assessment.id,
            expectedRevision: current.lifecycleRevision,
            toState: Lifecycle.CANCELLED,
            actorId: command.actorId,
            correlationId: command.correlationId,
          },
          tx,
          [Guards.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION],
          { id: command.actorId, type: AUDIT_ACTOR_TYPES.user },
        );
      }
      if (current.runtime) {
        await tx.assessmentRuntime.update({
          where: { assessmentId: assessment.id },
          data: {
            leaseToken: null,
            leaseExpiresAt: null,
            ...([
              Execution.QUEUED,
              Execution.RUNNING,
              Execution.INTERRUPTED,
              Execution.PAUSED,
            ].some((state) => state === current.runtime?.executionState)
              ? { executionState: Execution.CANCELLED }
              : {}),
          },
        });
      }
      await tx.assessmentHumanRequest.updateMany({
        where: { assessmentId: assessment.id, status: HumanRequest.OPEN },
        data: { status: HumanRequest.CANCELLED },
      });
      return {
        alreadyDeleted: false as const,
        fenceToken: deletionFence.token,
        threadId: current.runtime?.threadId ?? null,
      };
    });

    if (revocation.alreadyDeleted) {
      return { assessment_id: assessment.id, deleted: true };
    }

    let releasedReservations: string[];
    try {
      // External systems cannot join the PostgreSQL transaction. The durable
      // composite-FK fence keeps ownership immutable without holding a database
      // transaction open across worker, storage, filesystem and billing I/O.
      await this.renewDeletionLease({
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        token: revocation.fenceToken,
        correlationId: command.correlationId,
      });
      if (revocation.threadId) {
        await this.runtimeErasure.erase({
          assessmentId: assessment.id,
          ownerId: assessment.ownerId,
          threadId: revocation.threadId,
        });
      }

      await this.renewDeletionLease({
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        token: revocation.fenceToken,
        correlationId: command.correlationId,
      });
      const artifacts = await this.prisma.assessmentArtifact.findMany({
        where: { assessmentId: assessment.id },
        select: { storageRef: true },
      });
      const otherArtifacts = await this.prisma.assessmentArtifact.findMany({
        where: { assessmentId: { not: assessment.id } },
        select: { storageRef: true },
      });
      const protectedChunks = new Set(
        otherArtifacts.flatMap(({ storageRef }) =>
          storageRef
            ? chunkedManifestSchema.parse(JSON.parse(storageRef)).chunks
            : [],
        ),
      );
      for (const artifact of artifacts) {
        if (artifact.storageRef) {
          await this.renewDeletionLease({
            assessmentId: assessment.id,
            ownerId: assessment.ownerId,
            token: revocation.fenceToken,
            correlationId: command.correlationId,
          });
          await this.storage.eraseImmutableArtifact(
            chunkedManifestSchema.parse(JSON.parse(artifact.storageRef)),
            protectedChunks,
          );
        }
      }
      await eraseAssessmentLogs(assessment.ownerId, assessment.id);

      await this.renewDeletionLease({
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        token: revocation.fenceToken,
        correlationId: command.correlationId,
      });
      releasedReservations =
        await this.billingRetention.releaseActiveReservations({
          assessmentId: assessment.id,
          userId: assessment.ownerId,
        });
      await this.renewDeletionLease({
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        token: revocation.fenceToken,
        correlationId: command.correlationId,
      });
    } catch (error) {
      // A handled cleanup failure releases only this token's lease for an
      // immediate safe retry; the durable FK fence still blocks owner transfer.
      await this.expireDeletionLease({
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        token: revocation.fenceToken,
      });
      throw error;
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Revalidate both owner and fence token before final database deletion.
        // A missing row may be a concurrent idempotent completion; a mismatched
        // fence is never allowed to authorize another request's cleanup.
        const rows = await tx.$queryRaw<
          Array<{ id: string; ownerId?: string }>
        >(
          Prisma.sql`SELECT id, "ownerId" FROM "Assessment" WHERE id=${assessment.id} AND "ownerId"=${command.actorId} FOR UPDATE`,
        );
        if (!rows[0]) {
          const concurrentReceipt = await tx.auditEvent.findFirst({
            where: {
              eventType: ASSESSMENT_EVENT_TYPES.deleted,
              actorId: command.actorId,
              resourceType: AUDIT_RESOURCE_TYPES.assessment,
              resourceId: command.assessmentId,
            },
            select: { id: true },
          });
          if (concurrentReceipt) return;
          throw problemException(
            ASSESSMENT_ERROR_CODES.notFound,
            command.correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }
        const deletionFence = await tx.assessmentDeletionFence.findUnique({
          where: { assessmentId: assessment.id },
          select: { ownerId: true, token: true },
        });
        if (
          !deletionFence ||
          deletionFence.ownerId !== command.actorId ||
          deletionFence.token !== revocation.fenceToken
        ) {
          throw problemException(
            ASSESSMENT_ERROR_CODES.notFound,
            command.correlationId,
            { status: HttpStatus.NOT_FOUND },
          );
        }

        // Only metadata-only security/accounting receipts survive; erase all attributable payloads.
        await tx.auditEvent.updateMany({
          where: {
            OR: [
              { resourceId: assessment.id },
              { payload: { path: ["assessmentId"], equals: assessment.id } },
            ],
          },
          data: { payload: {} },
        });
        await this.auditWriter.writeInTx(
          {
            eventType: ASSESSMENT_EVENT_TYPES.deleted,
            actorId: command.actorId,
            assessmentId: assessment.id,
            resourceType: AUDIT_RESOURCE_TYPES.assessment,
            resourceId: assessment.id,
            correlationId: command.correlationId,
            causationId: command.correlationId,
            decision: AUDIT_DECISIONS.allow,
            result: ASSESSMENT_EVENT_TYPES.deleted,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            payload: {
              assessmentId: assessment.id,
              releasedReservations,
            },
          },
          tx,
        );
        // Explanatory comment:
        // Clean up AssessmentExecutionIsolation records before deleting the Assessment.
        // AssessmentExecutionIsolation has onDelete: Restrict, preventing foreign key constraint violation (P2003/P2014).
        await tx.assessmentExecutionIsolation?.deleteMany({
          where: { assessmentId: assessment.id },
        });
        // Billing records outlive the assessment as financial history, so the
        // database refuses to cascade them. Detaching keeps the record and lets
        // the assessment go.
        await this.billingRetention.detachAssessment(assessment.id, tx);
        const connections = await tx.repositoryConnection.findMany({
          where: { assessmentId: assessment.id },
          select: { id: true },
        });
        await tx.assessment.delete({ where: { id: assessment.id } });
        await tx.repositoryConnection.deleteMany({
          where: {
            id: { in: connections.map((connection) => connection.id) },
            userId: assessment.ownerId,
            assessmentId: null,
            snapshots: { none: {} },
          },
        });
        // AssessmentEvent cascades first, releasing its outbox FK. Generic outbox infrastructure stays.
        await tx.outboxMessage.deleteMany({
          where: {
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: assessment.id,
          },
        });
      });
    } catch (error) {
      // Finalization can fail after external cleanup; expiring this exact token
      // lets a retry resume immediately instead of waiting for the full lease.
      await this.expireDeletionLease({
        assessmentId: assessment.id,
        ownerId: assessment.ownerId,
        token: revocation.fenceToken,
      });
      throw error;
    }

    return { assessment_id: assessment.id, deleted: true };
  }

  /**
   * Business purpose: Make a failed deletion claim immediately reclaimable without removing its owner fence.
   *
   * Business rules:
   * - Only the exact assessment-owner-token tuple may release its lease.
   * - The durable fence row remains present so ownership cannot change after partial cleanup.
   *
   * Execution flow:
   * 1. Match the current cleanup token and owner.
   * 2. Move lease expiry to the current time.
   * 3. Ignore a zero count because another claimant may already own or delete the fence.
   *
   * Failure cases:
   * - Database failures propagate because hiding them would delay safe recovery.
   * - A replaced or cascaded token updates zero rows and remains untouched.
   *
   * Side effects:
   * - Updates only the matching deletion-fence expiry timestamp.
   */
  private async expireDeletionLease(input: {
    assessmentId: string;
    ownerId: string;
    token: string;
  }): Promise<void> {
    await this.prisma.assessmentDeletionFence.updateMany({
      where: {
        assessmentId: input.assessmentId,
        ownerId: input.ownerId,
        token: input.token,
      },
      data: { leaseExpiresAt: new Date() },
    });
  }

  /**
   * Business purpose: Keep exclusive deletion cleanup ownership alive while external work progresses.
   *
   * Business rules:
   * - Only the current assessment-owner-token tuple may renew the lease.
   * - A missing or replaced token means this request must stop before another side effect.
   *
   * Execution flow:
   * 1. Extend the matching fence lease by the configured bounded interval.
   * 2. Verify exactly one fence was renewed.
   * 3. Reject a lost claim as a conflict using the request correlation identifier.
   *
   * Failure cases:
   * - Missing, expired-and-reclaimed, or foreign fence token throws a masked conflict problem.
   * - Database failures propagate without executing the next external action.
   *
   * Side effects:
   * - Updates the durable deletion-fence lease timestamp; no external service is called.
   */
  private async renewDeletionLease(input: {
    assessmentId: string;
    ownerId: string;
    token: string;
    correlationId: string;
  }): Promise<void> {
    const renewed = await this.prisma.assessmentDeletionFence.updateMany({
      where: {
        assessmentId: input.assessmentId,
        ownerId: input.ownerId,
        token: input.token,
      },
      data: {
        leaseExpiresAt: new Date(Date.now() + DELETION_FENCE_LEASE_MS),
      },
    });
    if (renewed.count !== 1) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.conflict,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
  }
}
