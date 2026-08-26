import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";

import type { ConflictListDto } from "../../contracts/reconciliation/conflict-list.contract.js";

export class ListConflictsQuery extends Query<ConflictListDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly page: number | undefined,
    public readonly pageSize: number | undefined,
    public readonly status: string | undefined,
    public readonly correlationId: string,
  ) {
    super();
  }
}
