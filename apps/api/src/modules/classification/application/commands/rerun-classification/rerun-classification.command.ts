import { AUDIT_ACTOR_TYPES, type AuditActorType } from "@lcsp/contracts/audit";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

export class RerunClassificationCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly rbacContext: RbacRequestContext,
    public readonly correlationId: string,
    public readonly reason?: string,
    public readonly actorType: AuditActorType = AUDIT_ACTOR_TYPES.user,
    /** The customer stopped the previous dispatch: its recent outbox row no
     *  longer means "already running", so it must not swallow this rerun. */
    public readonly afterCustomerStop = false,
  ) {}
}
