import { HttpStatus, Injectable } from "@nestjs/common";
import {
  LEGAL_SOURCE_ERROR_CODES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-source";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { toPrismaLegalSourceLifecycleStatus } from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
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
        LEGAL_SOURCE_ERROR_CODES.citationUnresolved,
        "citation-locator-validation",
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    for (const ref of refs) {
      if (!ref.legalSourceVersionId || !ref.documentId || !ref.locator) {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.citationUnresolved,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      const legalSource = await this.prisma.legalSourceVersion.findFirst({
        where: {
          id: ref.legalSourceVersionId,
          status: toPrismaLegalSourceLifecycleStatus(
            LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
          ),
        },
        select: { id: true },
      });
      if (!legalSource) {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.citationUnresolved,
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
          LEGAL_SOURCE_ERROR_CODES.citationUnresolved,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      if (chunk.legalStatus === "REPEALED") {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.citationRepealed,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
    }
  }
}
