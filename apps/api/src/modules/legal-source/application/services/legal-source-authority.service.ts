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
    if (!(await this.isVersionAdmitted(tx, legalSourceVersionId))) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.legalSourceIngestInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
  }

  /**
   * Business purpose: Let callers defer new work when the pinned corpus is ineligible.
   * Business rules:
   * - Every document must match an approved managed original.
   * Execution flow:
   * 1. Read the exact version's document identities and match the complete corpus to official pins.
   * Failure cases:
   * - Missing or inconsistent originals return false; persistence failures propagate.
   * Side effects:
   * - Reads the legal source in the caller's transaction.
   */
  async isVersionAdmitted(
    tx: Prisma.TransactionClient,
    legalSourceVersionId: string,
  ): Promise<boolean> {
    const documents = await tx.legalSourceDocument.findMany({
      where: { legalSourceVersionId },
      select: {
        sourceUrl: true,
        sourceSha256: true,
        blobSha256: true,
      },
    });
    // The blob FK is server-owned and immutable. Never admit a source on its asserted URL alone.
    return isOfficialCorpusAdmitted(documents);
  }
}
