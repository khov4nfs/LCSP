import { Command } from "@nestjs/cqrs";
import type {
  AnswerAssessmentHumanRequest,
  AnswerAssessmentHumanRequestResult,
} from "@lcsp/contracts/assessment-domain";
import type { RbacRequestContext } from "../../../../../platform/rbac/interfaces/rbac-request.interface.js";

export class AnswerHumanRequestCommand extends Command<AnswerAssessmentHumanRequestResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly requestId: string,
    public readonly actor: RbacRequestContext,
    public readonly request: AnswerAssessmentHumanRequest,
    public readonly correlationId: string,
  ) {
    super();
  }
}
