export class GetScanCoverageQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly evidenceReportId: string,
    public readonly maxResults: number,
    public readonly correlationId: string,
  ) {}
}
