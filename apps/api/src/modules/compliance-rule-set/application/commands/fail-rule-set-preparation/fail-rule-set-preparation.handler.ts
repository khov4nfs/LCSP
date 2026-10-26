import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  RULE_SET_PREPARATION_FAILURE_REASONS as R,
  type RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { toRun } from "../../../infrastructure/persistence/compliance-rule-set.mappers.js";
import { FailRuleSetPreparationCommand } from "./fail-rule-set-preparation.command.js";

/** Records an execution failure without overwriting a terminal success or cancellation. */
@CommandHandler(FailRuleSetPreparationCommand)
export class FailRuleSetPreparationHandler implements ICommandHandler<FailRuleSetPreparationCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    input: FailRuleSetPreparationCommand,
  ): Promise<RuleSetPreparationRun> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize worker failure with Admin cancellation and publication on the same run row.
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "RuleSetPreparationRun" WHERE "id" = ${input.request.preparationRunId} FOR UPDATE`,
      );
      const run = await tx.ruleSetPreparationRun.findUnique({
        where: { id: input.request.preparationRunId },
        include: { ruleSet: { select: { id: true } } },
      });
      if (!run) {
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      if (
        (run.executionState === PrismaAgentExecutionState.PAUSED &&
          input.request.reason === R.AGENT_BUDGET_REACHED) ||
        run.executionState === PrismaAgentExecutionState.FAILED ||
        run.executionState === PrismaAgentExecutionState.CANCELLED
      ) {
        return toRun(run, run.ruleSet?.id ?? null);
      }
      const open =
        run.executionState === PrismaAgentExecutionState.QUEUED ||
        run.executionState === PrismaAgentExecutionState.RUNNING;
      if (!open || run.ruleSet) {
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const state =
        input.request.reason === R.AGENT_BUDGET_REACHED
          ? PrismaAgentExecutionState.PAUSED
          : PrismaAgentExecutionState.FAILED;
      const completedAt =
        state === PrismaAgentExecutionState.PAUSED ? null : new Date();
      const failed = await tx.ruleSetPreparationRun.updateMany({
        where: { id: run.id, executionState: run.executionState },
        data: {
          executionState: state,
          failureReason: input.request.reason,
          completedAt,
        },
      });
      if (failed.count !== 1) {
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return toRun({ ...run, executionState: state }, null);
    });
  }
}
