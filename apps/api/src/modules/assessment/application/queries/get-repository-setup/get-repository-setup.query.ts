import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";
import type { AssessmentRepositorySetup } from "@lcsp/contracts/assessment-domain";

export class GetRepositorySetupQuery extends Query<AssessmentRepositorySetup> {
  constructor(
    public readonly assessmentId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
