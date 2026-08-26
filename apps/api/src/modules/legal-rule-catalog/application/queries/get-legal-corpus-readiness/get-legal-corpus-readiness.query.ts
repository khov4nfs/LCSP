export class GetLegalCorpusReadinessQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly effectiveDate: Date,
    public readonly pinnedCorpusVersionId: string | null,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {}
}
