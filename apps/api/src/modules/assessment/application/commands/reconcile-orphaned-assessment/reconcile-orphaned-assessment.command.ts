import { Command } from "@nestjs/cqrs";
import type { z } from "zod";
import { reconcileOrphanedAssessmentResultSchema } from "@lcsp/contracts/assessment-domain";

export type ReconcileOrphanedAssessmentResult = z.infer<
  typeof reconcileOrphanedAssessmentResultSchema
>;

export class ReconcileOrphanedAssessmentCommand extends Command<ReconcileOrphanedAssessmentResult> {
  constructor(
    public readonly assessmentId: string,
    public readonly ownerId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
