import type { SearchEvidenceConfidence } from "../../contracts/evidence/search-evidence.contract.js";

export class SearchEvidenceQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly maxResults: number,
    public readonly correlationId: string,
    public readonly findingKinds: string[] = [],
    public readonly providers: string[] = [],
    public readonly pathPrefixes: string[] = [],
    public readonly minConfidence:
      SearchEvidenceConfidence | undefined = undefined,
  ) {}
}
