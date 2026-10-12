import { Command } from "@nestjs/cqrs";
import type {
  AssessmentBlocker,
  AssessmentLifecycleState,
} from "@lcsp/contracts/assessment";

import type { AssessmentLifecycleTransitionResult } from "../../services/assessment-lifecycle-coordinator.service.js";

export class TransitionAssessmentLifecycleCommand extends Command<AssessmentLifecycleTransitionResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly expectedRevision: number,
    public readonly toState: AssessmentLifecycleState,
    public readonly correlationId: string,
    public readonly eventId?: string,
    public readonly blocker?: AssessmentBlocker,
  ) {
    super();
  }
}
