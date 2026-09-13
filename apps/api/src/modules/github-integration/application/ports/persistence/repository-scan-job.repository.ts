import type { OutboxMessageInput } from "@lcsp/contracts/outbox";

import type { RepositoryScanJob } from "../../../domain/entities/repository-scan-job.entity.js";

export const REPOSITORY_SCAN_JOB_REPOSITORY = Symbol(
  "REPOSITORY_SCAN_JOB_REPOSITORY",
);

export interface RepositoryScanJobRepository {
  findByIdempotencyKey(key: string): Promise<RepositoryScanJob | null>;
  findActiveByAssessmentAndSnapshot(input: {
    assessmentId: string;
    snapshotId: string;
  }): Promise<RepositoryScanJob | null>;
  save(job: RepositoryScanJob): Promise<void>;
  saveWithTriggeredEvent(
    job: RepositoryScanJob,
    event: OutboxMessageInput,
  ): Promise<void>;
}
