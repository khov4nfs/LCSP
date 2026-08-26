import type { AuthUserRole } from "@lcsp/contracts/auth";

/**
 * Carries repository-connection and Git reference input required to pin an immutable assessment snapshot.
 */
export class PinSnapshotCommand {
  /**
   * Creates a repository snapshot pinning command.
   *
   * @param assessmentId - Assessment that will own the pinned snapshot.
   * @param actorId - Authenticated user requesting the snapshot.
   * @param subjectRole - RBAC subject role used for ownership/scope enforcement.
   * @param scope - Optional RBAC assessment scope from the request context.
   * @param connectionId - Repository connection from which the snapshot should be resolved.
   * @param branch - Optional branch name to resolve when an explicit commit/ref is not supplied.
   * @param ref - Optional Git ref to resolve.
   * @param commitSha - Optional explicit commit SHA to pin.
   * @param correlationId - Correlation identifier propagated to validation, audit, and response metadata.
   */
  constructor(
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly scope: string | undefined,
    public readonly connectionId: string,
    public readonly branch: string | undefined,
    public readonly ref: string | undefined,
    public readonly commitSha: string | undefined,
    public readonly correlationId: string,
  ) {}
}
