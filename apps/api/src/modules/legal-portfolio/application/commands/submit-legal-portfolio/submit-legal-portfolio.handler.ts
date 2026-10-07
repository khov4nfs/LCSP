import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  type LegalPortfolioSubmitResult,
} from "@lcsp/contracts/legal-portfolio";
import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { LegalCorpusSnapshotLoader } from "../../../infrastructure/persistence/legal-corpus-snapshot.service.js";
import {
  LegalPortfolioActivation,
  type SubmitContext,
} from "../../../infrastructure/persistence/legal-portfolio-activation.service.js";
import {
  canonicalJson,
  sha256Hex,
  sourceClaimKey,
  validateLegalPortfolioPacket,
} from "../../../domain/legal-portfolio-integrity.validator.js";
import { isRetryable } from "../../../infrastructure/persistence/legal-portfolio.mappers.js";
import { SubmitLegalPortfolioCommand } from "./submit-legal-portfolio.command.js";

const MAX_TRANSACTION_ATTEMPTS = 4;

/** The one submit -> integrity validate -> atomic activate boundary. */
@CommandHandler(SubmitLegalPortfolioCommand)
export class SubmitLegalPortfolioHandler implements ICommandHandler<SubmitLegalPortfolioCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly corpus: LegalCorpusSnapshotLoader,
    private readonly activation: LegalPortfolioActivation,
  ) {}

  async execute(
    input: SubmitLegalPortfolioCommand,
  ): Promise<LegalPortfolioSubmitResult> {
    /** The one submit -> integrity validate -> atomic activate boundary. */
    const request = input.request;
    const requestDigest = sha256Hex(canonicalJson(request.packet));

    const run = await this.prisma.legalPreparationRun.findUnique({
      where: { id: request.preparationRunId },
      include: { corpusVersion: { select: { id: true, version: true } } },
    });
    if (!run) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    // Cheap replay before any validation work; re-checked inside the lock.
    const replay = await this.activation.findReplay(
      this.prisma,
      request.idempotencyKey,
      run.id,
      requestDigest,
      input.correlationId,
    );
    if (replay) return replay;

    const corpus = await this.corpus.load(run.corpusVersion.id, request.packet);
    const validation = validateLegalPortfolioPacket(
      request.packet,
      corpus.snapshot,
      (claim) =>
        corpus.foreignHashes.has(
          `${sourceClaimKey(claim)}|${claim.contentSha256}`,
        ),
    );

    const context: SubmitContext = {
      runId: run.id,
      idempotencyKey: request.idempotencyKey,
      requestDigest,
      portfolioDigest: requestDigest,
      packet: request.packet,
      failures: validation.failures,
      resolved: validation.resolved,
      corpus: run.corpusVersion,
      correlationId: input.correlationId,
    };

    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.activation.commit(tx, context, input.actorId),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_TRANSACTION_ATTEMPTS)
          throw error;
      }
    }
  }
}
