import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  type LegalPreparationRun,
} from "@lcsp/contracts/legal-portfolio";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AgentExecutionState as PrismaAgentExecutionState } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { toRun } from "../../../infrastructure/persistence/legal-portfolio.mappers.js";
import { FailLegalPreparationCommand } from "./fail-legal-preparation.command.js";

/** Records that an execution could not produce a submission. Idempotent for FAILED; a finished run conflicts. */
@CommandHandler(FailLegalPreparationCommand)
export class FailLegalPreparationHandler implements ICommandHandler<FailLegalPreparationCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    input: FailLegalPreparationCommand,
  ): Promise<LegalPreparationRun> {
    /** Records that an execution could not produce a submission. Idempotent for FAILED; a finished run conflicts. */
    const run = await this.prisma.legalPreparationRun.findUnique({
      where: { id: input.request.preparationRunId },
      include: { portfolio: { select: { id: true } } },
    });
    if (!run) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (run.executionState === PrismaAgentExecutionState.FAILED) {
      return toRun(run, run.portfolio?.id ?? null);
    }
    const open =
      run.executionState === PrismaAgentExecutionState.QUEUED ||
      run.executionState === PrismaAgentExecutionState.RUNNING;
    if (!open || run.portfolio) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const failed = await this.prisma.legalPreparationRun.update({
      where: { id: run.id },
      data: {
        executionState: PrismaAgentExecutionState.FAILED,
        failureReason: input.request.reason,
        completedAt: new Date(),
      },
    });
    return toRun(failed, null);
  }
}
