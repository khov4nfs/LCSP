import { Command } from "@nestjs/cqrs";

export type RenameAssessmentDto = {
  assessment_id: string;
  name: string;
};

export class RenameAssessmentCommand extends Command<RenameAssessmentDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly name: unknown,
    public readonly correlationId: string,
  ) {
    super();
  }
}
