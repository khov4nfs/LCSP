import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

export class RerunClassificationCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly rbacContext: RbacRequestContext,
    public readonly correlationId: string,
    public readonly reason?: string,
  ) {}
}
