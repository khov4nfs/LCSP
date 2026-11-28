/**
 * Rationale ("Why"): Encapsulates intent to compensate a settled billable invocation debit.
 * Mechanism ("How"): Transports validated request payload, authenticated RBAC context, and correlationId.
 * Invariants & Constraints: Actor must hold admin role and billing:debit:compensate action permission.
 */

import type { CompensateBillingDebitRequest } from "@lcsp/contracts/billing";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

export class CompensateBillingDebitCommand {
  constructor(
    public readonly payload: CompensateBillingDebitRequest,
    public readonly rbacContext: RbacRequestContext,
    public readonly correlationId: string,
  ) {}
}
