import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";

import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { TransitionAssessmentLifecycleCommand } from "./transition-lifecycle.command.js";

/** Internal API command adapter; authorization is still enforced by the coordinator. */
@CommandHandler(TransitionAssessmentLifecycleCommand)
export class TransitionAssessmentLifecycleHandler implements ICommandHandler<TransitionAssessmentLifecycleCommand> {
  constructor(private readonly lifecycle: AssessmentLifecycleCoordinator) {}

  execute(command: TransitionAssessmentLifecycleCommand) {
    return this.lifecycle.transition({
      assessmentId: command.assessmentId,
      actorId: command.actorId,
      expectedRevision: command.expectedRevision,
      toState: command.toState,
      correlationId: command.correlationId,
      eventId: command.eventId,
      blocker: command.blocker,
    });
  }
}
