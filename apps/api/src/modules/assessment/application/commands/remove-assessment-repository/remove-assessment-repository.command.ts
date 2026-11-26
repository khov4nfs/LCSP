import { Command } from "@nestjs/cqrs";

import type { z } from "zod";
import type { removeAssessmentRepositoryResultSchema } from "@lcsp/contracts/assessment-domain";

export type RemoveAssessmentRepositoryDto = z.infer<
  typeof removeAssessmentRepositoryResultSchema
>;

export class RemoveAssessmentRepositoryCommand extends Command<RemoveAssessmentRepositoryDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly snapshotId: string,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
