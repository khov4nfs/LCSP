import { Query } from "@nestjs/cqrs";

import type { DocumentStatusDto } from "../../contracts/document/document-status.contract.js";

/**
 * Requests one document status view under the caller's organization, PBAC scope, and selected read action.
 */
export class GetDocumentQuery extends Query<DocumentStatusDto> {
  /**
   * Creates the document lookup query.
   *
   * @param assessmentId - Assessment that must own the document request.
   * @param documentRequestId - Document request identifier to retrieve.
   * @param organizationId - Organization boundary for the lookup.
   * @param scope - PBAC resource scope used for redacted developer reads.
   * @param selectedAction - PBAC action selected by the authorization guard.
   * @param correlationId - Correlation identifier propagated to authorization and lookup errors.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly documentRequestId: string,
    public readonly organizationId: string,
    public readonly scope: string | null,
    public readonly selectedAction: string | null,
    public readonly correlationId: string,
  ) {
    super();
  }
}
