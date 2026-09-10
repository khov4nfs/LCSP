import { Command } from "@nestjs/cqrs";

export type DeleteAssessmentDto = {
  assessment_id: string;
  deleted: true;
};

export class DeleteAssessmentCommand extends Command<DeleteAssessmentDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
