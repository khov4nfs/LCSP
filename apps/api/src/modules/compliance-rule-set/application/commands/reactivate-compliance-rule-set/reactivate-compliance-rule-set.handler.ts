import { randomUUID } from "node:crypto";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState,
  ArtifactLifecycleState,
  AuthUserRole,
  ComplianceRuleSetValidationOutcome,
  LegalSourceLifecycleStatus,
  Prisma,
  UserAccessStatus,
} from "@prisma/client";
import { AUTH_ERROR_CODES } from "@lcsp/contracts/auth";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_REACTIVATION_ERROR_CODES as Errors,
  RULE_SET_REACTIVATION_REASONS,
  complianceRuleSetReactivationResultSchema,
} from "@lcsp/contracts/compliance-rule-set";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import {
  canonicalJson,
  sha256Hex,
} from "../../../domain/compliance-rule-set-integrity.validator.js";
import { acquireComplianceRuleSetActivationLock } from "../../../infrastructure/persistence/compliance-rule-set-activation.service.js";
import {
  reactivationTargetInclude,
  storedRuleSetIntegrityValid,
} from "../../../infrastructure/persistence/stored-rule-set-integrity.js";
import { ReactivateComplianceRuleSetCommand } from "./reactivate-compliance-rule-set.command.js";

