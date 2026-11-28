/**
 * Why: Encapsulates the recovery sweeper command to reclaim expired in-flight invocation leases.
 * How: Carries batch size and correlation metadata into CQRS handler.
 * Invariants: Enforces ADR-028 Line 92 recovery invariant: transitions expired IN_FLIGHT leases to
 * DISPATCH_UNKNOWN and opens a reconciliation case while strictly preserving maximum exposure.
 */

import type { SweepExpiredLeasesRequest } from "@lcsp/contracts/billing";

export class SweepExpiredInvocationLeasesCommand {
  constructor(
    public readonly payload: SweepExpiredLeasesRequest,
    public readonly correlationId?: string,
  ) {}
}
