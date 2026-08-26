export class ResolveConflictCommand {
  constructor(
    readonly assessmentId: string,
    readonly conflictId: string,
    readonly resolvedById: string,
    readonly resolution: unknown,
    readonly resolutionNote: unknown,
    readonly correlationId: string,
  ) {}
}
