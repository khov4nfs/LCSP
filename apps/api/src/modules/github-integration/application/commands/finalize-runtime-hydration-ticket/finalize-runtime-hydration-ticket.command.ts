import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

type DeliveryOutcome =
  | typeof REPOSITORY_SCAN_JOB_STATUSES.completed
  | typeof REPOSITORY_SCAN_JOB_STATUSES.failed;

export class FinalizeRuntimeHydrationTicketCommand {
  constructor(
    public readonly ticketId: string,
    public readonly snapshotId: string,
    public readonly outcome: DeliveryOutcome,
  ) {}
}
