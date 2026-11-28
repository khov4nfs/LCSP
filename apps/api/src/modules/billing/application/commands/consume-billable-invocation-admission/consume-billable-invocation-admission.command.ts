import type { BillableInvocationAdmissionConsume } from "@lcsp/contracts/billing";

/**
 * Command to execute atomic CAS consume on a billable invocation admission before provider dispatch.
 */
export class ConsumeBillableInvocationAdmissionCommand {
  constructor(
    public readonly payload: BillableInvocationAdmissionConsume,
    public readonly correlationId?: string,
  ) {}
}
