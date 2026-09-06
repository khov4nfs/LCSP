import { Command } from "@nestjs/cqrs";

export type CompleteRepositorySetupDto = {
  assessment_id: string;
  status: string;
  repository_connection_id: string;
  snapshot_id: string;
  commit_sha: string;
};

export class CompleteRepositorySetupCommand extends Command<CompleteRepositorySetupDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
