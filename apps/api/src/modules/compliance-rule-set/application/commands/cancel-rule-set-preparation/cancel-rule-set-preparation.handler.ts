import { randomUUID } from "node:crypto";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  type RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  ASSESSMENT_RUNTIME_RUN_STATUSES,
} from "@lcsp/contracts/evidence";
import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { CommandBus, CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { PublishAgentStreamEventCommand } from "../../../../assessment/application/commands/publish-agent-stream-event/publish-agent-stream-event.command.js";
import { AgentServerPreparationControl } from "../../../infrastructure/runtime/agent-server-preparation-control.js";
import { toRun } from "../../../infrastructure/persistence/compliance-rule-set.mappers.js";
import { CancelRuleSetPreparationCommand } from "./cancel-rule-set-preparation.command.js";

@Injectable()
@CommandHandler(CancelRuleSetPreparationCommand)
export class CancelRuleSetPreparationHandler implements ICommandHandler<CancelRuleSetPreparationCommand> {
  private readonly logger = new Logger(CancelRuleSetPreparationHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AgentServerPreparationControl,
    private readonly commands: CommandBus,
  ) {}

  /**
   * Business purpose: Stop one unpublished Preparation run while preserving any existing active Rule Set.
   *
   * Business rules:
   * - Missing runs are rejected; already-cancelled runs replay successfully.
   * - Only PAUSED, QUEUED, or RUNNING runs without a published Rule Set may be cancelled.
   * - The run-row lock serializes cancellation with submission; a replacement run never supersedes or edits the current Rule Set here.
   *
   * Execution flow:
   * 1. Lock and load the Preparation run and its publication state in a transaction.
   * 2. Cancel the runtime for a RUNNING run, then compare-and-set the run to CANCELLED.
   * 3. After commit, publish cancellation activity on a best-effort basis and return the run projection.
   *
   * Failure cases:
   * - An unknown run returns the preparation-run-not-found problem.
   * - A terminal or published run, or a failed compare-and-set, returns a preparation-run conflict.
   *
   * Side effects:
   * - Updates the run state and completion time, may cancel the agent runtime, and attempts an Agent Stream event after commit.
   */
  async execute(
    input: CancelRuleSetPreparationCommand,
  ): Promise<RuleSetPreparationRun> {
    const result = await this.prisma.$transaction(async (tx) => {
      // Submission takes this same row lock before writing any rule-set rows.
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "RuleSetPreparationRun" WHERE "id" = ${input.preparationRunId} FOR UPDATE`,
      );
      const run = await tx.ruleSetPreparationRun.findUnique({
        where: { id: input.preparationRunId },
        include: { ruleSet: { select: { id: true } } },
      });
      if (!run) {
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      if (run.executionState === PrismaAgentExecutionState.CANCELLED)
        return { run, changed: false };

      const open =
        run.executionState === PrismaAgentExecutionState.PAUSED ||
        run.executionState === PrismaAgentExecutionState.QUEUED ||
        run.executionState === PrismaAgentExecutionState.RUNNING;
      if (!open || run.ruleSet) {
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      // A run that already published is refused above (`run.ruleSet`), and publication takes this
      // same row lock. An ACTIVE rule set of the source says nothing about THIS run: a replacement
      // preparation runs beside the ACTIVE version, which cancelling it must not touch.

      if (run.executionState === PrismaAgentExecutionState.RUNNING)
        await this.runtime.cancel(run.correlationId);

      const completedAt = new Date();
      const settled = await tx.ruleSetPreparationRun.updateMany({
        where: {
          id: run.id,
          executionState: run.executionState,
        },
        data: {
          executionState: PrismaAgentExecutionState.CANCELLED,
          failureReason: null,
          completedAt,
        },
      });
      if (settled.count !== 1) {
        throw problemException(
          COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunConflict,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      return {
        run: {
          ...run,
          executionState: PrismaAgentExecutionState.CANCELLED,
          failureReason: null,
          completedAt,
        },
        changed: true,
      };
    });

    if (result.changed)
      await this.publishCancellationActivity(
        result.run.id,
        result.run.correlationId,
      );
    return toRun(result.run, result.run.ruleSet?.id ?? null);
  }

  private async publishCancellationActivity(
    preparationRunId: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.commands.execute(
        new PublishAgentStreamEventCommand(
          {
            event_id: randomUUID(),
            run_id: preparationRunId,
            preparation_run_id: preparationRunId,
            correlation_id: correlationId,
            event_type:
              ASSESSMENT_AGENT_STREAM_EVENT_TYPES.preparationCancelled,
            source: "admin",
            status: ASSESSMENT_RUNTIME_RUN_STATUSES.completed,
            data: {
              boundary_type: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
              execution_state: AGENT_EXECUTION_STATES.CANCELLED,
            },
          },
          correlationId,
        ),
      );
    } catch (error) {
      // Cancellation is domain state; Agent Stream delivery is best-effort telemetry.
      this.logger.warn("Preparation cancellation activity was not published", {
        preparationRunId,
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
}
