import type { BillableInvocationSettlementRequest } from "@lcsp/contracts/billing";

/**
 * Command for settling physical LLM invocation usage in Phase C (SHADOW mode).
 */
export class SettleBillableInvocationUsageCommand {
  constructor(
    public readonly payload: BillableInvocationSettlementRequest,
    public readonly correlationId?: string,
  ) {}
}
