import type { BillingAdminReconciliationCaseListQuery } from "@lcsp/contracts/billing";

/**
 * Rationale ("Why"): Query to list and filter BillingReconciliationCase records for Admin queue.
 * Mechanism ("How"): Encapsulates validated query parameters for CQRS QueryBus.
 * Invariants & Constraints: Page >= 1, pageSize bounded.
 */
export class ListBillingReconciliationCasesQuery {
  constructor(public readonly query: BillingAdminReconciliationCaseListQuery) {}
}
