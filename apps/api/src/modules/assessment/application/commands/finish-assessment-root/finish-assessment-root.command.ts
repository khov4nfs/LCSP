import { Command } from "@nestjs/cqrs";

import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";
import type { AgentExecutionState } from "@lcsp/contracts/assessment";

export class FinishAssessmentRootCommand extends Command<
  Awaited<ReturnType<AssessmentRuntimeAuthority["finishExecution"]>>
> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly toState: AgentExecutionState,
    public readonly correlationId: string,
    public readonly checkpointId?: string,
    public readonly requestIds?: string[],
    public readonly controlRequestId?: string,
  ) {
    super();
  }
}
