import type { ValidateClassificationProposalInput } from "@lcsp/contracts/evidence";

export class ValidateClassificationProposalQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: ValidateClassificationProposalInput,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
