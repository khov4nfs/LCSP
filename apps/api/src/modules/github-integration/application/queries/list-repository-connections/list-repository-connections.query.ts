import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

export class ListRepositoryConnectionsQuery {
  constructor(public readonly context: RbacRequestContext) {}
}
