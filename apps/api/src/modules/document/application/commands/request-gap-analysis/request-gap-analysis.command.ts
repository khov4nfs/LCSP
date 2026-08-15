/**
 * Carries a gap-analysis document generation request into the command pipeline.
 */
export class RequestGapAnalysisCommand {
  /**
   * Creates the gap-analysis request command.
   *
   * @param assessmentId - Assessment for which the gap-analysis document should be generated.
   * @param organizationId - Organization that owns the assessment.
   * @param requestedById - User requesting document generation.
   * @param correlationId - Correlation identifier propagated to persistence, outbox, audit, and errors.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly requestedById: string,
    public readonly correlationId: string,
  ) {}
}
