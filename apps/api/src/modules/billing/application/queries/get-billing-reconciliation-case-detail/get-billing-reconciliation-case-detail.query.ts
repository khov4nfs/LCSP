/**
 * Rationale ("Why"): Query to inspect detailed BillingReconciliationCase state and linked evidence.
 * Mechanism ("How"): Encapsulates caseId parameter for CQRS QueryBus.
 * Invariants & Constraints: caseId must be a non-empty string.
 */
export class GetBillingReconciliationCaseDetailQuery {
  constructor(public readonly caseId: string) {}
}
