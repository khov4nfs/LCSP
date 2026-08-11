import type { RetrieveLegalBasisInput } from "@lcsp/contracts/evidence";

export class RetrieveLegalBasisQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: RetrieveLegalBasisInput,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
