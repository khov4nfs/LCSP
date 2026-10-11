import {
  COMPLIANCE_RULE_SET_ERROR_CODES,
  COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES,
  type ComplianceRuleSetValidateResult,
} from "@lcsp/contracts/compliance-rule-set";
import { HttpStatus } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { LegalCorpusSnapshotLoader } from "../../../infrastructure/persistence/legal-corpus-snapshot.service.js";
import {
  sourceClaimKey,
  validateComplianceRuleSetPacket,
} from "../../../domain/compliance-rule-set-integrity.validator.js";
import { ValidateComplianceRuleSetQuery } from "./validate-compliance-rule-set.query.js";

/** Dry-run of the submit validation: reads only, never persists. */
@QueryHandler(ValidateComplianceRuleSetQuery)
export class ValidateComplianceRuleSetHandler implements IQueryHandler<ValidateComplianceRuleSetQuery> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly corpus: LegalCorpusSnapshotLoader,
  ) {}

  async execute(
    input: ValidateComplianceRuleSetQuery,
  ): Promise<ComplianceRuleSetValidateResult> {
    /** Dry-run of the submit validation: reads only, never persists. */
    const run = await this.prisma.ruleSetPreparationRun.findUnique({
      where: { id: input.request.preparationRunId },
      select: { legalSourceVersionId: true },
    });
    if (!run) {
      throw problemException(
        COMPLIANCE_RULE_SET_ERROR_CODES.preparationRunNotFound,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    const corpus = await this.corpus.load(
      run.legalSourceVersionId,
      input.request.packet,
    );
    const { failures } = validateComplianceRuleSetPacket(
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
          ? COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.PASSED
          : COMPLIANCE_RULE_SET_VALIDATION_OUTCOMES.FAILED,
      failures,
    };
  }
}
