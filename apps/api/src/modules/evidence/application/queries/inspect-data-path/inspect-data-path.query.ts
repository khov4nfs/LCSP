import type {
  DataCategory,
  DataPathDirection,
} from "../../contracts/evidence/data-path.contract.js";
export class InspectDataPathQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly startNodeId: string,
    public readonly direction: DataPathDirection,
    public readonly dataCategories: DataCategory[],
    public readonly maxHops: number,
    public readonly maxResults: number,
    public readonly correlationId: string,
  ) {}
}
