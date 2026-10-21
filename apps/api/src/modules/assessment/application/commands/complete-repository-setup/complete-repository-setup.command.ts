import { Command } from "@nestjs/cqrs";

import type { z } from "zod";
import type { completeAssessmentRepositorySetupResultSchema } from "@lcsp/contracts/assessment-domain";
export type CompleteRepositorySetupDto = z.infer<
  typeof completeAssessmentRepositorySetupResultSchema
>;

export class CompleteRepositorySetupCommand extends Command<CompleteRepositorySetupDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly correlationId: string,
    public readonly responseLanguage?: string | null,
  ) {
    super();
  }
}
