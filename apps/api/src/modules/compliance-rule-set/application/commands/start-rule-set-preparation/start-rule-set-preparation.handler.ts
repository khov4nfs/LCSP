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
import { AgentExecutionState as PrismaAgentExecutionState, PreparationExecutionContract } from "@prisma/client";

import { toPrismaLegalSourceLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
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

  async execute(
    input: StartRuleSetPreparationCommand,
  ): Promise<RuleSetPreparationRun> {
    const { legalSourceVersionId, idempotencyKey } = input.request;

    const existing = await this.findByKey(idempotencyKey);
    if (existing) {
      return this.replayPreparation(
        existing,
        legalSourceVersionId,
        input.correlationId,
      );
    }

    const source = await this.prisma.legalSourceVersion.findUnique({
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
    // A superseded or draft source never produces a shared rule set.
    if (
      source.status !==
      toPrismaLegalSourceLifecycleStatus(LEGAL_SOURCE_LIFECYCLE_STATUSES.active)
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

    try {
      return await this.prisma.$transaction(async (tx) => {
        const run = await tx.ruleSetPreparationRun.create({
          data: {
            idempotencyKey,
            executionContract: PreparationExecutionContract.DIRECT_DRAFT_V1,
            targetDate: new Date(),
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
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.findByKey(idempotencyKey);
        if (raced) {
          return this.replayPreparation(
            raced,
            legalSourceVersionId,
            input.correlationId,
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

  private replayPreparation(
    existing: {
      id: string;
      legalSourceVersionId: string;
      executionState: PrismaAgentExecutionState;
      ruleSet: { id: string } | null;
    },
    legalSourceVersionId: string,
    correlationId: string,
  ): RuleSetPreparationRun {
    if (existing.legalSourceVersionId !== legalSourceVersionId) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.idempotencyConflict,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return toRun(existing, existing.ruleSet?.id ?? null);
  }
}
