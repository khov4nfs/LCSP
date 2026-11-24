import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";

export class GetOAuthIdentitiesQuery {
  constructor(
    public readonly context: RbacRequestContext,
    public readonly correlationId?: string,
  ) {}
}
