import { HttpStatus, Injectable } from "@nestjs/common";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
export interface CitationLocatorRef {
  legalSourceVersionId: string;
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
      if (!ref.legalSourceVersionId || !ref.documentId || !ref.locator) {
        throw problemException(
          LEGAL_RULE_ERROR_CODES.citationUnresolved,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      const corpus = await this.prisma.legalSourceVersion.findFirst({
        where: {
          id: ref.legalSourceVersionId,
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
          legalSourceVersionId: ref.legalSourceVersionId,
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
