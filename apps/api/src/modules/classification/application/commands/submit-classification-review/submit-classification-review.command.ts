import type { SubmitClassificationReviewInput } from "@lcsp/contracts/evidence";

export class SubmitClassificationReviewCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly organizationId: string,
    public readonly input: SubmitClassificationReviewInput,
    public readonly actorId: string,
    public readonly policyId: string,
    public readonly policyVersion: string,
    public readonly correlationId: string,
  ) {}
}
