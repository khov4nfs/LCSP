/**
 * Carries a final-report generation request into the document command pipeline.
 */
export class RequestFinalReportCommand {
  /**
   * Creates the final-report request command.
   *
   * @param assessmentId - Assessment for which the final report should be generated.
   * @param organizationId - Organization that owns the assessment.
   * @param requestedById - User requesting report generation.
   * @param correlationId - Correlation identifier propagated to persistence, outbox, audit, and errors.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly requestedById: string,
    public readonly correlationId: string,
  ) {}
}
