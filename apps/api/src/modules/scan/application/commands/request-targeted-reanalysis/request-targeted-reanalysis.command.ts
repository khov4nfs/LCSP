import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";
import type { RequestTargetedReanalysisInput } from "../../contracts/scan/targeted-reanalysis.contract.js";

/**
 * Carries a bounded targeted-reanalysis request together with the caller's RBAC and correlation context.
 */
export class RequestTargetedReanalysisCommand {
  /**
   * Creates the targeted-reanalysis command.
   *
   * @param input - Requested evidence artifact, analyzer, bounded scope, requirement reason, and idempotency key.
   * @param rbacContext - Authorized subject/organization context used for ownership, audit, and outbox provenance.
   * @param correlationId - Correlation identifier propagated through request lifecycle state.
   */
  constructor(
    public readonly input: RequestTargetedReanalysisInput,
    public readonly rbacContext: RbacRequestContext,
    public readonly correlationId: string,
  ) {}
}
