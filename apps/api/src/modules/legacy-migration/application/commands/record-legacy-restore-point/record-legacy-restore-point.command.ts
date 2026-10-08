import { Command } from "@nestjs/cqrs";

export type RestorePointResult = {
  runId: string;
  restorePointRef: string | null;
  verified: boolean;
  boundaryClosed: boolean;
};

/** Records the pre-first-V2-write restore point and whether a restore drill verified it. */
export class RecordLegacyRestorePointCommand extends Command<RestorePointResult> {
  constructor(
    public readonly runId: string,
    public readonly ref: string,
    public readonly digest: string,
    public readonly verified: boolean,
  ) {
    super();
  }
}

/** Closes the rollback boundary at the first accepted V2 write: forward repair only afterwards. */
export class CloseLegacyRestoreBoundaryCommand extends Command<RestorePointResult> {
  constructor(public readonly runId: string) {
    super();
  }
}
