import type { RepositoryScanTriggerSource } from "@lcsp/contracts/github-integration";
import type { AuthUserRole } from "@lcsp/contracts/auth";

/**
 * Carries snapshot, trigger provenance, idempotency, and optional authenticated RBAC context into scan-job creation.
 */
export class TriggerScanCommand {
  /**
   * Creates a repository scan trigger command.
   *
   * @param assessmentId - Assessment that owns the snapshot and resulting scan job.
   * @param snapshotId - Immutable repository snapshot to scan.
   * @param triggerSource - Source describing whether the scan was trusted, manual, or otherwise initiated.
   * @param idempotencyKey - Key used to deduplicate equivalent scan-trigger requests.
   * @param actorId - Authenticated actor identifier, or null for trusted system-triggered work.
   * @param subjectRole - RBAC subject role when the trigger originated from a user request.
   * @param scope - Optional RBAC assessment scope from the request context.
   * @param correlationId - Correlation identifier propagated to persistence, audit, outbox, and errors.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly snapshotId: string,
    public readonly triggerSource: RepositoryScanTriggerSource,
    public readonly idempotencyKey: string,
    public readonly actorId: string | null,
    public readonly subjectRole: AuthUserRole | null,
    public readonly scope: string | undefined,
    public readonly correlationId: string,
  ) {}
}
