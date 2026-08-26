/**
 * Requests status and download metadata for one audit export.
 */
export class GetAuditExportQuery {
  /**
   * Creates the audit-export status query.
   *
   * @param exportRequestId - Audit export request identifier to inspect.
   * @param correlationId - Correlation identifier propagated to lookup and scope errors.
   */
  constructor(
    public readonly exportRequestId: string,
    public readonly correlationId: string,
  ) {}
}
