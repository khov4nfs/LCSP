import type { SymbolContextInclude } from "../../contracts/evidence/symbol-context.contract.js";
export class GetSymbolContextQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly symbolNodeId: string,
    public readonly include: SymbolContextInclude[],
    public readonly maxNeighbors: number,
    public readonly correlationId: string,
  ) {}
}
