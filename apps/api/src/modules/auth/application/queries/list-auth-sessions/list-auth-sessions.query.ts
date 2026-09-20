import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";

export class ListAuthSessionsQuery {
  constructor(public readonly context: RbacRequestContext) {}
}
