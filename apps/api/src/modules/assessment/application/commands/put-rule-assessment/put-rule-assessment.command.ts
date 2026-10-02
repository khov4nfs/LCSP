import { Command } from "@nestjs/cqrs";

import type { AcceptedRuleAssessment } from "@lcsp/contracts/evidence";

/** Worker-requested upsert of the accepted per-rule assessment (latest result per rule). */
export class PutRuleAssessmentCommand extends Command<AcceptedRuleAssessment> {
  constructor(
    public readonly assessmentId: string,
    public readonly engineeringRuleId: string,
    public readonly body: unknown,
    public readonly correlationId: string,
  ) {
    super();
  }
}
