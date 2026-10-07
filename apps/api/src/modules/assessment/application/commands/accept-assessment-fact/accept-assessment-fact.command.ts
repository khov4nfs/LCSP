import type { AcceptCaseFactRequest } from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export type AcceptAssessmentFactResult = {
  factId: string;
  caseRevision: number;
};

export class AcceptAssessmentFactCommand extends Command<AcceptAssessmentFactResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: AcceptCaseFactRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
