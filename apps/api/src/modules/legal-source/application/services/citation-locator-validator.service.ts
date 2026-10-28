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

  /**
   * Business purpose: Ensure every submitted legal citation points to a locator in the currently active source version.
   *
   * Business rules:
   * - At least one complete citation is required, and each referenced source version must be ACTIVE.
   * - The document identifier and locator must match a stored chunk in that exact version.
   * - A chunk recorded as REPEALED cannot support a citation.
   *
   * Execution flow:
   * 1. Reject an empty reference list or any reference missing its version, document, or locator.
   * 2. For each reference, verify the active version and then locate the exact stored chunk.
   * 3. Reject repealed chunks; return only after every reference passes.
   *
   * Failure cases:
   * - Invalid, inactive, missing, or unresolved citations raise `citationUnresolved` with HTTP 422.
   * - Repealed citations raise `citationRepealed` with HTTP 422.
   *
   * Side effects:
   * - None beyond read-only Prisma lookups; the method does not modify citation or source state.
   */
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
        select: { legalEffectStatus: true },
      });

      if (!chunk) {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.citationUnresolved,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      if (chunk.legalEffectStatus === "REPEALED") {
        throw problemException(
          LEGAL_SOURCE_ERROR_CODES.citationRepealed,
          "citation-locator-validation",
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
    }
  }
}
