import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { FinishAssessmentRootCommand } from "./finish-assessment-root.command.js";

@CommandHandler(FinishAssessmentRootCommand)
export class FinishAssessmentRootHandler implements ICommandHandler<FinishAssessmentRootCommand> {
  constructor(private readonly authority: AssessmentRuntimeAuthority) {}

  execute(command: FinishAssessmentRootCommand) {
    return this.authority.finishExecution({
      assessmentId: command.assessmentId,
      leaseToken: command.leaseToken,
      correlationId: command.correlationId,
      toState: command.toState,
      checkpointId: command.checkpointId,
      requestIds: command.requestIds,
      controlRequestId: command.controlRequestId,
    });
  }
}
