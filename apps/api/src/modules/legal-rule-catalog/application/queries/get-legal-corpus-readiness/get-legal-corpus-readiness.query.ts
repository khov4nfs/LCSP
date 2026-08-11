export class GetLegalCorpusReadinessQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly effectiveDate: Date,
    public readonly pinnedCorpusVersionId: string | null,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
