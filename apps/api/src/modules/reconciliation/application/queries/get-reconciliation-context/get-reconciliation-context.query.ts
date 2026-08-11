import type { ReconciliationContextStatus } from "../../contracts/reconciliation/reconciliation-context.contract.js";

export class GetReconciliationContextQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly correlationId: string,
    public readonly aiUsageFlowId: string,
    public readonly maxResults: number,
    public readonly statuses: ReconciliationContextStatus[] = [],
  ) {}
}
