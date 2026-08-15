import type { RepositoryScanTriggerSource } from "@lcsp/contracts/github-integration";
import type { SubjectRole } from "@lcsp/contracts/pbac";

/**
 * Carries snapshot, trigger provenance, idempotency, and optional authenticated PBAC context into scan-job creation.
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
   * @param organizationId - Organization context, or null when it must be derived from trusted snapshot state.
   * @param subjectRole - PBAC subject role when the trigger originated from a user request.
   * @param scope - Optional PBAC assessment scope for non-manager callers.
   * @param correlationId - Correlation identifier propagated to persistence, audit, outbox, and errors.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly snapshotId: string,
    public readonly triggerSource: RepositoryScanTriggerSource,
    public readonly idempotencyKey: string,
    public readonly actorId: string | null,
    public readonly organizationId: string | null,
    public readonly subjectRole: SubjectRole | null,
    public readonly scope: string | undefined,
    public readonly correlationId: string,
  ) {}
}
