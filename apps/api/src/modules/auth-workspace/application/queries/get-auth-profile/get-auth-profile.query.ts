import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";

export class GetAuthProfileQuery {
  constructor(
    public readonly context: RbacRequestContext,
    public readonly correlationId: string,
  ) {}
}
