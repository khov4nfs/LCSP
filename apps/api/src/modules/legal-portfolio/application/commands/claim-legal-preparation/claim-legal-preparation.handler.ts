import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  type LegalPreparationCorpusBundle,
} from "@lcsp/contracts/legal-portfolio";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AgentExecutionState as PrismaAgentExecutionState } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { ClaimLegalPreparationCommand } from "./claim-legal-preparation.command.js";

/**
 * Claims a run: QUEUED -> RUNNING (idempotent while RUNNING) and returns the one
 * pinned corpus the agent may read. A finished run cannot be claimed again.
 */
@CommandHandler(ClaimLegalPreparationCommand)
export class ClaimLegalPreparationHandler implements ICommandHandler<ClaimLegalPreparationCommand> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(
    input: ClaimLegalPreparationCommand,
  ): Promise<LegalPreparationCorpusBundle> {
    /**
     * Claims a run: QUEUED -> RUNNING (idempotent while RUNNING) and returns the one
     * pinned corpus the agent may read. A finished run cannot be claimed again.
     */
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
    const claimable =
      run.executionState === PrismaAgentExecutionState.QUEUED ||
      run.executionState === PrismaAgentExecutionState.RUNNING;
    if (!claimable || run.portfolio) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunConflict,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const state =
      run.executionState === PrismaAgentExecutionState.QUEUED
        ? (
            await this.prisma.legalPreparationRun.update({
              where: { id: run.id },
              data: {
                executionState: PrismaAgentExecutionState.RUNNING,
                startedAt: new Date(),
              },
            })
          ).executionState
        : run.executionState;

    const corpus = await this.prisma.legalCorpusVersion.findUniqueOrThrow({
      where: { id: run.legalCorpusVersionId },
      select: {
        id: true,
        version: true,
        documents: {
          orderBy: { documentId: "asc" },
          select: {
            documentId: true,
            title: true,
            sourceUrl: true,
            sourceSha256: true,
            sourceEffectStatus: true,
            chunks: {
              orderBy: { locator: "asc" },
              select: {
                id: true,
                locator: true,
                content: true,
                contentSha256: true,
                legalStatus: true,
                hierarchy: true,
              },
            },
          },
        },
      },
    });
    return {
      preparationRunId: run.id,
      executionState: state,
      legalCorpusVersionId: corpus.id,
      corpusVersion: corpus.version,
      documents: corpus.documents.map((document) => ({
        ...document,
        chunks: document.chunks.map(({ id, ...chunk }) => ({
          chunkId: id,
          ...chunk,
        })),
      })),
    };
  }
}
