import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AgentExecutionState as State, Prisma } from "@prisma/client";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  COMPLIANCE_RULE_SET_ERROR_CODES as E,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_FAILURE_REASONS as R,
} from "@lcsp/contracts/compliance-rule-set";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { toRun } from "../../../infrastructure/persistence/compliance-rule-set.mappers.js";
import { ResumeRuleSetPreparationCommand } from "./resume-rule-set-preparation.command.js";

/** Explicitly resume an interrupted run without discarding its pinned source reviews or draft. */
@CommandHandler(ResumeRuleSetPreparationCommand)
export class ResumeRuleSetPreparationHandler implements ICommandHandler<ResumeRuleSetPreparationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
  ) {}

  async execute(input: ResumeRuleSetPreparationCommand) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "RuleSetPreparationRun" WHERE id=${input.preparationRunId} FOR UPDATE`,
      );
      const run = await tx.ruleSetPreparationRun.findUnique({
        where: { id: input.preparationRunId },
        include: { ruleSet: { select: { id: true } } },
      });
      if (!run)
        throw problemException(E.preparationRunNotFound, input.correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      // Repeated/concurrent resume requests do not enqueue another delivery.
      if (
        !run.ruleSet &&
        (run.executionState === State.QUEUED ||
          run.executionState === State.RUNNING)
      )
        return toRun(run, null);
      const resumable =
        (run.executionState === State.PAUSED &&
          run.failureReason === R.AGENT_BUDGET_REACHED) ||
        (run.executionState === State.FAILED &&
          [R.MODEL_ERROR, R.RUNTIME_ERROR].includes(
            run.failureReason as never,
          ));
      if (run.ruleSet || !resumable)
        throw problemException(E.preparationRunConflict, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      const outboxEventId = await this.outbox.enqueue(
        buildOutboxMessageInput({
          aggregateType: OUTBOX_AGGREGATE_TYPES.legalSourceVersion,
          aggregateId: run.legalSourceVersionId,
          eventType: COMPLIANCE_RULE_SET_EVENT_TYPES.preparationRequested,
          correlationId: input.correlationId,
          causationId: run.id,
          actor: { id: input.requestedBy, type: AUDIT_ACTOR_TYPES.user },
          result: AGENTIC_TOOL_STATUSES.ready,
          redactionStatus: AUDIT_REDACTION_STATUSES.none,
          idempotencyKey: `${run.id}:resume:${run.outboxEventId ?? run.id}`,
          payload: {
            preparationRunId: run.id,
            legalSourceVersionId: run.legalSourceVersionId,
            preparationRunRef: `rule-set-preparation-run:${run.id}`,
            legalSourceVersionRef: `legal-source-version:${run.legalSourceVersionId}`,
          },
        }),
        tx,
      );
      const resumed = await tx.ruleSetPreparationRun.update({
        where: { id: run.id },
        data: {
          executionState: State.QUEUED,
          failureReason: null,
          completedAt: null,
          reviewOperationId: null,
          correlationId: input.correlationId,
          outboxEventId,
          draftValidation: Prisma.DbNull,
        },
      });
      return toRun(resumed, null);
    });
  }
}
