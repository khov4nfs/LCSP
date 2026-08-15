/**
 * Carries an organization-scoped audit-export request into the command pipeline.
 */
export class ExportAuditTrailCommand {
  /**
   * Creates an audit-trail export command.
   *
   * @param organizationId - Organization whose audit events should be exported.
   * @param sessionOrganizationId - Organization from the authenticated session used to enforce tenant scope.
   * @param requestedById - User requesting the export.
   * @param fromDate - Inclusive export range start supplied by the caller.
   * @param toDate - Inclusive export range end supplied by the caller.
   * @param correlationId - Correlation identifier propagated to errors, persistence, and audit metadata.
   */
  constructor(
    public readonly organizationId: string,
    public readonly sessionOrganizationId: string,
    public readonly requestedById: string,
    public readonly fromDate: string,
    public readonly toDate: string,
    public readonly correlationId: string,
  ) {}
}
