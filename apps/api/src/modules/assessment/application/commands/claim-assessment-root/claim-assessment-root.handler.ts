import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { ClaimAssessmentRootCommand } from "./claim-assessment-root.command.js";

@CommandHandler(ClaimAssessmentRootCommand)
export class ClaimAssessmentRootHandler implements ICommandHandler<ClaimAssessmentRootCommand> {
  constructor(private readonly authority: AssessmentRuntimeAuthority) {}

  execute(command: ClaimAssessmentRootCommand) {
    return this.authority.claimRoot({
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
    });
  }
}
