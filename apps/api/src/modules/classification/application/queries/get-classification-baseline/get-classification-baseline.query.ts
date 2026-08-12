import type { GetClassificationBaselineInput } from "@lcsp/contracts/evidence";

export class GetClassificationBaselineQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: GetClassificationBaselineInput,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
