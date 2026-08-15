import { Command } from "@nestjs/cqrs";
import type { SubjectRole } from "@lcsp/contracts/pbac";

import type { CreateAssessmentDto } from "../../contracts/assessment/create-assessment.contract.js";

export type ManagerOnlyAuthorizationContext = {
  subjectRole: SubjectRole;
  selectedAction: string | null;
  policyId: string | null;
  policyVersion: string | null;
};

/**
 * Carries assessment-creation input together with the PBAC decision context required for the manager-only operation.
 */
export class CreateAssessmentCommand extends Command<CreateAssessmentDto> {
  /**
   * Creates an assessment-creation command.
   *
   * @param organizationId - Organization in which the assessment should be created.
   * @param ownerId - Authenticated user who will own the assessment.
   * @param name - Requested assessment name.
   * @param description - Optional assessment description.
   * @param correlationId - Correlation identifier propagated to audit, outbox, and response metadata.
   * @param authorization - PBAC role, selected action, and policy version used to authorize the manager-only mutation.
   */
  constructor(
    public readonly organizationId: string,
    public readonly ownerId: string,
    public readonly name: string | undefined,
    public readonly description: string | undefined,
    public readonly correlationId: string,
    public readonly authorization: ManagerOnlyAuthorizationContext,
  ) {
    super();
  }
}
