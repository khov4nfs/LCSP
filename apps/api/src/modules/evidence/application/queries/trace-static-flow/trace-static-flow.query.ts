import type { StaticFlowDirection } from "../../contracts/evidence/static-flow.contract.js";
export class TraceStaticFlowQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly startNodeId: string,
    public readonly direction: StaticFlowDirection,
    public readonly maxHops: number,
    public readonly correlationId: string,
    public readonly desiredStages: string[] = [],
  ) {}
}
