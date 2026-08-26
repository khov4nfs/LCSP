/**
 * Requests the persisted JSON artifact for one audit export.
 */
export class GetAuditExportArtifactQuery {
  /**
   * Creates the artifact lookup query.
   *
   * @param exportRequestId - Audit export request identifier to retrieve.
   * @param correlationId - Correlation identifier propagated to lookup errors.
   */
  constructor(
    public readonly exportRequestId: string,
    public readonly correlationId: string,
  ) {}
}
