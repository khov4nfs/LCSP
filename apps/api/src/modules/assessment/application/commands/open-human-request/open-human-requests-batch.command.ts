import type {
  OpenAssessmentHumanRequestsBatch,
  OpenAssessmentHumanRequestsBatchResult,
} from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export class OpenHumanRequestsBatchCommand extends Command<OpenAssessmentHumanRequestsBatchResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly batch: OpenAssessmentHumanRequestsBatch,
    public readonly correlationId: string,
  ) {
    super();
  }
}
