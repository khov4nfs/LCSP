import type { BillableInvocationAdmissionRequest } from "@lcsp/contracts/billing";

/**
 * Command to request server-issued admission for a billable model invocation.
 */
export class RequestBillableInvocationAdmissionCommand {
  constructor(
    public readonly payload: BillableInvocationAdmissionRequest,
    public readonly correlationId?: string,
  ) {}
}
