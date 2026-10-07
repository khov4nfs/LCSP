import { Command } from "@nestjs/cqrs";

import type { AssessmentRuntimeAuthority } from "../../services/assessment-runtime-authority.service.js";

export class HeartbeatAssessmentRootCommand extends Command<
  Awaited<ReturnType<AssessmentRuntimeAuthority["heartbeat"]>>
> {
  constructor(
    public readonly assessmentId: string,
    public readonly leaseToken: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
