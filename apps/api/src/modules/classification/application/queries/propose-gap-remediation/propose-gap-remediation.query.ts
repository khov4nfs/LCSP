import type { ProposeGapRemediationInput } from "@lcsp/contracts/evidence";

export class ProposeGapRemediationQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: ProposeGapRemediationInput,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {}
}
