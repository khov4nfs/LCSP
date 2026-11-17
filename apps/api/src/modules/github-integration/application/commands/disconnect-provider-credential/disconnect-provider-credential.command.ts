export class DisconnectProviderCredentialCommand {
  constructor(
    public readonly userId: string,
    public readonly subjectRole: string,
    public readonly sessionId: string,
    public readonly provider: string,
    public readonly correlationId: string,
  ) {}
}
