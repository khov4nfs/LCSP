import type { FindingDetailInclude } from "../../contracts/evidence/finding-detail.contract.js";

export class GetFindingDetailQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly findingId: string,
    public readonly include: FindingDetailInclude[],
    public readonly correlationId: string,
  ) {}
}
