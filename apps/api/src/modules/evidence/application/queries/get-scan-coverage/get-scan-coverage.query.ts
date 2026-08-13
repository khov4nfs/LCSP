import type { ScanCoverageDisposition } from "../../contracts/evidence/scan-coverage.contract.js";

export class GetScanCoverageQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly maxResults: number,
    public readonly correlationId: string,
    public readonly pathPrefixes: string[] = [],
    public readonly languages: string[] = [],
    public readonly dispositions: ScanCoverageDisposition[] = [],
    public readonly toolNames: string[] = [],
    public readonly cursor: string | null = null,
  ) {}
}
