import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";

/**
 * Requests all document status views visible to the caller for one assessment.
 */
export class ListDocumentsQuery extends Query<unknown[]> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorRole: AuthUserRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
