import type { BillableInvocationHeartbeatRequest } from "@lcsp/contracts/billing";

/**
 * Command to renew or extend the in-flight execution lease of an active billable invocation.
 */
export class HeartbeatBillableInvocationAdmissionCommand {
  constructor(
    public readonly payload: BillableInvocationHeartbeatRequest,
    public readonly correlationId?: string,
  ) {}
}
