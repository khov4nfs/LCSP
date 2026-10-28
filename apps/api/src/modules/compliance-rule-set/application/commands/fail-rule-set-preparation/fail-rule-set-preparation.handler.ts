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

  /**
   * Business purpose: Record a worker's terminal failure or budget pause without overwriting a completed or cancelled Preparation.
   *
   * Business rules:
   * - The run-row lock serializes failure settlement with cancellation and Rule Set publication.
   * - QUEUED and RUNNING unpublished runs may be settled; duplicate failure reports for FAILED, CANCELLED, or already budget-paused runs are idempotent.
   * - AGENT_BUDGET_REACHED pauses the run for later resumption; other reasons make it FAILED.
   *
   * Execution flow:
   * 1. Lock and load the run with its publication link.
   * 2. Return the current projection for an idempotent terminal replay.
   * 3. Compare-and-set an eligible open run to PAUSED or FAILED and set completion time only for FAILED.
   *
   * Failure cases:
   * - A missing run returns not found; a published run or unsupported lifecycle transition returns a preparation conflict.
   * - A lost compare-and-set returns a conflict, and transaction failures roll back the settlement.
   *
   * Side effects:
   * - Updates execution state, failure reason, and terminal completion time in the Preparation transaction.
   */
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
