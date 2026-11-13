import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  type RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
import { LEGAL_SOURCE_LIFECYCLE_STATUSES } from "@lcsp/contracts/legal-source";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  PreparationExecutionContract,
  Prisma,
} from "@prisma/client";

import { toPrismaLegalSourceLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { acquireLegalSourceLifecycleLock } from "../../../../legal-source/application/services/legal-source.service.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import {
  isUniqueViolation,
  toRun,
} from "../../../infrastructure/persistence/compliance-rule-set.mappers.js";
import { StartRuleSetPreparationCommand } from "./start-rule-set-preparation.command.js";

/**
 * Starts (idempotently) one Rule Set Preparation run for the ACTIVE Legal Source Version.
 * The run's identity is its idempotency key, so a replayed or concurrently delivered start is
 * answered with the one existing run and never enqueues a second paid preparation.
 */
@CommandHandler(StartRuleSetPreparationCommand)
export class StartRuleSetPreparationHandler implements ICommandHandler<StartRuleSetPreparationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  /**
   * Business purpose: Queue one paid Preparation for an active Legal Source Version with stable retry and replay identity.
   *
   * Business rules:
   * - A start key can create only one run and may be replayed only for the same source version.
   * - Only an ACTIVE Legal Source Version may produce a shared Rule Set.
   * - Run creation and its outbox request are one transaction, preventing an unqueued or duplicate preparation.
   *
   * Execution flow:
   * 1. Return an existing matching idempotent run if the key has already been used.
   * 2. Load and verify the requested source is active.
   * 3. Create a QUEUED DIRECT_DRAFT_V1 run and enqueue its preparation request atomically.
   * 4. If a unique-key race occurs, reload and return the winning same-source run.
   *
   * Failure cases:
   * - Missing sources return not found; inactive sources return preparation-not-allowed.
   * - Reusing a key for another source returns idempotency conflict; other persistence/outbox failures propagate.
   *
   * Side effects:
   * - Creates the preparation run and outbox event and stores their linked IDs in one transaction.
   */
  async execute(
    input: StartRuleSetPreparationCommand,
  ): Promise<RuleSetPreparationRun> {
    const { legalSourceVersionId, idempotencyKey } = input.request;
    const reviewRequested =
      input.request.targetActivityScope === "DEVELOPMENT_ONLY";

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await acquireLegalSourceLifecycleLock(tx);
          const existing = await tx.ruleSetPreparationRun.findUnique({
            where: { idempotencyKey },
            include: { ruleSet: { select: { id: true } } },
          });
          if (existing) {
            return this.replayPreparation(
              existing,
              legalSourceVersionId,
              input.correlationId,
              reviewRequested,
            );
          }

          const source = await tx.legalSourceVersion.findUnique({
            where: { id: legalSourceVersionId },
            select: { id: true, status: true },
          });
          if (!source) {
            throw problemException(
              COMPLIANCE_RULE_SET_ERROR_CODES.sourceVersionNotFound,
              input.correlationId,
              { status: HttpStatus.NOT_FOUND },
            );
          }
          // A superseded or draft source never starts a new shared Rule Set.
          if (
            source.status !==
            toPrismaLegalSourceLifecycleStatus(
              LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
            )
          ) {
            throw problemException(
              COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
              input.correlationId,
              {
                status: HttpStatus.CONFLICT,
                meta: {
                  reason:
                    RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ACTIVE,
                },
              },
            );
          }
          const run = await tx.ruleSetPreparationRun.create({
            data: {
              idempotencyKey,
              executionContract: PreparationExecutionContract.DIRECT_DRAFT_V1,
              targetDate: new Date(),
              scopeReviewRequested: reviewRequested,
              legalSourceVersionId: source.id,
              requestedBy: input.requestedBy,
              correlationId: input.correlationId,
              executionState: PrismaAgentExecutionState.QUEUED,
            },
          });
          const outboxEventId = await this.outboxRepository.enqueue(
            buildOutboxMessageInput({
              aggregateType: OUTBOX_AGGREGATE_TYPES.legalSourceVersion,
              aggregateId: source.id,
              eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.preparationRequested,
              correlationId: input.correlationId,
              causationId: run.id,
              actor: { id: input.requestedBy, type: AUDIT_ACTOR_TYPES.service },
              result: AGENTIC_TOOL_STATUSES.ready,
              redactionStatus: AUDIT_REDACTION_STATUSES.none,
              idempotencyKey: `${run.id}:preparation`,
              payload: {
                preparationRunId: run.id,
                legalSourceVersionId: source.id,
                preparationRunRef: `rule-set-preparation-run:${run.id}`,
                legalSourceVersionRef: `legal-source-version:${source.id}`,
              },
            }),
            tx,
          );
          await tx.ruleSetPreparationRun.update({
            where: { id: run.id },
            data: { outboxEventId },
          });
          return toRun(run, null);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.findByKey(idempotencyKey);
        if (raced) {
          return this.replayPreparation(
            raced,
            legalSourceVersionId,
            input.correlationId,
            reviewRequested,
          );
        }
      }
      throw error;
    }
  }

  private findByKey(idempotencyKey: string) {
    return this.prisma.ruleSetPreparationRun.findUnique({
      where: { idempotencyKey },
      include: { ruleSet: { select: { id: true } } },
    });
  }

  /**
   * Business purpose:
   * Recover only an idempotent Preparation request for the same pinned source and scope intent.
   * Business rules:
   * - A repeated key must not silently change the user-selected target scope.
   * Execution flow:
   * 1. Compare existing run source and requested scope before returning it.
   * Failure cases:
   * - Source/scope conflicts become canonical idempotency failures.
   * Side effects:
   * - Returns the existing run without creating a second one.
   */
  private replayPreparation(
    existing: {
      id: string;
      legalSourceVersionId: string;
      executionState: PrismaAgentExecutionState;
      ruleSet: { id: string } | null;
      scopeReviewRequested: boolean;
    },
    legalSourceVersionId: string,
    correlationId: string,
    reviewRequested: boolean,
  ): RuleSetPreparationRun {
    if (
      existing.legalSourceVersionId !== legalSourceVersionId ||
      existing.scopeReviewRequested !== reviewRequested
    ) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return toRun(existing, existing.ruleSet?.id ?? null);
  }
}
