import type { DecisionActionCategory } from "../../contracts/evidence/decision-path.contract.js";
export class InspectDecisionPathQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly startNodeId: string,
    public readonly actionCategories: DecisionActionCategory[],
    public readonly maxHops: number,
    public readonly maxResults: number,
    public readonly correlationId: string,
  ) {}
}
