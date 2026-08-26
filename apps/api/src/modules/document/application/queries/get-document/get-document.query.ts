import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";

import type { DocumentStatusDto } from "../../contracts/document/document-status.contract.js";

/**
 * Requests one document status view under the caller's RBAC scope and selected read action.
 */
export class GetDocumentQuery extends Query<DocumentStatusDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly documentRequestId: string,
    public readonly actorRole: AuthUserRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
