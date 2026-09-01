export class ConsolidateVerifiedAgentEpisodesCommand {
  constructor(
    public readonly assessmentId: string,
    public readonly userId: string,
    public readonly correlationId: string,
  ) {}
}
