import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import { FinishAssessmentRootCommand } from "./finish-assessment-root.command.js";

@CommandHandler(FinishAssessmentRootCommand)
export class FinishAssessmentRootHandler implements ICommandHandler<FinishAssessmentRootCommand> {
  constructor(private readonly authority: AssessmentRuntimeAuthority) {}

  /**
   * Business purpose: Settle one leased Root segment, retaining uncertain crash work for explicit operator replay.
   * Business rules:
   * - Finish cannot release physical capacity or declare a legal outcome; recovery quarantine requires FAILED.
   * Execution flow: 1. Forward the lease, checkpoint and recovery disposition to canonical settlement.
   * Failure cases:
   * - Invalid/stale leases, unsupported transitions and checkpoint conflicts propagate atomically.
   * Side effects:
   * - Delegates runtime/event/outbox persistence; performs no new execution or provider request.
   */
  execute(command: FinishAssessmentRootCommand) {
    return this.authority.finishExecution({
      assessmentId: command.assessmentId,
      leaseToken: command.leaseToken,
      correlationId: command.correlationId,
      toState: command.toState,
      checkpointId: command.checkpointId,
      requestIds: command.requestIds,
      controlRequestId: command.controlRequestId,
      recoveryRequired: command.recoveryRequired,
    });
  }
}
