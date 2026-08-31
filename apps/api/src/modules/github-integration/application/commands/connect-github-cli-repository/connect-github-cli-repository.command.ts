export class ConnectGitHubCliRepositoryCommand {
  constructor(
    public readonly userId: string,
    public readonly subjectRole: string,
    public readonly sessionId: string,
    public readonly credential: string,
    public readonly repositoryFullName: string | undefined,
    public readonly assessmentId: string | undefined,
    public readonly credentialExpiresAt: string | undefined,
    public readonly correlationId: string,
    public readonly provider: string | undefined = undefined,
    public readonly repositoryUrl: string | undefined = undefined,
  ) {}
}
