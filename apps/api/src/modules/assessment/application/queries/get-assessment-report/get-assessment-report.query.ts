import { Query } from "@nestjs/cqrs";
import type { AuthUserRole } from "@lcsp/contracts/auth";
import type { CredentialProvider } from "@lcsp/contracts/github-integration";

export class GetAssessmentReportQuery extends Query<{
  artifactId: string;
  content: Buffer;
  contentSha256: string;
  sourceArtifactSha256: string;
  repositorySource: {
    provider: CredentialProvider;
    canonicalRepositoryUrl: string;
    commitSha: string;
  } | null;
}> {
  constructor(
    public readonly assessmentId: string,
    public readonly artifactId: string,
    public readonly sessionUserId: string,
    public readonly subjectRole: AuthUserRole,
    public readonly correlationId: string,
    public readonly locale?: string | null,
  ) {
    super();
  }
}
