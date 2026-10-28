import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
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

  /**
   * Business purpose: Start or reuse preparation of a Rule Set for the currently eligible Legal Source Version.
   *
   * Business rules:
   * - An optional expected source ID prevents a stale caller from authoring against a newly active source.
   * - An existing queued or running preparation is returned idempotently.
   * - Replacing an active Rule Set requires explicit replace intent and current availability permission.
   * - Attempt idempotency keys are derived from the active source and observed attempt count.
   *
   * Execution flow:
   * 1. Read preparation availability and the active source's attempt count in a repeatable-read transaction.
   * 2. Reject an expected-source mismatch, or return an already in-progress run.
   * 3. Require either ordinary start eligibility or explicit replacement eligibility, then dispatch the shared start command.
   *
   * Failure cases:
   * - A stale expected source or unavailable start/replacement state returns preparation-not-allowed with its refusal reason.
   * - Start-command source, idempotency, or persistence errors propagate to the caller.
   *
   * Side effects:
   * - Reads availability and attempt state; an eligible request delegates creation and outbox publication to the start handler.
   */
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
      input.expectedLegalSourceVersionId &&
      input.expectedLegalSourceVersionId !== availability.legalSourceVersionId
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
    if (
      availability.refusalReason ===
        RULE_SET_PREPARATION_REFUSAL_REASONS.PREPARATION_IN_PROGRESS &&
      availability.currentRun
    ) {
      return availability.currentRun;
    }
    // An ACTIVE rule set is production history that may need a better successor, so it never
    // blocks preparation for good: an explicit replacement is allowed. Without that intent the
    // refusal stays, so a stale or racing request cannot start paid work by accident.
    const allowed =
      availability.canStart || (input.replaceActive && availability.canReplace);
    if (!allowed || !availability.legalSourceVersionId) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationNotAllowed,
        input.correlationId,
        {
          status: HttpStatus.CONFLICT,
          meta: { reason: availability.refusalReason },
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
