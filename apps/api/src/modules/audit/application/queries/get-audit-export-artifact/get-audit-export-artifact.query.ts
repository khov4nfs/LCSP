/**
 * Requests the persisted JSON artifact for one organization-scoped audit export.
 */
export class GetAuditExportArtifactQuery {
  /**
   * Creates the artifact lookup query.
   *
   * @param organizationId - Organization that must own the export request.
   * @param exportRequestId - Audit export request identifier to retrieve.
   * @param correlationId - Correlation identifier propagated to lookup errors.
   */
  constructor(
    public readonly organizationId: string,
    public readonly exportRequestId: string,
    public readonly correlationId: string,
  ) {}
}
