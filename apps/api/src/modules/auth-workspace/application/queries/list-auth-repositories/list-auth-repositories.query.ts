import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.ts";

export class ListAuthRepositoriesQuery {
  constructor(public readonly context: RbacRequestContext) {}
}
