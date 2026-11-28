import type { BillableInvocationCancelRequest } from "@lcsp/contracts/billing";

/**
 * Command for worker cancellation of an unconsumed admission (ADMITTED state).
 */
export class CancelBillableInvocationAdmissionCommand {
  constructor(
    public readonly payload: BillableInvocationCancelRequest,
    public readonly correlationId?: string,
  ) {}
}
