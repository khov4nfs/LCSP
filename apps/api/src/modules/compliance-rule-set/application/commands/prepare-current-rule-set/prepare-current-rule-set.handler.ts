import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_MAX_ATTEMPTS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  ruleSetPreparationIdempotencyKey,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { loadRuleSetPreparationAvailability } from "../../../infrastructure/persistence/rule-set-preparation-availability.loader.js";
import { StartRuleSetPreparationCommand } from "../start-rule-set-preparation/start-rule-set-preparation.command.js";
import { PrepareCurrentRuleSetCommand } from "./prepare-current-rule-set.command.js";

@CommandHandler(PrepareCurrentRuleSetCommand)
export class PrepareCurrentRuleSetHandler implements ICommandHandler<PrepareCurrentRuleSetCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commands: CommandBus,
  ) {}

  async execute(input: PrepareCurrentRuleSetCommand) {
    const { availability, attempts } = await this.prisma.$transaction(
      async (tx) => {
        const availability = await loadRuleSetPreparationAvailability(tx);
        const attempts = availability.legalSourceVersionId
          ? await tx.ruleSetPreparationRun.count({
              where: {
                legalSourceVersionId: availability.legalSourceVersionId,
              },
            })
          : 0;
        return { availability, attempts };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    if (
      availability.refusalReason ===
        RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS &&
      availability.currentRun
    ) {
      return availability.currentRun;
    }
    if (!availability.canStart || !availability.legalSourceVersionId) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: { reason: availability.refusalReason },
        },
      );
    }
    if (attempts >= RULE_SET_PREPARATION_MAX_ATTEMPTS) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: {
            reason: RULE_SET_PREPARATION_REFUSAL_REASONS.ATTEMPTS_EXHAUSTED,
          },
        },
      );
    }
    // Same key as source activation: racing operators/events share one run and one outbox command.
    return this.commands.execute(
      new StartRuleSetPreparationCommand(
        {
          legalSourceVersionId: availability.legalSourceVersionId,
          idempotencyKey: ruleSetPreparationIdempotencyKey(
            availability.legalSourceVersionId,
            attempts + 1,
          ),
        },
        input.requestedBy,
        input.correlationId,
      ),
    );
  }
}
