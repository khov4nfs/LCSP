import { Command } from "@nestjs/cqrs";

import type { CreateAssessmentDto } from "../../contracts/assessment/create-assessment.contract.js";

/**
 * Carries assessment-creation input for an already authenticated owner.
 */
export class CreateAssessmentCommand extends Command<CreateAssessmentDto> {
  /**
   * Creates an assessment-creation command.
   *
   * @param ownerId - Authenticated user who will own the assessment.
   * @param name - Requested assessment name.
   * @param description - Optional assessment description.
   * @param correlationId - Correlation identifier propagated to audit, outbox, and response metadata.
   */
  constructor(
    public readonly ownerId: string,
    public readonly name: string | undefined,
    public readonly description: string | undefined,
    public readonly correlationId: string,
  ) {
    super();
  }
}
