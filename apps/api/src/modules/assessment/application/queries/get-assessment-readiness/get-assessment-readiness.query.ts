import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";
import type { AssessmentReadinessStatusDto } from "../../contracts/assessment/readiness-status.contract.js";

export class GetAssessmentReadinessQuery extends Query<AssessmentReadinessStatusDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
