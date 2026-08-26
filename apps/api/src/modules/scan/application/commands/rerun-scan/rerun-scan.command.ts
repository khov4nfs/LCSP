import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

/**
 * Carries a manual scan-rerun request together with RBAC, idempotency, and optional business-reason context.
 */
export class RerunScanCommand {
  /**
   * Creates the scan-rerun command.
   *
   * @param assessmentId - Assessment whose repository snapshot should be rescanned.
   * @param snapshotId - Pinned repository snapshot to scan again.
   * @param idempotencyKey - Caller-provided key used to deduplicate rerun requests.
   * @param rbacContext - Authorized subject and organization context.
   * @param correlationId - Correlation identifier propagated to persistence, outbox, audit, and errors.
   * @param reason - Optional business reason for requesting the rerun.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly snapshotId: string,
    public readonly idempotencyKey: string,
    public readonly rbacContext: RbacRequestContext,
    public readonly correlationId: string,
    public readonly reason?: string,
  ) {}
}
