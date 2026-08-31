export class DiscoverGitHubRepositoriesCommand {
  constructor(
    public readonly userId: string,
    public readonly subjectRole: string,
    public readonly sessionId: string,
    public readonly credential: string,
    public readonly limit: number | undefined,
    public readonly cursor: string | undefined,
    public readonly correlationId: string,
  ) {}
}
