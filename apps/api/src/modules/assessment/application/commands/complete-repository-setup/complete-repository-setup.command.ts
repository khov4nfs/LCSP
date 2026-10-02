import { Command } from "@nestjs/cqrs";

export type CompleteRepositorySetupDto = {
  assessment_id: string;
  setup_version: number;
  status: string;
  repository_connection_id: string;
  snapshot_id: string;
  commit_sha: string;
  scan_jobs: Array<{
    snapshot_id: string;
    commit_sha: string;
    scan_job_id: string;
    status: string;
  }>;
};

export class CompleteRepositorySetupCommand extends Command<CompleteRepositorySetupDto> {
  constructor(
    public readonly assessmentId: string,
    public readonly actorId: string,
    public readonly correlationId: string,
    public readonly expectedSetupVersion = 0,
  ) {
    super();
  }
}
