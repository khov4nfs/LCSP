import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  ruleSetPreparationIdempotencyKey,
  type RuleSetPreparationRefusalReason,
  type RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  LegalSourceLifecycleStatus,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { loadRuleSetPreparationAvailability } from "../../../infrastructure/persistence/rule-set-preparation-availability.loader.js";
import { StartRuleSetPreparationCommand } from "../start-rule-set-preparation/start-rule-set-preparation.command.js";
import { RetryRuleSetPreparationCommand } from "./retry-rule-set-preparation.command.js";

/**
 * Retries one FAILED preparation. It never accepts a source identity from the caller: the new
 * attempt is derived from the failed run itself, only for its latest attempt, and only while the
 * current ACTIVE Legal Source Version has no active rule set or preparation.
 */
@CommandHandler(RetryRuleSetPreparationCommand)
export class RetryRuleSetPreparationHandler implements ICommandHandler<RetryRuleSetPreparationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commandBus: CommandBus,
  ) {}

  async execute(
    input: RetryRuleSetPreparationCommand,
  ): Promise<RuleSetPreparationRun> {
    const { run, availability, attempts, activeAttemptIdempotencyKey } =
      await this.prisma.$transaction(
        async (tx) => {
          const [run, availability] = await Promise.all([
            tx.ruleSetPreparationRun.findUnique({
              where: { id: input.preparationRunId },
              select: {
                id: true,
                executionState: true,
                legalSourceVersionId: true,
                idempotencyKey: true,
                legalSourceVersion: { select: { status: true } },
              },
            }),
            loadRuleSetPreparationAvailability(tx),
          ]);
          const attempts = run
            ? await tx.ruleSetPreparationRun.count({
                where: { legalSourceVersionId: run.legalSourceVersionId },
              })
            : 0;
          const activeAttemptIdempotencyKey =
            availability.refusalReason ===
              RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS &&
            availability.currentRun
              ? (
                  await tx.ruleSetPreparationRun.findUnique({
                    where: {
                      id: availability.currentRun.preparationRunId,
                    },
                    select: { idempotencyKey: true },
                  })
                )?.idempotencyKey
              : null;
          return {
            run,
            availability,
            attempts,
            activeAttemptIdempotencyKey,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    if (!run) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const refuse = (reason: RuleSetPreparationRefusalReason) =>
      problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        input.correlationId,
        { status: HttpStatus.CONFLICT, meta: { reason } },
      );

    if (run.executionState !== PrismaAgentExecutionState.FAILED) {
      throw refuse(RULE_SET_PREPARATION_REFUSAL_REASONS.RUN_NOT_FAILED);
    }
    if (run.legalSourceVersion.status !== LegalSourceLifecycleStatus.ACTIVE) {
      throw refuse(
        RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ACTIVE,
      );
    }
    if (availability.legalSourceVersionId !== run.legalSourceVersionId) {
      throw refuse(
        RULE_SET_PREPARATION_REFUSAL_REASONS.SOURCE_VERSION_NOT_ELIGIBLE,
      );
    }
    if (
      availability.refusalReason ===
        RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS &&
      availability.currentRun &&
      run.idempotencyKey ===
        ruleSetPreparationIdempotencyKey(
          run.legalSourceVersionId,
          attempts - 1,
        ) &&
      activeAttemptIdempotencyKey ===
        ruleSetPreparationIdempotencyKey(run.legalSourceVersionId, attempts)
    ) {
      return availability.currentRun;
    }
    if (availability.currentRun?.preparationRunId !== run.id) {
      throw refuse(RULE_SET_PREPARATION_REFUSAL_REASONS.RUN_NOT_LATEST_ATTEMPT);
    }
    if (availability.refusalReason !== null) {
      throw refuse(availability.refusalReason);
    }

    // The start handler re-checks that the source is still the ACTIVE one. Two operators racing on
    // the same failed run derive the same attempt key and receive the same run.
    return this.commandBus.execute(
      new StartRuleSetPreparationCommand(
        {
          legalSourceVersionId: run.legalSourceVersionId,
          idempotencyKey: ruleSetPreparationIdempotencyKey(
            run.legalSourceVersionId,
            attempts + 1,
          ),
        },
        input.requestedBy,
        input.correlationId,
      ),
    );
  }
}
