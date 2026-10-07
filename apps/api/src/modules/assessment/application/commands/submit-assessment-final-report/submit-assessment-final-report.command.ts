import type { SubmitAssessmentFinalReportRequest } from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

import type { AssessmentFinalReportResult } from "@lcsp/contracts/assessment-domain";

export class SubmitAssessmentFinalReportCommand extends Command<AssessmentFinalReportResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: SubmitAssessmentFinalReportRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
