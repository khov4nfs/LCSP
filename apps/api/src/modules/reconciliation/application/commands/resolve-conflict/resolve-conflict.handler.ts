import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";
import {
  CONFLICT_RECORD_STATUSES,
  SCAN_ERROR_CODES,
  SCAN_EVENT_TYPES,
} from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import type { Prisma } from "@prisma/client";

import {
  fromPrismaConflictRecordStatus,
  toPrismaConflictRecordStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { ResolveConflictCommand } from "./resolve-conflict.command.js";

const RESOLUTION_NOTE_MAX_LENGTH = 2000;

export type ResolveConflictDto = {
  conflict_id: string;
  status:
    | typeof CONFLICT_RECORD_STATUSES.resolved
    | typeof CONFLICT_RECORD_STATUSES.dismissed;
  resolved_at: string;
  all_conflicts_resolved: boolean;
  correlationId: string;
};

@CommandHandler(ResolveConflictCommand)
export class ResolveConflictHandler implements ICommandHandler<ResolveConflictCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(command: ResolveConflictCommand): Promise<ResolveConflictDto> {
    await this.assertManagerOnly(command);
    const resolution = parseResolution(
      command.resolution,
      command.correlationId,
    );
    const resolutionNote = parseResolutionNote(
      command.resolutionNote,
      resolution,
      command.correlationId,
    );
    const resolvedAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const conflict = await tx.conflictRecord.findFirst({
        where: {
          id: command.conflictId,
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
        },
        select: {
          id: true,
          assessmentId: true,
          organizationId: true,
          status: true,
        },
      });

      if (!conflict) {
        throw problemException(
          SCAN_ERROR_CODES.conflictNotFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      if (
        fromPrismaConflictRecordStatus(conflict.status) !==
        CONFLICT_RECORD_STATUSES.pending
      ) {
        throw problemException(
          SCAN_ERROR_CODES.conflictAlreadyResolved,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await tx.conflictRecord.update({
        where: { id: conflict.id },
        data: {
          status: toPrismaConflictRecordStatus(resolution),
          resolvedAt,
          resolvedById: command.resolvedById,
          resolutionNote,
        },
      });

      const remainingPending = await tx.conflictRecord.count({
        where: {
          assessmentId: command.assessmentId,
          organizationId: command.organizationId,
          status: toPrismaConflictRecordStatus(
            CONFLICT_RECORD_STATUSES.pending,
          ),
        },
      });
      const allConflictsResolved = remainingPending === 0;

      await this.auditWriter.writeInTx(
        {
          eventType:
            resolution === CONFLICT_RECORD_STATUSES.dismissed
              ? SCAN_EVENT_TYPES.conflictDismissedAudit
              : SCAN_EVENT_TYPES.conflictResolvedAudit,
          actorId: command.resolvedById,
          organizationId: command.organizationId,
          assessmentId: command.assessmentId,
          resourceType: AUDIT_RESOURCE_TYPES.conflictRecord,
          resourceId: conflict.id,
          correlationId: command.correlationId,
          causationId: conflict.id,
          decision: AUDIT_DECISIONS.allow,
          result: resolution,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          policyId: command.authorization.policyId,
          policyVersion: command.authorization.policyVersion,
          payload: {
            conflictId: conflict.id,
            assessmentId: command.assessmentId,
            resolution,
            resolvedById: command.resolvedById,
            correlationId: command.correlationId,
          },
        },
        tx,
      );

      if (allConflictsResolved) {
        await this.enqueueAllResolvedEvent(command, tx);
      }

      return allConflictsResolved;
    });

    return {
      conflict_id: command.conflictId,
      status: resolution,
      resolved_at: resolvedAt.toISOString(),
      all_conflicts_resolved: result,
      correlationId: command.correlationId,
    };
  }

  private async assertManagerOnly(
    command: ResolveConflictCommand,
  ): Promise<void> {
    const allowed =
      command.subjectRole === SUBJECT_ROLES.manager &&
      command.authorization.selectedAction === PBAC_ACTIONS.conflictResolve &&
      command.authorization.policyId !== null &&
      command.authorization.policyVersion !== null;

    if (allowed) return;

    await this.auditWriter.write({
      eventType: SCAN_EVENT_TYPES.conflictResolvedAudit,
      actorId: command.resolvedById,
      organizationId: command.organizationId,
      assessmentId: command.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.conflictRecord,
      resourceId: command.conflictId,
      correlationId: command.correlationId,
      decision: AUDIT_DECISIONS.deny,
      reasonCode: AUTH_ERROR_CODES.pbacDenied,
      policyId: command.authorization.policyId,
      policyVersion: command.authorization.policyVersion,
      payload: {
        assessmentId: command.assessmentId,
        conflictId: command.conflictId,
        action: PBAC_ACTIONS.conflictResolve,
        result: AUDIT_DECISIONS.deny,
      },
    });

    throw problemException(AUTH_ERROR_CODES.pbacDenied, command.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }

  private async enqueueAllResolvedEvent(
    command: ResolveConflictCommand,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const outboxEvent = buildOutboxMessageInput({
      aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
      aggregateId: command.assessmentId,
      eventType: SCAN_EVENT_TYPES.reconciliationAllConflictsResolved,
      organizationId: command.organizationId,
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      causationId: command.conflictId,
      actor: { id: command.resolvedById, type: AUDIT_ACTOR_TYPES.user },
      result: SCAN_EVENT_TYPES.reconciliationAllConflictsResolved,
      redactionStatus: AUDIT_REDACTION_STATUSES.none,
      idempotencyKey: `${command.assessmentId}:${SCAN_EVENT_TYPES.reconciliationAllConflictsResolved}:${command.correlationId}`,
      payload: {
        assessmentId: command.assessmentId,
        lastResolvedConflictId: command.conflictId,
        correlationId: command.correlationId,
      },
    });
    await this.outboxRepository.enqueue(outboxEvent, tx);
  }
}

function parseResolution(
  value: unknown,
  correlationId: string,
):
  | typeof CONFLICT_RECORD_STATUSES.resolved
  | typeof CONFLICT_RECORD_STATUSES.dismissed {
  if (
    value === CONFLICT_RECORD_STATUSES.resolved ||
    value === CONFLICT_RECORD_STATUSES.dismissed
  ) {
    return value;
  }

  throw problemException(
    SCAN_ERROR_CODES.conflictSchemaInvalid,
    correlationId,
    {
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    },
  );
}

function parseResolutionNote(
  value: unknown,
  resolution:
    | typeof CONFLICT_RECORD_STATUSES.resolved
    | typeof CONFLICT_RECORD_STATUSES.dismissed,
  correlationId: string,
): string | null {
  if (resolution === CONFLICT_RECORD_STATUSES.dismissed) {
    if (
      typeof value !== "string" ||
      value.trim().length === 0 ||
      value.length > RESOLUTION_NOTE_MAX_LENGTH
    ) {
      throw problemException(
        SCAN_ERROR_CODES.conflictSchemaInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    return value;
  }

  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > RESOLUTION_NOTE_MAX_LENGTH) {
    throw problemException(
      SCAN_ERROR_CODES.conflictSchemaInvalid,
      correlationId,
      {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      },
    );
  }
  return value;
}
