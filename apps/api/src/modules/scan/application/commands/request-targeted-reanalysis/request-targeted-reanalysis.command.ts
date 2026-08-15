import type { PbacRequestContext } from "../../../../../platform/pbac/interfaces/pbac-request.interface.js";
import type { RequestTargetedReanalysisInput } from "../../contracts/scan/targeted-reanalysis.contract.js";

/**
 * Carries a bounded targeted-reanalysis request together with the caller's PBAC and correlation context.
 */
export class RequestTargetedReanalysisCommand {
  /**
   * Creates the targeted-reanalysis command.
   *
   * @param input - Requested evidence artifact, analyzer, bounded scope, requirement reason, and idempotency key.
   * @param pbacContext - Authorized subject/organization context used for ownership, audit, and outbox provenance.
   * @param correlationId - Correlation identifier propagated through request lifecycle state.
   */
  constructor(
    public readonly input: RequestTargetedReanalysisInput,
    public readonly pbacContext: PbacRequestContext,
    public readonly correlationId: string,
  ) {}
}
