import type { GetLegalRuleMatchInput } from "@lcsp/contracts/evidence";

export class GetLegalRuleMatchQuery {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: GetLegalRuleMatchInput,
    public readonly actorId: string,
    public readonly policyId: string | null,
    public readonly policyVersion: string | null,
    public readonly correlationId: string,
  ) {}
}
