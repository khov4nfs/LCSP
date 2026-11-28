import type { ReconciliationCaseDecisionRequest } from "@lcsp/contracts/billing";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

/**
 * Rationale ("Why"): Command to execute an audited Admin decision on a BillingReconciliationCase.
 * Mechanism ("How"): Encapsulates caseId, validated payload, caller rbacContext, and correlationId.
 * Invariants & Constraints: Caller must be an authorized admin with billing:reconciliation:decision.
 */
export class DecideBillingReconciliationCaseCommand {
  constructor(
    public readonly caseId: string,
    public readonly payload: ReconciliationCaseDecisionRequest,
    public readonly rbacContext: RbacRequestContext,
    public readonly correlationId: string,
  ) {}
}
