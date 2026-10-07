import { Command } from "@nestjs/cqrs";
import type { AssessmentRootClaim } from "@lcsp/contracts/assessment-domain";

export class ClaimAssessmentRootCommand extends Command<AssessmentRootClaim> {
  constructor(
    public readonly assessmentId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
