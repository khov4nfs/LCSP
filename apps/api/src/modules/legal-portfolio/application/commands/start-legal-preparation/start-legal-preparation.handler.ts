import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import { AGENTIC_TOOL_STATUSES } from "@lcsp/contracts/evidence";
import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  LEGAL_PORTFOLIO_EVENT_TYPES,
  type LegalPreparationRun,
} from "@lcsp/contracts/legal-portfolio";
import { LEGAL_RULE_ERROR_CODES } from "@lcsp/contracts/legal-rule-catalog";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AgentExecutionState as PrismaAgentExecutionState } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import {
  isUniqueViolation,
  toRun,
} from "../../../infrastructure/persistence/legal-portfolio.mappers.js";
import { StartLegalPreparationCommand } from "./start-legal-preparation.command.js";

/** Starts (idempotently) one Legal Preparation run for one pinned corpus. */
@CommandHandler(StartLegalPreparationCommand)
export class StartLegalPreparationHandler implements ICommandHandler<StartLegalPreparationCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(
    input: StartLegalPreparationCommand,
  ): Promise<LegalPreparationRun> {
    /** Starts (idempotently) one Legal Preparation run for one pinned corpus. */
    const { legalCorpusVersionId, idempotencyKey } = input.request;

    const existing = await this.prisma.legalPreparationRun.findUnique({
      where: { idempotencyKey },
      include: { portfolio: { select: { id: true } } },
    });
    if (existing) {
      return this.replayPreparation(
        existing,
        legalCorpusVersionId,
        input.correlationId,
      );
    }

    const corpus = await this.prisma.legalCorpusVersion.findUnique({
      where: { id: legalCorpusVersionId },
      select: { id: true },
    });
    if (!corpus) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusVersionNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const run = await tx.legalPreparationRun.create({
          data: {
            idempotencyKey,
            legalCorpusVersionId: corpus.id,
            requestedBy: input.requestedBy,
            correlationId: input.correlationId,
            executionState: PrismaAgentExecutionState.QUEUED,
          },
        });
        const outboxEventId = await this.outboxRepository.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.legalCorpusVersion,
            aggregateId: corpus.id,
            eventType: LEGAL_PORTFOLIO_EVENT_TYPES.preparationRequested,
            correlationId: input.correlationId,
            causationId: run.id,
            actor: { id: input.requestedBy, type: AUDIT_ACTOR_TYPES.service },
            result: AGENTIC_TOOL_STATUSES.ready,
            redactionStatus: AUDIT_REDACTION_STATUSES.none,
            idempotencyKey: `${run.id}:preparation`,
            payload: {
              preparationRunId: run.id,
              legalCorpusVersionId: corpus.id,
              preparationRunRef: `legal-preparation-run:${run.id}`,
              corpusVersionRef: `corpus-version:${corpus.id}`,
            },
          }),
          tx,
        );
        await tx.legalPreparationRun.update({
          where: { id: run.id },
          data: { outboxEventId },
        });
        return toRun(run, null);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.prisma.legalPreparationRun.findUnique({
          where: { idempotencyKey },
          include: { portfolio: { select: { id: true } } },
        });
        if (raced) {
          return this.replayPreparation(
            raced,
            legalCorpusVersionId,
            input.correlationId,
          );
        }
      }
      throw error;
    }
  }

  private replayPreparation(
    existing: {
      id: string;
      legalCorpusVersionId: string;
      executionState: PrismaAgentExecutionState;
      portfolio: { id: string } | null;
    },
    legalCorpusVersionId: string,
    correlationId: string,
  ): LegalPreparationRun {
    if (existing.legalCorpusVersionId !== legalCorpusVersionId) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.idempotencyConflict,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return toRun(existing, existing.portfolio?.id ?? null);
  }
}
