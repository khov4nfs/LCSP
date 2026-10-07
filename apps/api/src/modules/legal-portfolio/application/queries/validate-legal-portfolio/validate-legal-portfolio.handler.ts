import {
  LEGAL_PORTFOLIO_ERROR_CODES,
  LEGAL_PORTFOLIO_VALIDATION_OUTCOMES,
  type LegalPortfolioValidateResult,
} from "@lcsp/contracts/legal-portfolio";
import { HttpStatus } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { LegalCorpusSnapshotLoader } from "../../../infrastructure/persistence/legal-corpus-snapshot.service.js";
import {
  sourceClaimKey,
  validateLegalPortfolioPacket,
} from "../../../domain/legal-portfolio-integrity.validator.js";
import { ValidateLegalPortfolioQuery } from "./validate-legal-portfolio.query.js";

/** Dry-run of the submit validation: reads only, never persists. */
@QueryHandler(ValidateLegalPortfolioQuery)
export class ValidateLegalPortfolioHandler implements IQueryHandler<ValidateLegalPortfolioQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly corpus: LegalCorpusSnapshotLoader,
  ) {}

  async execute(
    input: ValidateLegalPortfolioQuery,
  ): Promise<LegalPortfolioValidateResult> {
    /** Dry-run of the submit validation: reads only, never persists. */
    const run = await this.prisma.legalPreparationRun.findUnique({
      where: { id: input.request.preparationRunId },
      select: { legalCorpusVersionId: true },
    });
    if (!run) {
      throw problemException(
        LEGAL_PORTFOLIO_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const corpus = await this.corpus.load(
      run.legalCorpusVersionId,
      input.request.packet,
    );
    const { failures } = validateLegalPortfolioPacket(
      input.request.packet,
      corpus.snapshot,
      (claim) =>
        corpus.foreignHashes.has(
          `${sourceClaimKey(claim)}|${claim.contentSha256}`,
        ),
    );
    return {
      outcome:
        failures.length === 0
          ? LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.PASSED
          : LEGAL_PORTFOLIO_VALIDATION_OUTCOMES.FAILED,
      failures,
    };
  }
}
