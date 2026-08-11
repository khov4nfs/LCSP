import { HttpStatus, Injectable } from "@nestjs/common";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
export interface CitationLocatorRef {
  legalCorpusVersionId: string;
  documentId: string;
  locator: string;
}

@Injectable()
export class CitationLocatorValidatorService {
  constructor(private readonly prisma: PrismaService) {}

  async validateAll(refs: CitationLocatorRef[]): Promise<void> {
    if (!Array.isArray(refs) || refs.length === 0) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.citationUnresolved,
        "citation-locator-validation",
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    for (const ref of refs) {
      if (!ref.legalCorpusVersionId || !ref.documentId || !ref.locator) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.citationUnresolved,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      const corpus = await this.prisma.legalCorpusVersion.findFirst({
        where: {
          id: ref.legalCorpusVersionId,
          status: toPrismaLegalRuleLifecycleStatus(
            LEGAL_RULE_LIFECYCLE_STATUSES.approved,
          ),
        },
        select: { id: true },
      });
      if (!corpus) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.citationUnresolved,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      const chunk = await this.prisma.legalDocumentChunk.findFirst({
        where: {
          legalCorpusVersionId: ref.legalCorpusVersionId,
          documentId: ref.documentId,
          locator: ref.locator,
        },
      });

      if (!chunk) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.citationUnresolved,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      if (chunk.legalStatus === "REPEALED") {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.citationRepealed,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
    }
  }
}
