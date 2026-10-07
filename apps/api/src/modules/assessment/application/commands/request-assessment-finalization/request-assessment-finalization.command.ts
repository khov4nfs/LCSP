import { Command } from "@nestjs/cqrs";

import type {
  AssessmentCompletionGateResult,
  RequestAssessmentFinalization,
} from "@lcsp/contracts/assessment-domain";

export class RequestAssessmentFinalizationCommand extends Command<AssessmentCompletionGateResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: RequestAssessmentFinalization,
    public readonly correlationId: string,
  ) {
    super();
  }
}
