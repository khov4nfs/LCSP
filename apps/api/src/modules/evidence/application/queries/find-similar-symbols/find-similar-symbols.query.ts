import type { SymbolSimilarityDimension } from "../../contracts/evidence/similar-symbols.contract.js";
export class FindSimilarSymbolsQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly seedNodeId: string,
    public readonly dimensions: SymbolSimilarityDimension[],
    public readonly maxResults: number,
    public readonly correlationId: string,
  ) {}
}
