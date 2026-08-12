import type { GetGapRequirementsInput } from "@lcsp/contracts/evidence";

export class GetGapRequirementsQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: GetGapRequirementsInput,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
