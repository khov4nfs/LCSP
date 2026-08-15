import type { PbacRequestContext } from "../../../../../platform/pbac/interfaces/pbac-request.interface.js";

/**
 * Carries a manual scan-rerun request together with PBAC, idempotency, and optional business-reason context.
 */
export class RerunScanCommand {
  /**
   * Creates the scan-rerun command.
   *
   * @param assessmentId - Assessment whose repository snapshot should be rescanned.
   * @param snapshotId - Pinned repository snapshot to scan again.
   * @param idempotencyKey - Caller-provided key used to deduplicate rerun requests.
   * @param pbacContext - Authorized subject and organization context.
   * @param correlationId - Correlation identifier propagated to persistence, outbox, audit, and errors.
   * @param reason - Optional business reason for requesting the rerun.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly snapshotId: string,
    public readonly idempotencyKey: string,
    public readonly pbacContext: PbacRequestContext,
    public readonly correlationId: string,
    public readonly reason?: string,
  ) {}
}
