import { Command } from "@nestjs/cqrs";

export class RemoveAssessmentRepositoryCommand extends Command<{
  removed: boolean;
}> {
  constructor(
    public readonly assessmentId: string,
    public readonly connectionId: string,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
