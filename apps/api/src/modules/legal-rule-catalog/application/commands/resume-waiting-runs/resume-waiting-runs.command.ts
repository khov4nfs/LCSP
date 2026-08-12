export class ResumeWaitingRunsCommand {
  constructor(
    public readonly corpusVersionId: string,
    public readonly maxRuns: number,
    public readonly idempotencyKey: string,
    public readonly correlationId: string,
  ) {}
}
