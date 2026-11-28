import type { ReconciliationNoUsageResolutionRequest } from "@lcsp/contracts/billing";

/**
 * Command for administrative reconciliation of an unknown/disputed admission to CONFIRMED_NO_USAGE.
 */
export class ResolveBillableInvocationNoUsageCommand {
  constructor(
    public readonly payload: ReconciliationNoUsageResolutionRequest,
    public readonly correlationId: string,
    // Why: A no-usage decision releases financial exposure and must identify its human author.
    // How: Carry the authenticated RBAC principal into the transactional audit write.
    // Invariant: Never persist a generic role label in resolvedBy for an Admin decision.
    public readonly actorId: string,
  ) {}
}
