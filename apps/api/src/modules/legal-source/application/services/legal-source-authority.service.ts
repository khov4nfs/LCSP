import { HttpStatus, Injectable } from "@nestjs/common";
import { LEGAL_SOURCE_ERROR_CODES } from "@lcsp/contracts/legal-source";
import type { Prisma } from "@prisma/client";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { isOfficialCorpusAdmitted } from "../../domain/official-legal-authority.js";

@Injectable()
export class LegalSourceAuthorityService {
  /**
   * Business purpose: Prevent new legal authoring and publication from using a corpus outside the product-approved original documents.
   * Business rules:
   * - Every document must bind the immutable managed original's digest to an approved corpus identity; a URL or caller-supplied digest without stored original bytes is insufficient.
   * - An older upload of the exact approved original remains eligible; a different known publication URL cannot be paired with that original.
   * - Existing historical reads and replay responses do not invoke this admission gate.
   * Execution flow:
   * 1. Read document identities for the exact pinned source version through the caller's transaction.
   * 2. Reject an empty corpus or any document with missing, unknown or inconsistent original identity.
   * Failure cases:
   * - Missing managed original or inconsistent corpus identity returns the canonical legal-source ingest problem and prevents the caller's authoring or publication transaction from proceeding.
   * Side effects:
   * - Read-only database query; no source mutation, network call or paid model invocation.
   */
  async requireVersion(
    tx: Prisma.TransactionClient,
    legalSourceVersionId: string,
    correlationId: string,
  ): Promise<void> {
    const documents = await tx.legalSourceDocument.findMany({
      where: { legalSourceVersionId },
      select: {
        documentId: true,
        sourceUrl: true,
        sourceSha256: true,
        blobSha256: true,
      },
    });
    // The blob FK is server-owned and immutable. Never admit a source on its asserted URL alone.
    if (!isOfficialCorpusAdmitted(documents)) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
  }
}
