export class ConnectAssessmentRepositoryCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly userId: string,
    public readonly subjectRole: string,
    public readonly repositoryUrl: string,
    public readonly correlationId: string,
  ) {}
}
