/**
 * Requests status and download metadata for one organization-scoped audit export.
 */
export class GetAuditExportQuery {
  /**
   * Creates the audit-export status query.
   *
   * @param organizationId - Organization whose export is requested.
   * @param sessionOrganizationId - Organization from the authenticated session used for tenant-scope validation.
   * @param exportRequestId - Audit export request identifier to inspect.
   * @param correlationId - Correlation identifier propagated to lookup and scope errors.
   */
  constructor(
    public readonly organizationId: string,
    public readonly sessionOrganizationId: string,
    public readonly exportRequestId: string,
    public readonly correlationId: string,
  ) {}
}
