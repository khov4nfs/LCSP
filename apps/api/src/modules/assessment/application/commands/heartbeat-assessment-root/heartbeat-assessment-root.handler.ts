import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { HeartbeatAssessmentRootCommand } from "./heartbeat-assessment-root.command.js";

@CommandHandler(HeartbeatAssessmentRootCommand)
export class HeartbeatAssessmentRootHandler implements ICommandHandler<HeartbeatAssessmentRootCommand> {
  constructor(private readonly authority: AssessmentRuntimeAuthority) {}

  execute(command: HeartbeatAssessmentRootCommand) {
    return this.authority.heartbeat({
      assessmentId: command.assessmentId,
      leaseToken: command.leaseToken,
      correlationId: command.correlationId,
    });
  }
}
