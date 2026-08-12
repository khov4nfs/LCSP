import type { ValidateCitationSetInput } from "@lcsp/contracts/evidence";

export class ValidateCitationSetQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: ValidateCitationSetInput,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
