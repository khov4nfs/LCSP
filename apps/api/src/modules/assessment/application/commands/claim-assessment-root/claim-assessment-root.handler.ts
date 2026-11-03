import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { ClaimAssessmentRootCommand } from "./claim-assessment-root.command.js";

@CommandHandler(ClaimAssessmentRootCommand)
export class ClaimAssessmentRootHandler implements ICommandHandler<ClaimAssessmentRootCommand> {
  constructor(private readonly authority: AssessmentRuntimeAuthority) {}

  /**
   * Business purpose: Route a Root claim with its physical server ownership to the API authority.
   * Business rules:
   * - The exact transport and incarnation must bind the global reservation; callers issue no lease themselves.
   * Execution flow: 1. Forward the command identity and physical ownership to canonical claim validation.
   * Failure cases:
   * - Ownership, lifecycle and lease conflicts propagate without another Root execution.
   * Side effects:
   * - Delegates the existing transactional lease/turn persistence; performs no model call.
   */
  execute(command: ClaimAssessmentRootCommand) {
    return this.authority.claimRoot({
      assessmentId: command.assessmentId,
      correlationId: command.correlationId,
      runtimeRunId: command.runtimeRunId,
      runtimeIncarnationId: command.runtimeIncarnationId,
    });
  }
}
