/**
 * Carries an audit-export request into the command pipeline.
 */
export class ExportAuditTrailCommand {
  /**
   * Creates an audit-trail export command.
   *
   * @param requestedById - User requesting the export.
   * @param fromDate - Inclusive export range start supplied by the caller.
   * @param toDate - Inclusive export range end supplied by the caller.
   * @param correlationId - Correlation identifier propagated to errors, persistence, and audit metadata.
   */
  constructor(
    public readonly requestedById: string,
    public readonly fromDate: string,
    public readonly toDate: string,
    public readonly correlationId: string,
  ) {}
}
