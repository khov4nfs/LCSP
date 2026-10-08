import { Command } from "@nestjs/cqrs";

export type BackfillLegacyAssessmentsResult = {
  backfilled: number;
  reconciled: number;
  pinnedSnapshot: number;
  byReason: Record<string, number>;
  skipped: number;
};

/**
 * Creates fresh V2 state (new thread, case, pins, coverage) for every non-terminal V1 assessment.
 * Never imports a V1 decision, fact, evidence item, question or checkpoint; never starts the Root.
 */
export class BackfillLegacyAssessmentsCommand extends Command<BackfillLegacyAssessmentsResult> {
  constructor(
    public readonly runId: string,
    public readonly batchSize: number,
    public readonly correlationId: string,
  ) {
    super();
  }
}
