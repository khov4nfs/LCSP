import type { RbacContext } from "../../../../../platform/rbac/interfaces/rbac-context.interface.ts";

export class GetOAuthIdentitiesQuery {
  constructor(
    public readonly context: RbacContext,
    public readonly correlationId?: string,
  ) {}
}
