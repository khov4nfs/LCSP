import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_EVENT_TYPES,
  RULE_SET_PREPARATION_SYSTEM_ACTOR,
  type RuleSetPreparationRun,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus, Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AgentExecutionState as PrismaAgentExecutionState,
  Prisma,
} from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { PreparationCancellationService } from "../../../infrastructure/runtime/preparation-cancellation.service.js";
import { toRun } from "../../../infrastructure/persistence/compliance-rule-set.mappers.js";
import { CancelRuleSetPreparationCommand } from "./cancel-rule-set-preparation.command.js";

@Injectable()
@CommandHandler(CancelRuleSetPreparationCommand)
export class CancelRuleSetPreparationHandler implements ICommandHandler<CancelRuleSetPreparationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellation: PreparationCancellationService,
    private readonly audit: AuditWriterService,
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
   * 2. Mark a RUNNING run CANCEL_REQUESTED or close a never-dispatched run as CANCELLED.
   * 3. After commit, publish terminal activity for immediately closed runs; the poller retries native cancellation.
   *
   * Failure cases:
   * - An unknown run returns the preparation-run-not-found problem.
   * - A terminal or published run, or a failed compare-and-set, returns a preparation-run conflict.
   *
   * Side effects:
   * - Updates the run state and audit together; the cancellation poller contacts Agent Server outside this transaction.
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
      if (
        run.executionState === PrismaAgentExecutionState.CANCELLED ||
        run.executionState === PrismaAgentExecutionState.CANCEL_REQUESTED
      )
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

      // Why: A native stop cannot be rolled back with the database transaction.
      // How: Commit a nonterminal fence, then let the poller retry outside the lock.
      // Invariant: A RUNNING worker is never reported as CANCELLED until its native stop is confirmed.
      const needsNativeStop =
        run.executionState === PrismaAgentExecutionState.RUNNING;
      const nextState = needsNativeStop
        ? PrismaAgentExecutionState.CANCEL_REQUESTED
        : PrismaAgentExecutionState.CANCELLED;
      const completedAt = needsNativeStop ? null : new Date();
      const settled = await tx.ruleSetPreparationRun.updateMany({
        where: {
          id: run.id,
          executionState: run.executionState,
        },
        data: {
          executionState: nextState,
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
      // Why: A durable cancellation fence needs an attributable decision in the same commit.
      // How: The canonical audit writer joins the run transaction using the authenticated actor.
      // Invariant: A failed audit rolls back the cancellation request; no network stop has occurred yet.
      const systemActor = input.actorId === RULE_SET_PREPARATION_SYSTEM_ACTOR;
      await this.audit.writeInTx(
        {
          eventType:
            COMPLIANCE_RULE_SET_EVENT_TYPES.preparationCancellationRequested,
          actorId: input.actorId,
          actor: {
            id: input.actorId,
            type: systemActor
              ? AUDIT_ACTOR_TYPES.system
              : AUDIT_ACTOR_TYPES.user,
          },
          resourceType: AUDIT_RESOURCE_TYPES.legalSourceVersion,
          resourceId: run.legalSourceVersionId,
          correlationId: input.correlationId,
          causationId: run.id,
          decision: AUDIT_DECISIONS.allow,
          payload: {
            legalSourceVersionId: run.legalSourceVersionId,
            preparationRunId: run.id,
            executionState: nextState,
          },
        },
        tx,
      );
      return {
        run: {
          ...run,
          executionState: nextState,
          failureReason: null,
          completedAt,
        },
        changed: !needsNativeStop,
      };
    });

    if (result.changed)
      await this.cancellation.publishCancellationActivity(
        result.run.id,
        result.run.correlationId,
      );
    return toRun(result.run, result.run.ruleSet?.id ?? null);
  }
}
