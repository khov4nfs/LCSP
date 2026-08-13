import type { ReconciliationContextStatus } from "../../contracts/reconciliation/reconciliation-context.contract.js";

export class GetReconciliationContextQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly correlationId: string,
    public readonly aiUsageFlowId: string | null,
    public readonly conflictIds: string[] = [],
    public readonly cursor: string | null = null,
    public readonly maxResults: number,
    public readonly statuses: ReconciliationContextStatus[] = [],
  ) {}
}
