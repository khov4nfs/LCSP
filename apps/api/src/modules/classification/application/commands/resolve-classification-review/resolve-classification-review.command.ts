import type { ResolveClassificationReviewInput } from "@lcsp/contracts/evidence";

export class ResolveClassificationReviewCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: ResolveClassificationReviewInput,
    public readonly actorId: string,
    public readonly policyId: string,
    public readonly policyVersion: string,
    public readonly correlationId: string,
  ) {}
}
