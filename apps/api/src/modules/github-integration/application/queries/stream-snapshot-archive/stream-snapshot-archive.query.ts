/**
 * Requests a repository snapshot archive stream bound to one scan job.
 */
export class StreamSnapshotArchiveQuery {
  /**
   * Creates the snapshot archive query.
   *
   * @param snapshotId - Repository snapshot whose immutable archive should be streamed.
   * @param scanJobId - Scan job authorized to consume the snapshot archive.
   * @param correlationId - Correlation identifier propagated to lookup and streaming errors.
   */
  constructor(
    public readonly snapshotId: string,
    public readonly scanJobId: string,
    public readonly correlationId: string,
  ) {}
}
