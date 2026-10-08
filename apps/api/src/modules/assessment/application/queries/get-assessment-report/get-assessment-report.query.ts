import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";

export class GetAssessmentReportQuery extends Query<{
  artifactId: string;
  content: Buffer;
  contentSha256: string;
}> {
  constructor(
    public readonly assessmentId: string,
    public readonly artifactId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly correlationId: string,
  ) {
    super();
  }
}
