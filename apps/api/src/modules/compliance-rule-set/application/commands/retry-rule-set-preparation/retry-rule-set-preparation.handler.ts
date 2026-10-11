import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_MAX_ATTEMPTS,
  RULE_SET_PREPARATION_REFUSAL_REASONS,
  ruleSetPreparationIdempotencyKey,
  type RuleSetPreparationRefusalReason,
  type RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AgentExecutionState as PrismaAgentExecutionState } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { StartRuleSetPreparationCommand } from "../start-rule-set-preparation/start-rule-set-preparation.command.js";
import { RetryRuleSetPreparationCommand } from "./retry-rule-set-preparation.command.js";

/**
 * Retries one FAILED preparation. It never accepts a source identity from the caller: the new
 * attempt is derived from the failed run itself, only for its latest attempt, and only while the
 * attempt budget and the ACTIVE Legal Source Version still allow it.
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
    const run = await this.prisma.ruleSetPreparationRun.findUnique({
      where: { id: input.preparationRunId },
      select: {
        id: true,
        executionState: true,
        legalSourceVersionId: true,
      },
    });
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
    const [attempts, latest] = await Promise.all([
      this.prisma.ruleSetPreparationRun.count({
        where: { legalSourceVersionId: run.legalSourceVersionId },
      }),
      this.prisma.ruleSetPreparationRun.findFirst({
        where: { legalSourceVersionId: run.legalSourceVersionId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      }),
    ]);
    if (latest?.id !== run.id) {
      throw refuse(RULE_SET_PREPARATION_REFUSAL_REASONS.RUN_NOT_LATEST_ATTEMPT);
    }
    if (attempts >= RULE_SET_PREPARATION_MAX_ATTEMPTS) {
      throw refuse(RULE_SET_PREPARATION_REFUSAL_REASONS.ATTEMPTS_EXHAUSTED);
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
