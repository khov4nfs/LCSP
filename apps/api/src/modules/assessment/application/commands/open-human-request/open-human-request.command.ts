import type {
  OpenAssessmentHumanRequest,
  OpenAssessmentHumanRequestResult,
} from "@lcsp/contracts/assessment-domain";
import { Command } from "@nestjs/cqrs";

export class OpenHumanRequestCommand extends Command<OpenAssessmentHumanRequestResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly request: OpenAssessmentHumanRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
