import type { HumanReviewKind } from "../../contracts/evidence/human-review-path.contract.js";
export class InspectHumanReviewPathQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly startNodeId: string,
    public readonly reviewKinds: HumanReviewKind[],
    public readonly maxHops: number,
    public readonly correlationId: string,
  ) {}
}
