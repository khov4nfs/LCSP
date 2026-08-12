import type { VerifiedProfileRequiredFor } from "@lcsp/contracts/evidence";

export class GetVerifiedProfileQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly verifiedProfileId: string,
    public readonly expectedVersion: string,
    public readonly requiredFor: VerifiedProfileRequiredFor,
    public readonly correlationId: string,
  ) {}
}
