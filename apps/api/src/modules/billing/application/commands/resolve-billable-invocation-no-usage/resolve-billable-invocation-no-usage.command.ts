import type { ReconciliationNoUsageResolutionRequest } from "@lcsp/contracts/billing";

/**
 * Command for administrative reconciliation of an unknown/disputed admission to CONFIRMED_NO_USAGE.
 */
export class ResolveBillableInvocationNoUsageCommand {
  constructor(
    public readonly payload: ReconciliationNoUsageResolutionRequest,
    public readonly correlationId?: string,
  ) {}
}