@CommandHandler(ReactivateComplianceRuleSetCommand)
export class ReactivateComplianceRuleSetHandler implements ICommandHandler<ReactivateComplianceRuleSetCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriterService,
    private readonly outbox: OutboxRepository,
  ) {}

  /**
   * Business purpose: Restore a previously activated Rule Set as the single active version through an auditable, idempotent transition.
   *
   * Business rules:
   * - Only an active administrator may request reactivation, and the caller must identify the expected current active version.
   * - Reactivation is refused during Preparation, for an already-active target, or for a target that is not a valid previously activated and superseded version.
   * - The target's successful validation, successful Preparation, source lifecycle, activation record, run/source pins, stored digest, and relational integrity must still agree.
   * - A prior semantic-authority-containment rejection permanently excludes the target from this path.
   *
   * Execution flow:
   * 1. Hash the request and enter a transaction; verify the active admin and acquire the global activation lock.
   * 2. Replay a matching idempotency record, or verify the expected active version, target eligibility, and stored packet integrity.
   * 3. Supersede the current version, activate the target, then persist the audit event, outbox event, and transition record atomically.
   * 4. Return the schema-validated transition receipt; translate known uniqueness, relation, and serialization conflicts to the reactivation conflict result.
   *
   * Failure cases:
   * - Missing actors or denied roles return forbidden; a missing target returns not found.
   * - Stale active pins, ineligible or corrupt targets, changed idempotency payloads, and transaction conflicts return typed conflicts.
   * - Any transaction failure rolls back both lifecycle changes and their audit/outbox records.
   *
   * Side effects:
   * - Changes the two Rule Set lifecycle records and atomically writes the audit event, outbox event, and immutable reactivation record.
   */
  async execute(command: ReactivateComplianceRuleSetCommand) {
    const { targetRuleSetVersionId, request, actorId, correlationId } = command;
    const requestDigest = sha256Hex(
      canonicalJson({ targetRuleSetVersionId, actorId, ...request }),
    );
    /**
     * Business purpose: Give reactivation precondition failures one consistent conflict response.
     *
     * Business rules:
     * - The caller's correlation ID is retained so the rejected transition can be traced.
     * - This helper represents a rejected lifecycle request and does not classify the underlying legal content.
     *
     * Execution flow:
     * 1. Accept the specific reactivation conflict code.
     * 2. Create the shared HTTP conflict problem for this request.
     *
     * Failure cases:
     * - The returned problem identifies the supplied rejected transition code.
     *
     * Side effects:
     * - None; constructs a problem exception for the surrounding transaction to reject.
     */
    const conflict = (code: string) =>
      problemException(code, correlationId, { status: HttpStatus.CONFLICT });
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const actor = actorId
            ? await tx.user.findUnique({ where: { id: actorId } })
            : null;
          if (
            actor?.role !== AuthUserRole.ADMIN ||
            actor.accessStatus !== UserAccessStatus.ACTIVE
          )
            throw problemException(AUTH_ERROR_CODES.rbacDenied, correlationId, {
              status: HttpStatus.FORBIDDEN,
            });
          // GLOBAL authority: exactly the same lock and isolation as normal Preparation activation.
          await acquireComplianceRuleSetActivationLock(tx);
          const replay =
            await tx.complianceRuleSetReactivationRecord.findUnique({
              where: { idempotencyKey: request.idempotencyKey },
            });
          /**
           * Business purpose: Project a persisted reactivation record into the public transition receipt.
           *
           * Business rules:
           * - Receipt fields come from the immutable record, and replay status reflects whether this request reused it.
           * - The shared result schema validates the receipt before it is returned.
           *
           * Execution flow:
           * 1. Map target, previous-active, digest, timestamps, audit, and outbox identifiers from the record.
           * 2. Attach the replay marker and parse the result against the contract.
           *
           * Failure cases:
           * - A record that does not satisfy the result contract fails schema validation.
           *
           * Side effects:
           * - None; constructs a validated in-memory result.
           */
          const result = (
            record: Prisma.ComplianceRuleSetReactivationRecordGetPayload<object>,
            replayed: boolean,
          ) =>
            complianceRuleSetReactivationResultSchema.parse({
              transitionId: record.id,
              ruleSetVersionId: record.targetRuleSetVersionId,
              previousActiveRuleSetVersionId: record.previousRuleSetVersionId,
              ruleSetDigest: record.targetRuleSetDigest,
              correlationId: record.correlationId,
              completedAt: record.createdAt.toISOString(),
              auditEventId: record.auditEventId,
              outboxEventId: record.outboxEventId,
              replayed,
            });
          if (replay) {
            if (replay.requestDigest !== requestDigest)
              throw conflict(
                COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
              );
            return result(replay, true);
          }
          const active = await tx.complianceRuleSetVersion.findFirst({
            where: { lifecycleState: ArtifactLifecycleState.ACTIVE },
          });
          if (!active) throw conflict(Errors.NO_ACTIVE_RULE_SET);
          if (active.id !== request.expectedActiveRuleSetVersionId)
            throw conflict(Errors.EXPECTED_ACTIVE_MISMATCH);
          if (active.id === targetRuleSetVersionId)
            throw conflict(Errors.TARGET_ALREADY_ACTIVE);
          if (
            await tx.ruleSetPreparationRun.count({
              where: {
                executionState: {
                  in: [AgentExecutionState.QUEUED, AgentExecutionState.RUNNING],
                },
              },
            })
          )
            throw conflict(Errors.PREPARATION_IN_PROGRESS);
          const target = await tx.complianceRuleSetVersion.findUnique({
            where: { id: targetRuleSetVersionId },
            include: reactivationTargetInclude,
          });
          if (!target)
            throw problemException(Errors.TARGET_NOT_FOUND, correlationId, {
              status: HttpStatus.NOT_FOUND,
            });
          const rejectedBefore =
            await tx.complianceRuleSetReactivationRecord.count({
              where: {
                previousRuleSetVersionId: target.id,
                reason:
                  RULE_SET_REACTIVATION_REASONS.SEMANTIC_AUTHORITY_CONTAINMENT,
              },
            });
          if (
            target.lifecycleState !== ArtifactLifecycleState.SUPERSEDED ||
            target.validationOutcome !==
              ComplianceRuleSetValidationOutcome.PASSED ||
            target.preparationRun.executionState !==
              AgentExecutionState.SUCCEEDED ||
            target.activation?.validationOutcome !==
              ComplianceRuleSetValidationOutcome.PASSED ||
            !target.activatedAt ||
            !target.supersededAt ||
            !target.validatedAt ||
            rejectedBefore ||
            ![
              LegalSourceLifecycleStatus.ACTIVE,
              LegalSourceLifecycleStatus.SUPERSEDED,
            ].some((status) => status === target.legalSourceVersion.status)
          )
            throw conflict(Errors.TARGET_NOT_ELIGIBLE);
          const chunks = await tx.legalDocumentChunk.findMany({
            where: { legalSourceVersionId: target.legalSourceVersionId },
            select: {
              id: true,
              legalSourceVersionId: true,
              documentId: true,
              locator: true,
              contentSha256: true,
            },
          });
          if (
            target.activation.requestDigest !== target.ruleSetDigest ||
            target.activation.preparationRunId !== target.preparationRunId ||
            target.preparationRun.legalSourceVersionId !==
              target.legalSourceVersionId ||
            !storedRuleSetIntegrityValid(target, chunks)
          )
            throw conflict(Errors.INTEGRITY_INVALID);
          const id = randomUUID();
          const now = new Date();
          await tx.complianceRuleSetVersion.update({
            where: { id: active.id },
            data: {
              lifecycleState: ArtifactLifecycleState.SUPERSEDED,
              supersededAt: now,
            },
          });
          await tx.complianceRuleSetVersion.update({
            where: { id: target.id },
            data: {
              lifecycleState: ArtifactLifecycleState.ACTIVE,
              activatedAt: now,
              supersededAt: null,
            },
          });
          const eventType = COMPLIANCE_RULE_SET_EVENT_TYPES.ruleSetReactivated;
          const payload = {
            transitionRef: `compliance-rule-set-reactivation:${id}`,
            ruleSetVersionRef: `compliance-rule-set:${target.id}`,
            previousActiveRuleSetRef: `compliance-rule-set:${active.id}`,
            legalSourceVersionRef: `legal-source-version:${target.legalSourceVersionId}`,
            ruleSetDigest: target.ruleSetDigest,
            reason: request.reason,
          };
          await this.audit.writeInTx(
            {
              eventType,
              actorId,
              actor: { id: actorId, type: AUDIT_ACTOR_TYPES.user },
              resourceType: AUDIT_RESOURCE_TYPES.complianceRuleSetVersion,
              resourceId: target.id,
              decision: AUDIT_DECISIONS.allow,
              correlationId,
              causationId: id,
              redactionStatus: AUDIT_REDACTION_STATUSES.none,
              payload,
            },
            tx,
          );
          const auditEvent = await tx.auditEvent.findFirstOrThrow({
            where: {
              eventType,
              resourceId: target.id,
              correlationId,
              actorId,
              payload: {
                path: ["transitionRef"],
                equals: payload.transitionRef,
              },
            },
          });
          const outboxEventId = await this.outbox.enqueue(
            buildOutboxMessageInput({
              aggregateType: OUTBOX_AGGREGATE_TYPES.complianceRuleSetVersion,
              aggregateId: target.id,
              eventType,
              actor: { id: actorId, type: AUDIT_ACTOR_TYPES.user },
              correlationId,
              causationId: id,
              result: AGENTIC_TOOL_STATUSES.ready,
              redactionStatus: AUDIT_REDACTION_STATUSES.none,
              idempotencyKey: `rule-set-reactivation:${request.idempotencyKey}`,
              payload,
            }),
            tx,
          );
          const record = await tx.complianceRuleSetReactivationRecord.create({
            data: {
              id,
              targetRuleSetVersionId: target.id,
              previousRuleSetVersionId: active.id,
              targetRuleSetDigest: target.ruleSetDigest,
              previousRuleSetDigest: active.ruleSetDigest,
              targetPreviousActivatedAt: target.activatedAt,
              targetPreviousSupersededAt: target.supersededAt,
              previousActiveActivatedAt: active.activatedAt!,
              actorId,
              reason: request.reason,
              requestDigest,
              idempotencyKey: request.idempotencyKey,
              correlationId,
              auditEventId: auditEvent.id,
              outboxEventId,
              createdAt: now,
            },
          });
          return result(record, false);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 30_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2003", "P2034"].includes(error.code)
      )
        throw conflict(Errors.CONFLICT);
      throw error;
    }
  }
}
